import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActiveRecord } from "./lifecycle";
import { processAlive, store, supervisorAlive } from "./store";

// The Dispatcher's records on the volume, in a temporary directory.

const root = mkdtempSync(join(tmpdir(), "banki-dispatcher-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const fresh = () => store(mkdtempSync(join(root, "s-")));

const record = (issue: string, fields: Partial<ActiveRecord> = {}): ActiveRecord => ({
  issue,
  kind: "implement",
  state: "running",
  pid: process.pid,
  runs: [{ startedAt: "2026-10-24T01:00:00.000Z", log: "/work/logs/x.jsonl", before: null }],
  ...fields,
});

describe("the records", () => {
  test("keep the Stages running or paused, one each", () => {
    const records = fresh();
    records.saveActive(record("BAN-1"));
    records.saveActive(record("BAN-2", { state: "paused", pid: null }));
    records.saveActive(record("BAN-1", { pid: 7 }));

    expect(records.activeRecords().map((found) => [found.issue, found.pid])).toEqual([
      ["BAN-1", 7],
      ["BAN-2", null],
    ]);
  });

  test("move a Stage that ended to the ended ones, for its cost", () => {
    const records = fresh();
    records.saveActive(record("BAN-1"));
    records.finish({
      issue: "BAN-1",
      kind: "implement",
      outcome: "done",
      endedAt: "2026-10-24T02:00:00.000Z",
      runs: [],
    });

    expect(records.activeRecords()).toEqual([]);
    expect(records.stageRecords().map((found) => found.outcome)).toEqual(["done"]);
  });

  test("skip what they can't read", () => {
    const records = fresh();
    records.saveActive(record("BAN-1"));
    writeFileSync(join(records.dir, "active", "BAN-9.json"), "{ half");

    expect(records.activeRecords().map((found) => found.issue)).toEqual(["BAN-1"]);
  });
});

describe("the lock", () => {
  test("is held by one at a time, and free again once released", () => {
    const records = fresh();
    const release = records.lock();

    expect(release).toBeDefined();
    expect(records.lock()).toBeUndefined();
    release?.();
    expect(records.lock()).toBeDefined();
  });

  test("counts an empty lock, one being written, as held for a few seconds, and stale after", () => {
    const records = fresh();
    const path = join(records.dir, "lock");
    records.lock()?.();
    writeFileSync(path, "");

    expect(records.lock()).toBeUndefined();
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
    expect(records.lock()).toBeDefined();
  });

  test("is never seen empty: the pid is in it from the moment it exists", () => {
    const records = fresh();
    records.lock();

    expect(readFileSync(join(records.dir, "lock"), "utf8")).toBe(String(process.pid));
  });

  test("is taken over from a process that is gone", () => {
    const records = fresh();
    records.lock();
    writeFileSync(join(records.dir, "lock"), "999999");

    expect(records.lock()).toBeDefined();
  });
});

describe("a supervisor", () => {
  test("is alive while its process is", () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(999999)).toBe(false);
    expect(supervisorAlive(record("BAN-1", { pid: null }))).toBe(false);
    expect(supervisorAlive(record("BAN-1", { pid: 999999 }))).toBe(false);
  });
});
