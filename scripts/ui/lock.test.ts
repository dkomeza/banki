import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { withLock } from "./lock.ts";

const dir = mkdtempSync(join(tmpdir(), "ui-lock-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const lockPath = () => join(dir, `up-${n++}.lock`);

const options = {
  isHolderRunning: () => true,
  signal: new AbortController().signal,
  pollMs: 10,
  timeoutMs: 2000,
};

describe("withLock", () => {
  test("holds the lock file while the body runs, and removes it after", async () => {
    const path = lockPath();
    const seen = await withLock(path, () => Promise.resolve(readFileSync(path, "utf8")), options);
    assert.match(seen, new RegExp(`^${process.pid}:`));
    assert.equal(existsSync(path), false);
  });

  test("releases the lock when the body throws", async () => {
    const path = lockPath();
    await assert.rejects(
      withLock(path, () => Promise.reject(new Error("boom")), options),
      /boom/,
    );
    assert.equal(existsSync(path), false);
  });

  test("a second holder waits until the first is done", async () => {
    const path = lockPath();
    const order: string[] = [];
    let waited = false;
    const first = withLock(
      path,
      async () => {
        order.push("first starts");
        await sleep(100);
        order.push("first ends");
      },
      options,
    );
    await sleep(10);
    const second = withLock(
      path,
      () => {
        order.push("second runs");
        return Promise.resolve();
      },
      { ...options, onWait: () => (waited = true) },
    );
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first starts", "first ends", "second runs"]);
    assert.equal(waited, true);
  });

  test("takes over a lock whose holder is no longer running", async () => {
    const path = lockPath();
    writeFileSync(path, "999999:stale");
    const ran = await withLock(path, () => Promise.resolve(true), {
      ...options,
      isHolderRunning: (pid) => pid !== 999999,
    });
    assert.equal(ran, true);
    assert.equal(existsSync(path), false);
  });

  test("gives up with a clear message when the holder keeps it", async () => {
    const path = lockPath();
    writeFileSync(path, "4242:busy");
    await assert.rejects(
      withLock(path, () => Promise.resolve(), { ...options, timeoutMs: 50 }),
      /Another ui command \(process 4242\)/,
    );
    assert.equal(readFileSync(path, "utf8"), "4242:busy");
  });

  test("gives up with the caller's message for the lock it holds", async () => {
    const path = lockPath();
    writeFileSync(path, "4242:busy");
    await assert.rejects(
      withLock(path, () => Promise.resolve(), {
        ...options,
        timeoutMs: 50,
        timeoutMessage: (pid) => `Another ui compare (process ${pid ?? "unknown"}) is using it.`,
      }),
      (error) =>
        error instanceof Error &&
        error.name === "LockTimeout" &&
        error.message === "Another ui compare (process 4242) is using it.",
    );
  });

  test("stops waiting when the run is interrupted", async () => {
    const path = lockPath();
    writeFileSync(path, "4242:busy");
    const interrupt = new AbortController();
    const waiting = withLock(path, () => Promise.resolve(), {
      ...options,
      signal: interrupt.signal,
    });
    interrupt.abort(new Error("interrupted"));
    await assert.rejects(waiting, /interrupted/);
    assert.equal(readFileSync(path, "utf8"), "4242:busy");
  });
});
