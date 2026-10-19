import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { request } from "playwright";
import type { ShootMode, UpMode } from "./args.ts";
import { type SetupLink, setupLinkFromLog } from "./setup-link.ts";
import { apiEnv, webEnv, webUrl } from "./stack-env.ts";
import { dataDirName, isStrayDataDir, parseStackFile, type StackFile } from "./stack-file.ts";

// A throwaway copy of Banki (the stack): the API and Vite on free ports, with
// their own data directory under .ui/, never apps/api/.data. Each process
// leads its own process group, so stopping it stops whatever it started too.

/** The worktree this script lives in. */
export const ROOT = resolve(import.meta.dirname, "../..");
export const UI_DIR = join(ROOT, ".ui");
export const STACK_FILE = join(UI_DIR, "stack.json");
const API_DIR = join(ROOT, "apps/api");
const WEB_DIR = join(ROOT, "apps/web");
const VITE_BIN = join(WEB_DIR, "node_modules/vite/bin/vite.js");

/** The stack's User: local and throwaway, like the stack itself. */
export const EMAIL = "ui@example.com";
const PASSWORD = "ui-throwaway-password";

const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 10_000;

/** A failure the script explains in its message, without a stack trace. */
export class UiError extends Error {
  override name = "UiError";
}

// Process groups this run started and hasn't stopped or handed over. Should
// the script exit without stopping them (an uncaught error), they are killed
// on the way out.
const owned = new Set<number>();
process.on("exit", () => {
  for (const pgid of owned) signalGroup(pgid, "SIGKILL");
});

function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    // EPERM: it exists but isn't ours to signal.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** Whether any process of the group `pgid` is still running. */
const groupAlive = (pgid: number) => signalGroup(pgid, 0);

/** Whether the process `pid` is still running. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** SIGTERM to each group, then SIGKILL to any still running after a grace period. */
async function stopGroups(pgids: number[]): Promise<void> {
  for (const pgid of pgids) signalGroup(pgid, "SIGTERM");
  for (const signal of ["SIGKILL", undefined] as const) {
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (pgids.some(groupAlive) && Date.now() < deadline) await sleep(100);
    if (signal === undefined) break;
    for (const pgid of pgids.filter(groupAlive)) signalGroup(pgid, signal);
  }
  for (const pgid of pgids) owned.delete(pgid);
}

/** Two distinct ports nothing is listening on, on any interface. */
async function freePorts(): Promise<[number, number]> {
  const servers = [createServer(), createServer()];
  const ports: number[] = [];
  for (const server of servers) {
    server.listen(0);
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new UiError("No free port found.");
    ports.push(address.port);
  }
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
  const [first, second] = ports;
  if (first === undefined || second === undefined) throw new UiError("No free port found.");
  return [first, second];
}

/** The last lines of a log file, for an error message. */
function tail(file: string, lines = 30): string {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

/** Spawns a process as the leader of a new process group, logging to `logFile`. */
async function spawnGroup(
  command: string,
  args: string[],
  { cwd, env, logFile }: { cwd: string; env: NodeJS.ProcessEnv; logFile: string },
): Promise<ChildProcess> {
  const fd = openSync(logFile, "a");
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  if (child.pid === undefined) {
    const [error] = await once(child, "error");
    throw new UiError(`Couldn't start ${command}: ${String(error)}`);
  }
  owned.add(child.pid);
  return child;
}

/** Runs a `banki` CLI command against the stack's data directory. */
async function banki(
  args: string[],
  { env, input, signal }: { env: NodeJS.ProcessEnv; input?: string; signal: AbortSignal },
): Promise<void> {
  signal.throwIfAborted();
  const child = spawn("bun", ["src/cli.ts", ...args], {
    cwd: API_DIR,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  const failedToStart = once(child, "error").then(([error]) => {
    throw new UiError(`Couldn't run banki ${args[0]}: ${String(error)}`);
  });
  if (child.pid !== undefined) owned.add(child.pid);
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  child.stdin.end(input);
  const kill = () => child.pid !== undefined && signalGroup(child.pid, "SIGKILL");
  signal.addEventListener("abort", kill);
  try {
    const [code] = await Promise.race([exited, failedToStart]);
    signal.throwIfAborted();
    if (code !== 0) throw new UiError(`banki ${args[0]} exited with code ${code}:\n${output}`);
  } finally {
    signal.removeEventListener("abort", kill);
    if (child.pid !== undefined) owned.delete(child.pid);
  }
}

/** Polls `check` until it passes, failing when `child` exits or the time runs out. */
async function waitFor(
  what: string,
  check: () => Promise<boolean>,
  { child, logFile, signal }: { child: ChildProcess; logFile: string; signal: AbortSignal },
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new UiError(`${what} exited while starting. Its log:\n${tail(logFile)}`);
    }
    if (await check().catch(() => false)) return;
    await sleep(250, undefined, { signal });
  }
  throw new UiError(
    `${what} didn't start within ${START_TIMEOUT_MS / 1000} s. Its log:\n${tail(logFile)}`,
  );
}

const answers = async (url: string, signal: AbortSignal) =>
  (await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) })).ok;

/**
 * One run's stack. `start` starts it, `teardown` stops whatever it started and
 * deletes its data directory (safe to call at any point, and more than once),
 * and `handOver` leaves it running for `ui down` to stop.
 */
export class Stack {
  apiPort = 0;
  webPort = 0;
  url = "";
  dataDir: string | undefined;
  api: ChildProcess | undefined;
  web: ChildProcess | undefined;
  /** In signed-in mode: the Playwright storage state of a signed-in browser. */
  signedInState: string | undefined;
  /** In before-setup mode: the Setup link the API logged. */
  setupLink: SetupLink | undefined;

  get logs() {
    const dir = this.dataDir ?? UI_DIR;
    return { api: join(dir, "api.log"), web: join(dir, "web.log") };
  }

  async start({ mode, watch, signal }: { mode: ShootMode; watch: boolean; signal: AbortSignal }) {
    [this.apiPort, this.webPort] = await freePorts();
    this.url = webUrl(this.webPort);
    this.dataDir = join(UI_DIR, dataDirName(process.pid, new Date()));
    mkdirSync(this.dataDir, { recursive: true });
    const place = { dataDir: this.dataDir, apiPort: this.apiPort, webPort: this.webPort };
    const env = apiEnv(process.env, place);

    if (mode !== "before-setup") {
      console.log(`Setting up ${this.dataDir} with Seed data`);
      await banki(["setup", "--email", EMAIL, "--password-stdin"], {
        env,
        input: `${PASSWORD}\n`,
        signal,
      });
      await banki(["seed"], { env, signal });
    }

    console.log(`Starting the API on ${this.apiPort} and Vite on ${this.url}`);
    this.api = await spawnGroup("bun", watch ? ["--watch", "src/server.ts"] : ["src/server.ts"], {
      cwd: API_DIR,
      env,
      logFile: this.logs.api,
    });
    this.web = await spawnGroup(
      process.execPath,
      [VITE_BIN, "--port", String(this.webPort), "--strictPort"],
      { cwd: WEB_DIR, env: webEnv(process.env, place), logFile: this.logs.web },
    );
    await waitFor("The API", () => answers(`http://localhost:${this.apiPort}/api/health`, signal), {
      child: this.api,
      logFile: this.logs.api,
      signal,
    });
    // Through Vite's proxy, so both are up and wired together.
    await waitFor("Vite", () => answers(`${this.url}/api/health`, signal), {
      child: this.web,
      logFile: this.logs.web,
      signal,
    });

    if (mode === "before-setup") {
      const logFile = this.logs.api;
      await waitFor(
        "The API's Setup token",
        async () =>
          (this.setupLink = setupLinkFromLog(readFileSync(logFile, "utf8"))) !== undefined,
        { child: this.api, logFile, signal },
      );
    } else if (mode === "signed-in") {
      this.signedInState = join(this.dataDir, "signed-in.json");
      await signIn(this.url, this.signedInState);
    }
  }

  async teardown(): Promise<void> {
    const pgids = [this.api?.pid, this.web?.pid].filter((pid) => pid !== undefined);
    if (pgids.length > 0) await stopGroups(pgids);
    this.api = this.web = undefined;
    if (this.dataDir !== undefined) rmSync(this.dataDir, { recursive: true, force: true });
    this.dataDir = undefined;
  }

  /** Leaves the processes running after this script exits, and returns what `ui down` needs. */
  handOver(mode: UpMode): StackFile {
    const { api, web, dataDir } = this;
    if (api?.pid === undefined || web?.pid === undefined || dataDir === undefined) {
      throw new Error("The stack isn't running.");
    }
    const common = {
      url: this.url,
      apiPort: this.apiPort,
      webPort: this.webPort,
      pids: { api: api.pid, web: web.pid },
      dataDir,
      logs: this.logs,
    };
    let file: StackFile;
    if (mode === "signed-in" && this.signedInState !== undefined) {
      file = { mode, ...common, signedInState: this.signedInState };
    } else if (mode === "before-setup" && this.setupLink !== undefined) {
      file = { mode, ...common, setupUrl: this.setupLink.url };
    } else {
      throw new Error(`The stack didn't start in ${mode} mode.`);
    }
    writeStackFile(file);
    for (const child of [api, web]) child.unref();
    owned.delete(api.pid);
    owned.delete(web.pid);
    this.api = this.web = undefined;
    this.dataDir = undefined;
    return file;
  }
}

/** Signs the stack's User in through Vite and saves the browser state to `path`. */
async function signIn(url: string, path: string): Promise<void> {
  const context = await request.newContext({ baseURL: url, extraHTTPHeaders: { origin: url } });
  try {
    const res = await context.post("/api/auth/sign-in/email", {
      data: { email: EMAIL, password: PASSWORD },
    });
    if (!res.ok())
      throw new UiError(`Signing in answered HTTP ${res.status()}: ${await res.text()}`);
    const me = await context.get("/api/me");
    if (!me.ok()) throw new UiError(`GET /api/me after signing in answered HTTP ${me.status()}`);
    await context.storageState({ path });
  } finally {
    await context.dispose();
  }
}

function writeStackFile(file: StackFile): void {
  const temporary = `${STACK_FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temporary, STACK_FILE);
}

/** Rewrites stack.json with the latest Setup link, since a restart of the API replaces the token. */
export function refreshSetupUrl(file: StackFile): StackFile {
  if (file.mode !== "before-setup") return file;
  let log = "";
  try {
    log = readFileSync(file.logs.api, "utf8");
  } catch {
    return file;
  }
  const link = setupLinkFromLog(log);
  if (link === undefined || link.url === file.setupUrl) return file;
  const refreshed = { ...file, setupUrl: link.url };
  writeStackFile(refreshed);
  return refreshed;
}

/** The command line of a running process, or undefined if there is none. */
function commandLine(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Whether the stack in stack.json is running: both its processes are, and are
 * still the API and Vite (not other processes that got the same PIDs since).
 */
export function recordedStackRunning(file: StackFile): boolean {
  return isRecorded(file.pids.api, "src/server.ts") && isRecorded(file.pids.web, "vite");
}

/** Whether `pid` runs and its command line has `marker`: a recorded process, not a stranger. */
const isRecorded = (pid: number, marker: string) =>
  isAlive(pid) && commandLine(pid)?.includes(marker) === true;

/** stack.json as `ui up` wrote it; `"corrupt"` when it exists but can't be read. */
export function readStackFile(): StackFile | "corrupt" | undefined {
  if (!existsSync(STACK_FILE)) return undefined;
  return parseStackFile(readFileSync(STACK_FILE, "utf8")) ?? "corrupt";
}

/** Stops a recorded stack (whatever of it still runs), deletes its data and stack.json. */
export async function stopRecordedStack(file: StackFile): Promise<void> {
  const pgids = [
    ...(isRecorded(file.pids.api, "src/server.ts") ? [file.pids.api] : []),
    ...(isRecorded(file.pids.web, "vite") ? [file.pids.web] : []),
  ];
  if (pgids.length > 0) await stopGroups(pgids);
  // Only ever a folder under .ui/, whatever stack.json says.
  if (resolve(file.dataDir).startsWith(`${UI_DIR}/`)) {
    rmSync(file.dataDir, { recursive: true, force: true });
  }
  removeStackFile();
}

export function removeStackFile(): void {
  rmSync(STACK_FILE, { force: true });
}

/** Deletes the data folders under .ui/ that no process is using; returns their names. */
export function removeStrayDataDirs(): string[] {
  if (!existsSync(UI_DIR)) return [];
  const stray = readdirSync(UI_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isStrayDataDir(entry.name, isAlive))
    .map((entry) => entry.name);
  for (const name of stray) rmSync(join(UI_DIR, name), { recursive: true, force: true });
  return stray;
}
