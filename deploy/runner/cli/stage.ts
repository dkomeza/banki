import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { errorText, readSecret, SECRETS } from "../lib/config";
import type { StageKind } from "./args";
import { broker } from "./broker-client";
import { summarize } from "./events";
import { issueBranch } from "./linear";
import {
  claudeArgs,
  CLONE,
  freshResult,
  logPath,
  mcpConfig,
  stageEnv,
  stagePrompt,
  worktreeOf,
} from "./plan";

// `runner stage <kind> BAN-N` (ADR-0012): one Stage, headless, in the
// foreground, in the clone of `main` as in live mode. It gets a Linear token
// from the broker for this Stage alone, hands it to `claude` in a per-run MCP
// config, prints one line per event and keeps every event in the Stage's log,
// prints the Stage's result, and revokes the token whatever happens. It never
// changes the issue's status or assignee: that is the Dispatcher's (BAN-95).

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

const clock = () => new Date().toISOString().slice(11, 19);

/** Runs the Stage and returns `claude`'s exit code. */
export async function runStage(kind: StageKind, issue: string): Promise<number> {
  const startedAt = new Date();
  const claudeToken = readSecret(SECRETS.claudeToken);
  const client = broker();
  const identity = await client.identity();
  const linear = await client.linearToken();
  let configDir: string | undefined;
  try {
    // Before any token is spent: the issue exists, and Linear takes the token.
    const worktree = worktreeOf(await issueBranch(linear.token, issue));

    configDir = mkdtempSync(join(tmpdir(), "banki-stage-"));
    const config = join(configDir, "mcp.json");
    writeFileSync(config, JSON.stringify(mcpConfig(linear.token)), { mode: 0o600 });

    const log = logPath(issue, kind, startedAt);
    mkdirSync(dirname(log), { recursive: true });
    console.log(`The ${kind} Stage on ${issue}, as ${identity.name}, in ${CLONE}. Log: ${log}`);

    const exitCode = await runClaude(
      claudeArgs(stagePrompt(kind, issue), config),
      stageEnv(process.env, claudeToken, identity),
      log,
    );
    console.log(`${clock()} claude exited ${exitCode}`);
    printResult(join(worktree, ".ui", "stage-result.json"), startedAt);
    return exitCode;
  } finally {
    if (configDir !== undefined) rmSync(configDir, { recursive: true, force: true });
    await client.endLinearToken(linear.id).then(
      () => console.log("Revoked the Stage's Linear token"),
      (error: unknown) =>
        console.error(
          `Couldn't revoke the Stage's Linear token (the broker revokes it 4 hours after issue): ${errorText(error)}`,
        ),
    );
  }
}

/**
 * `claude`, with its events printed one line each and appended whole to the
 * log, as they come. Its stderr goes to the terminal and, as `runner` events,
 * to the log, which stays one JSON object per line. A signal to `runner` goes
 * on to `claude`, so the token is still revoked after Ctrl-C.
 */
async function runClaude(
  argv: string[],
  env: Record<string, string>,
  log: string,
): Promise<number> {
  const fd = openSync(log, "a", 0o600);
  const record = (line: string) => writeSync(fd, `${line}\n`);
  const note = (fields: Record<string, unknown>) =>
    record(JSON.stringify({ type: "runner", at: new Date().toISOString(), ...fields }));
  note({ event: "start", argv });

  const proc = Bun.spawn(argv, {
    cwd: CLONE,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const forward = (signal: NodeJS.Signals) => proc.kill(signal);
  for (const signal of SIGNALS) process.on(signal, forward);
  try {
    await Promise.all([
      eachLine(proc.stdout, (line) => {
        record(line);
        console.log(`${clock()} ${summarize(line)}`);
      }),
      eachLine(proc.stderr, (line) => {
        note({ event: "stderr", line });
        console.error(`${clock()} [stderr] ${line}`);
      }),
    ]);
    const exitCode = await proc.exited;
    note({ event: "exit", exitCode, signal: proc.signalCode ?? null });
    return exitCode;
  } finally {
    for (const signal of SIGNALS) process.off(signal, forward);
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

function printResult(path: string, startedAt: Date): void {
  let modified: Date | undefined;
  try {
    modified = statSync(path).mtime;
  } catch {
    modified = undefined;
  }
  if (!freshResult(modified, startedAt)) {
    console.log(`The Stage wrote no result (${path})`);
    return;
  }
  console.log(`The Stage's result (${path}):\n${readFileSync(path, "utf8").trimEnd()}`);
}
