import type { UpMode } from "./args.ts";

/** What `ui up` records in `.ui/stack.json` about the stack it started. */
export type StackFile = {
  /** The URL of the web app (Vite), which proxies /api to the API. */
  url: string;
  apiPort: number;
  webPort: number;
  /** Each process leads its own process group, which `ui down` stops. */
  pids: { api: number; web: number };
  dataDir: string;
  logs: { api: string; web: string };
} & (
  | {
      mode: "signed-in";
      /** A Playwright storage state, for `playwright-cli state-load`. */
      signedInState: string;
    }
  | {
      mode: "before-setup";
      /** The link to Setup, with the Setup token. */
      setupUrl: string;
    }
);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;

const isPid = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/** The stack.json written by `ui up`, or undefined when the text isn't one. */
export function parseStackFile(text: string): StackFile | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  const { mode, url, apiPort, webPort, pids, dataDir, logs } = value;
  if (
    typeof url !== "string" ||
    !isPort(apiPort) ||
    !isPort(webPort) ||
    !isObject(pids) ||
    !isPid(pids["api"]) ||
    !isPid(pids["web"]) ||
    typeof dataDir !== "string" ||
    !isObject(logs) ||
    typeof logs["api"] !== "string" ||
    typeof logs["web"] !== "string"
  ) {
    return undefined;
  }
  const common = {
    url,
    apiPort,
    webPort,
    pids: { api: pids["api"], web: pids["web"] },
    dataDir,
    logs: { api: logs["api"], web: logs["web"] },
  };
  const { signedInState, setupUrl } = value;
  if (mode === "signed-in" && typeof signedInState === "string") {
    return { mode, ...common, signedInState };
  }
  if (mode === "before-setup" && typeof setupUrl === "string") {
    return { mode, ...common, setupUrl };
  }
  return undefined;
}

export type UpDecision =
  | { action: "start" }
  | { action: "reuse"; stack: StackFile }
  | { action: "mode-mismatch"; running: UpMode }
  | { action: "replace-stale"; stack: StackFile };

/**
 * What `ui up` does given the recorded stack (if any) and whether it is still
 * running: reuse it in the same mode, refuse another mode, or start one,
 * clearing away a recorded stack that has stopped.
 */
export function decideUp(stack: StackFile | undefined, running: boolean, mode: UpMode): UpDecision {
  if (stack === undefined) return { action: "start" };
  if (!running) return { action: "replace-stale", stack };
  if (stack.mode !== mode) return { action: "mode-mismatch", running: stack.mode };
  return { action: "reuse", stack };
}

/** A stack's data folder under `.ui/`, named after the `ui` process that creates it. */
export function dataDirName(pid: number, now: Date): string {
  return `data-${pid}-${now.getTime().toString(36)}`;
}

/**
 * The process groups a stack started, which it records in its data folder as
 * it starts them, so `ui down` can find the stack even without stack.json,
 * and the root whose code it runs.
 */
export type StackProcesses = { api?: number; web?: number; root?: string };

/** The processes file of a data folder; whatever it can't read is left out. */
export function parseStackProcesses(text: string): StackProcesses {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isObject(value)) return {};
  const processes: StackProcesses = {};
  if (isPid(value["api"])) processes.api = value["api"];
  if (isPid(value["web"])) processes.web = value["web"];
  if (typeof value["root"] === "string") processes.root = value["root"];
  return processes;
}

/** A base worktree of `ui compare`, `.base-<12-char sha>`. */
const BASE_WORKTREE = /\/\.base-[0-9a-f]{12}$/;

/**
 * The root whose stack processes `ui down` may stop for a data folder: the one
 * it records when that is this worktree (`ownRoot`) or a base worktree, and
 * otherwise this worktree.
 */
export function stackRoot(processes: StackProcesses, ownRoot: string): string {
  const { root } = processes;
  return root !== undefined && (root === ownRoot || BASE_WORKTREE.test(root)) ? root : ownRoot;
}

export type DataDirFate =
  /** A `ui` run is still using it. */
  | { action: "keep" }
  /** Stop these process groups (the stack's API and Vite), then delete the folder. */
  | { action: "remove"; stop: number[] };

/**
 * What `ui down` does with a folder under `.ui/`, or undefined when it isn't
 * a data folder. While the `ui` run that created it is going (a `ui shoot`, or
 * a `ui up` still starting), it is kept. Otherwise it goes, but its stack is
 * stopped first: a `ui up` exits once it hands its stack over, so a stack whose
 * stack.json is lost or unreadable still runs from a folder like this.
 */
export function dataDirFate(
  name: string,
  {
    creatorRunning,
    processes,
    isStackProcess,
  }: {
    /** Whether `pid` is a running `ui` process. */
    creatorRunning: (pid: number) => boolean;
    processes: StackProcesses;
    /** Whether `pgid` is still running as this stack's API or Vite. */
    isStackProcess: (pgid: number, role: "api" | "web") => boolean;
  },
): DataDirFate | undefined {
  if (!name.startsWith("data-")) return undefined;
  const creator = /^data-(\d+)-/.exec(name)?.[1];
  if (creator !== undefined && creatorRunning(Number(creator))) return { action: "keep" };
  const stop: number[] = [];
  for (const role of ["api", "web"] as const) {
    const pgid = processes[role];
    if (pgid !== undefined && isStackProcess(pgid, role)) stop.push(pgid);
  }
  return { action: "remove", stop };
}
