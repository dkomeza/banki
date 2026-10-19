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

/** A stack's data folder under `.ui/`, named after the process that creates it. */
export function dataDirName(pid: number, now: Date): string {
  return `data-${pid}-${now.getTime().toString(36)}`;
}

/**
 * Whether a folder under `.ui/` is a data folder nobody is using: one whose
 * creating process has gone (a `ui shoot` that was killed, or a `ui up` whose
 * stack.json is lost). A running `ui shoot`'s folder is not stray.
 */
export function isStrayDataDir(name: string, isAlive: (pid: number) => boolean): boolean {
  if (!name.startsWith("data-")) return false;
  const pid = /^data-(\d+)-/.exec(name)?.[1];
  return pid === undefined || !isAlive(Number(pid));
}
