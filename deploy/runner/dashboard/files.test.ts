import { afterAll, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { claudeStarted, logFacts } from "../dispatch/stage-log";
import { logTail, readChunk, readHead, readTail } from "./files";
import { runFacts } from "./volume";

// A Stage writes its logs, so the Dashboard never reads one whole: its head,
// its tail, or the next chunk of it, within bounds.

const dir = mkdtempSync(join(tmpdir(), "banki-dashboard-files-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const init = JSON.stringify({ type: "system", subtype: "init", model: "m", session_id: "s" });
const say = (i: number) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: `line ${i} ${"x".repeat(200)}` }] },
  });
const result = JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 4.25 });

/** A log of `count` events between its init and its result: about 250 bytes each. */
function bigLog(name: string, count: number): string {
  const path = join(dir, name);
  const lines = [init, ...Array.from({ length: count }, (_, i) => say(i)), result];
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

describe("a log over the bounds", () => {
  const path = bigLog("big.jsonl", 20_000);

  test("still says whether claude started, from its head, and its cost, from its tail", () => {
    expect(claudeStarted(readHead(path, 4096))).toBe(true);
    expect(logFacts(readTail(path, 4096)).costUsd).toBe(4.25);
    expect(readTail(path, 4096).length).toBeLessThan(20);
  });

  test("gives the issue page its facts, read within the default bounds", () => {
    const file = "2026-10-24T00-00-00Z-design.jsonl";
    bigLog(file, 20_000);

    expect(Bun.file(join(dir, file)).size).toBeGreaterThan(4 << 20);
    expect(runFacts(join(dir, ".."), [`/work/logs/${basename(dir)}/${file}`])[file]).toEqual({
      exists: true,
      started: true,
      costUsd: 4.25,
    });
  });

  test("gives its page its last lines only, and how many bytes come before them", () => {
    const tail = logTail(path, 100, 1 << 20);
    const size = Bun.file(path).size;

    expect(tail.lines).toHaveLength(100);
    expect(tail.lines.at(-1)).toBe(result);
    expect(tail.lines[0]).toBe(say(19_901));
    // The bytes before its first line shown: the whole lines after it, and their newlines.
    expect(tail.leftOutBytes).toBe(size - Buffer.byteLength(`${tail.lines.join("\n")}\n`));
    expect(tail.end).toBe(size);
  });

  test("keeps its page within the bytes when the lines would go over them", () => {
    const tail = logTail(path, 100_000, 10_000);

    expect(tail.lines.length).toBeLessThan(50);
    expect(tail.lines.at(-1)).toBe(result);
    expect(tail.leftOutBytes).toBeGreaterThan(Bun.file(path).size - 10_000);
  });

  test("leaves nothing out of a log within the bounds, and counts what the lines leave out", () => {
    const small = join(dir, "small.log");
    writeFileSync(small, "one\ntwo\n");

    expect(logTail(small)).toEqual({ lines: ["one", "two"], leftOutBytes: 0, end: 8 });
    expect(logTail(small, 1)).toEqual({ lines: ["two"], leftOutBytes: 4, end: 8 });
  });

  test("reads only its tail for its page, never the part it leaves out", () => {
    const read = spyOn(fs, "readSync");
    try {
      const tail = logTail(path, 100, 64 << 10);
      const bytes = read.mock.results.reduce((sum, call) => sum + Number(call.value), 0);

      expect(tail.leftOutBytes).toBeGreaterThan(4 << 20);
      expect(bytes).toBeLessThanOrEqual(64 << 10);
    } finally {
      read.mockRestore();
    }
  });
});

describe("a stream's next chunk", () => {
  test("is the whole lines from where it is, within the bound", () => {
    const path = join(dir, "chunk.log");
    writeFileSync(path, "one\ntwo\nthree\npart");

    expect(readChunk(path, 0, 9)).toEqual({
      lines: [
        { text: "one", end: 4 },
        { text: "two", end: 8 },
      ],
      end: 8,
      overlong: false,
    });
    expect(readChunk(path, 8, 100)).toEqual({
      lines: [{ text: "three", end: 14 }],
      end: 14,
      overlong: false,
    });
    expect(readChunk(path, 14, 100)).toEqual({ lines: [], end: 14, overlong: false });
  });

  test("says where each line ends in bytes, not characters", () => {
    const path = join(dir, "bytes.log");
    writeFileSync(path, "zażółć\nok\n");

    expect(readChunk(path, 0).lines).toEqual([
      { text: "zażółć", end: 11 },
      { text: "ok", end: 14 },
    ]);
  });

  test("passes over a line longer than the bound", () => {
    const path = join(dir, "long.log");
    writeFileSync(path, `${"y".repeat(50)}\nafter\n`);

    expect(readChunk(path, 0, 10)).toEqual({ lines: [], end: 10, overlong: true });
  });

  test("throws once its file is gone, for the stream to end", () => {
    expect(() => readChunk(join(dir, "gone.log"), 0)).toThrow();
  });
});
