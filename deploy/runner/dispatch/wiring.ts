import { broker } from "../cli/broker-client";
import { CLONE, LOGS, WORKTREES } from "../cli/plan";
import { executeStage, stageDeps } from "../cli/stage";
import { readSecret, SECRETS } from "../lib/config";
import { takeReading } from "./claude";
import { dispatcherConfig } from "./config";
import type { DispatcherDeps } from "./dispatcher";
import { github } from "./github";
import { linear } from "./linear";
import { startSupervisor } from "./spawn";
import { redactTokens } from "./secrets";
import { store, supervisorAlive } from "./store";
import type { SupervisorDeps } from "./supervisor";
import { listWorktrees, logFiles, removeLogs, removeWorktree, worktreeFacts } from "./tidy";

// The real Linear, GitHub, `claude`, volume and processes behind the
// Dispatcher and its supervisors, as the Runner runs them.

const claudeToken = () => readSecret(SECRETS.claudeToken);
/** The Claude token is the one secret the runner holds; a log's tail never shows it. */
const hide = (text: string) => redactTokens(text, [claudeToken()]);
const log = (line: string) => console.log(line);

export function dispatcherDeps(): DispatcherDeps {
  return {
    broker: broker(),
    linear: (token) => linear(token),
    github: (token) => github(token),
    log,
    records: store(),
    config: dispatcherConfig(process.env),
    takeReading: () => takeReading(claudeToken()),
    startSupervisor: (start, onError) => startSupervisor(start, onError),
    alive: supervisorAlive,
    redact: hide,
    housekeeper: {
      logFiles: () => logFiles(LOGS),
      removeLogs,
      listWorktrees: () => listWorktrees(CLONE, WORKTREES),
      worktreeFacts,
      removeWorktree: (removal) => removeWorktree(CLONE, removal, log),
    },
    logs: LOGS,
    now: () => new Date(),
  };
}

export function supervisorDeps(): SupervisorDeps {
  return {
    broker: broker(),
    linear: (token) => linear(token),
    github: (token) => github(token),
    log,
    records: store(),
    takeReading: () => takeReading(claudeToken()),
    executeStage: (kind, issue, options) => executeStage(kind, issue, stageDeps(), options),
    redact: hide,
    now: () => new Date(),
    pid: process.pid,
  };
}
