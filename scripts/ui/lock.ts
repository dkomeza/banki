import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

/** A lock someone else held for longer than the caller would wait. */
export class LockTimeout extends Error {
  override name = "LockTimeout";
}

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** The holder's PID, from the lock's `<pid>:<random>`. */
const holderPid = (contents: string): number | undefined => {
  const pid = Number(contents.split(":", 1)[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
};

/** Removes the lock only while it still holds `contents`, so never someone else's. */
const removeIfStill = (path: string, contents: string) => {
  if (read(path) === contents) rmSync(path, { force: true });
};

/**
 * Runs `body` while holding an exclusive lock file at `path` (created with
 * O_EXCL, holding `<pid>:<random>`). Another holder makes it wait; a lock
 * whose holder is no longer running is taken over. The lock is removed when
 * `body` settles, whether it succeeds or throws.
 */
export async function withLock<T>(
  path: string,
  body: () => Promise<T>,
  {
    isHolderRunning,
    signal,
    onWait,
    pollMs = 200,
    timeoutMs,
  }: {
    isHolderRunning: (pid: number) => boolean;
    signal: AbortSignal;
    /** Called once, when the lock turns out to be held by someone else. */
    onWait?: (pid: number | undefined) => void;
    pollMs?: number;
    timeoutMs: number;
  },
): Promise<T> {
  const contents = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + timeoutMs;
  let waiting = false;
  for (;;) {
    signal.throwIfAborted();
    try {
      writeFileSync(path, contents, { flag: "wx" });
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const current = read(path);
    if (current === undefined) continue;
    const holder = holderPid(current);
    // Empty: its holder has created it and is still writing its PID.
    if (current !== "" && (holder === undefined || !isHolderRunning(holder))) {
      removeIfStill(path, current);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new LockTimeout(
        `Another ui command (process ${holder ?? "unknown"}) is still running in this worktree.`,
      );
    }
    if (!waiting) onWait?.(holder);
    waiting = true;
    await sleep(pollMs, undefined, { signal }).catch(() => signal.throwIfAborted());
  }
  try {
    return await body();
  } finally {
    removeIfStill(path, contents);
  }
}
