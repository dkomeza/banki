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
import { pruneTickLog, TICK_LOG } from "./tick-log";
import type { SupervisorDeps } from "./supervisor";
import { listWorktrees, logFiles, removeLogs, removeWorktree, worktreeFacts } from "./tidy";

// The real Linear, GitHub, `claude`, volume and processes behind the
// Dispatcher and its supervisors, as the Runner runs them.

const claudeToken = () => readSecret(SECRETS.claudeToken);
/** The Claude token is the one secret the runner holds; a log's tail never shows it. */
const hide = (text: string) => redactTokens(text, [claudeToken()]);
const log = (line: string) => console.log(line);

/**
 * The Dispatcher's, for a tick, `run-now` or `runner status`. The tick and
 * `run-now` log through the tick log (tick-log.ts); `runner status` only prints.
 */
export function dispatcherDeps(options: { log?: (line: string) => void } = {}): DispatcherDeps {
  // One logger for everything the tick says, its housekeeping's included.
  const say = options.log ?? log;
  return {
    broker: broker(),
    linear: (token) => linear(token),
    github: (token) => github(token),
    log: say,
    records: store(),
    config: dispatcherConfig(process.env),
    takeReading: () => takeReading(claudeToken()),
    startSupervisor: (start, onError) => startSupervisor(start, onError),
    alive: supervisorAlive,
    redact: hide,
    housekeeper: {
      logFiles: () => logFiles(LOGS),
      removeLogs,
      pruneTickLog: (now) => pruneTickLog(TICK_LOG, now),
      listWorktrees: () => listWorktrees(CLONE, WORKTREES),
      worktreeFacts,
      removeWorktree: (removal) => removeWorktree(CLONE, removal, say),
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
