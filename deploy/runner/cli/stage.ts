import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Subprocess } from "bun";
import { errorText, readSecret, SECRETS } from "../lib/config";
import type { StageKind } from "./args";
import { broker, type Broker } from "./broker-client";
import { summarize } from "./events";
import { issueBranch } from "./linear";
import {
  claudeArgs,
  CLONE,
  freshResult,
  LOGS,
  logPath,
  mcpConfig,
  stageEnv,
  stagePrompt,
  WORKTREES,
  worktreeOf,
} from "./plan";

// `runner stage <kind> BAN-N` (ADR-0012): one Stage, headless, in the
// foreground, in the clone of `main` as in live mode. It gets a Linear token
// from the Broker for this Stage alone, hands it to `claude` in a per-run MCP
// config, prints one line per event and keeps every event in the Stage's log,
// prints the Stage's result, and revokes the token whatever happens, a signal
// included. It never changes the issue's status or assignee: that is the
// Dispatcher's (BAN-95).

const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
type Signal = keyof typeof SIGNALS;
const isSignal = (name: string): name is Signal => name in SIGNALS;

/** What a Stage reaches outside itself, so a test can stand in for each. */
export type StageDeps = {
  broker: Pick<Broker, "identity" | "linearToken" | "endLinearToken">;
  issueBranch: (token: string, issue: string, signal: AbortSignal) => Promise<string>;
  claudeToken: () => string;
  /** The `claude` command. */
  claude: string;
  clone: string;
  worktrees: string;
  logs: string;
  /** Where the per-run MCP config's directory goes. */
  tmp: string;
  out: (line: string) => void;
  err: (line: string) => void;
};

export const stageDeps = (): StageDeps => ({
  broker: broker(),
  issueBranch,
  claudeToken: () => readSecret(SECRETS.claudeToken),
  claude: "claude",
  clone: CLONE,
  worktrees: WORKTREES,
  logs: LOGS,
  tmp: tmpdir(),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});

const clock = () => new Date().toISOString().slice(11, 19);

/**
 * SIGINT, SIGTERM and SIGHUP, from the moment the Stage starts until its
 * cleanup is done: a signal never kills `runner` with a token out or the MCP
 * config on disk. While `claude` runs it gets the signal; before, the step
 * under way is cut short where it can be, and the Stage stops after it.
 */
class Interrupt {
  signal: Signal | undefined;
  readonly controller = new AbortController();
  child: Subprocess | undefined;
  readonly #listener = (signal: NodeJS.Signals) => {
    if (!isSignal(signal)) return;
    this.signal ??= signal;
    if (this.child === undefined) this.controller.abort(new Error(`stopped by ${signal}`));
    else this.child.kill(signal);
  };

  install(): void {
    for (const signal of Object.keys(SIGNALS)) process.on(signal, this.#listener);
  }

  remove(): void {
    for (const signal of Object.keys(SIGNALS)) process.off(signal, this.#listener);
  }

  /** Throws once a signal came, so the Stage goes no further. */
  check(): void {
    if (this.signal !== undefined) throw new Error(`stopped by ${this.signal}`);
  }
}

/** Runs the Stage and returns `claude`'s exit code, or 128 + the signal's number when one stopped it. */
export async function runStage(
  kind: StageKind,
  issue: string,
  deps: StageDeps = stageDeps(),
): Promise<number> {
  const startedAt = new Date();
  const stop = new Interrupt();
  stop.install();
  try {
    const claudeToken = deps.claudeToken();
    const identity = await deps.broker.identity(stop.controller.signal);
    stop.check();
    // Not cut short by a signal: the Broker mints the token either way, and
    // only its ID ends it, so it is waited for and revoked at once.
    const linear = await deps.broker.linearToken();
    let configDir: string | undefined;
    try {
      stop.check();
      // Before any token is spent: the issue exists, and Linear takes the token.
      const branch = await deps.issueBranch(linear.token, issue, stop.controller.signal);
      const worktree = worktreeOf(branch, deps.worktrees);
      stop.check();

      configDir = mkdtempSync(join(deps.tmp, "banki-stage-"));
      const config = join(configDir, "mcp.json");
      writeFileSync(config, JSON.stringify(mcpConfig(linear.token)), { mode: 0o600 });

      const log = logPath(issue, kind, startedAt, deps.logs);
      mkdirSync(dirname(log), { recursive: true });
      deps.out(`The ${kind} Stage on ${issue}, as ${identity.name}, in ${deps.clone}. Log: ${log}`);

      const [, ...args] = claudeArgs(stagePrompt(kind, issue), config);
      const exitCode = await runClaude(
        [deps.claude, ...args],
        stageEnv(process.env, claudeToken, identity),
        log,
        deps,
        stop,
      );
      deps.out(`${clock()} claude exited ${exitCode}`);
      stop.check();
      printResult(join(worktree, ".ui", "stage-result.json"), startedAt, deps);
      return exitCode;
    } finally {
      if (configDir !== undefined) rmSync(configDir, { recursive: true, force: true });
      await deps.broker.endLinearToken(linear.id).then(
        () => deps.out("Revoked the Stage's Linear token"),
        (error: unknown) =>
          deps.err(
            `Couldn't revoke the Stage's Linear token (the Broker revokes it 4 hours after issue): ${errorText(error)}`,
          ),
      );
    }
  } catch (error) {
    if (stop.signal === undefined) throw error;
    deps.err(`The ${kind} Stage on ${issue} stopped on ${stop.signal}`);
    return 128 + SIGNALS[stop.signal];
  } finally {
    stop.remove();
  }
}

/**
 * `claude`, with its events printed one line each and appended whole to the
 * log, as they come. Its stderr goes to the terminal and, as `runner` events,
 * to the log, which stays one JSON object per line.
 */
async function runClaude(
  argv: string[],
  env: Record<string, string>,
  log: string,
  deps: StageDeps,
  stop: Interrupt,
): Promise<number> {
  const fd = openSync(log, "a", 0o600);
  const record = (line: string) => writeSync(fd, `${line}\n`);
  const note = (fields: Record<string, unknown>) =>
    record(JSON.stringify({ type: "runner", at: new Date().toISOString(), ...fields }));
  note({ event: "start", argv });

  const proc = Bun.spawn(argv, {
    cwd: deps.clone,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  stop.child = proc;
  // A signal that came while it was being started.
  if (stop.signal !== undefined) proc.kill(stop.signal);
  try {
    await Promise.all([
      eachLine(proc.stdout, (line) => {
        record(line);
        deps.out(`${clock()} ${summarize(line)}`);
      }),
      eachLine(proc.stderr, (line) => {
        note({ event: "stderr", line });
        deps.err(`${clock()} [stderr] ${line}`);
      }),
    ]);
    const exitCode = await proc.exited;
    note({ event: "exit", exitCode, signal: proc.signalCode ?? null });
    return exitCode;
  } finally {
    stop.child = undefined;
    closeSync(fd);
  }
}

async function eachLine(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let partial = "";
  for await (const chunk of stream) {
    const lines = `${partial}${decoder.decode(chunk, { stream: true })}`.split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) if (line.trim() !== "") onLine(line);
  }
  const rest = `${partial}${decoder.decode()}`;
  if (rest.trim() !== "") onLine(rest);
}

function printResult(path: string, startedAt: Date, deps: StageDeps): void {
  let modified: Date | undefined;
  try {
    modified = statSync(path).mtime;
  } catch {
    modified = undefined;
  }
  if (!freshResult(modified, startedAt)) {
    deps.out(`The Stage wrote no result (${path})`);
    return;
  }
  deps.out(`The Stage's result (${path}):\n${readFileSync(path, "utf8").trimEnd()}`);
}
