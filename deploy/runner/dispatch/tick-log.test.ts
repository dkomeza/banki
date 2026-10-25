import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneTickLog, readTickLines, tickLogger, withinRetention } from "./tick-log";

// The tick log, /work/dispatcher/ticks.jsonl: what the tick and `run-now`
// print, kept 30 days for the Dashboard's /ticks.

const dir = mkdtempSync(join(tmpdir(), "banki-tick-log-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date("2026-11-30T12:00:00.000Z");
const line = (at: string, text: string) => JSON.stringify({ at, main: "abc1234", line: text });

describe("the tick log", () => {
  test("gets each line the tick logs, which it still prints", () => {
    const path = join(dir, "logged", "ticks.jsonl");
    const printed: string[] = [];
    const log = tickLogger({
      path,
      main: "abc1234def",
      print: (text) => printed.push(text),
      now: () => NOW,
    });

    log("Tick on main abc1234");
    log("BAN-11: waiting for the Slug Previews");

    expect(printed).toEqual(["Tick on main abc1234", "BAN-11: waiting for the Slug Previews"]);
    expect(readTickLines(path)).toEqual([
      { at: NOW.toISOString(), main: "abc1234def", line: "Tick on main abc1234" },
      { at: NOW.toISOString(), main: "abc1234def", line: "BAN-11: waiting for the Slug Previews" },
    ]);
  });

  test("still prints a line it can't append", () => {
    const printed: string[] = [];
    const log = tickLogger({
      path: "/dev/null/no/such/dir/ticks.jsonl",
      main: "",
      print: (text) => printed.push(text),
      now: () => NOW,
    });

    log("Tick on main (not fetched)");

    expect(printed[0]).toBe("Tick on main (not fetched)");
  });

  test("drops the lines older than 30 days, and keeps the rest as they were", () => {
    const path = join(dir, "pruned.jsonl");
    const kept = [
      line("2026-11-01T00:00:00.000Z", "kept"),
      line("2026-11-30T11:55:00.000Z", "new"),
    ];
    writeFileSync(path, [line("2026-10-30T11:00:00.000Z", "old"), ...kept, ""].join("\n"));

    expect(pruneTickLog(path, NOW)).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(`${kept.join("\n")}\n`);
    expect(pruneTickLog(path, NOW)).toBe(0);
  });

  test("drops what it can't read, and is nothing when there is no file", () => {
    const path = join(dir, "broken.jsonl");
    writeFileSync(path, `not json\n${line("2026-11-30T11:00:00.000Z", "ok")}\n`);

    expect(pruneTickLog(path, NOW)).toBe(1);
    expect(readTickLines(path).map((entry) => entry.line)).toEqual(["ok"]);
    expect(pruneTickLog(join(dir, "none.jsonl"), NOW)).toBe(0);
    expect(readTickLines(join(dir, "none.jsonl"))).toEqual([]);
  });

  test("keeps a line exactly 30 days old", () => {
    expect(withinRetention("2026-10-31T12:00:00.000Z", NOW)).toBe(true);
    expect(withinRetention("2026-10-31T11:59:59.000Z", NOW)).toBe(false);
  });
});
