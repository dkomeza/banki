import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GATE_ARGS, gateCheck, type Reading, readingFrom } from "./gate";

// The gate's reading and its arithmetic. The fixture is a real
// `claude -p "Reply with OK" --model haiku --output-format stream-json
// --verbose` run's rate_limit_event and result, with its IDs zeroed.

const FIXTURE = readFileSync(join(import.meta.dir, "fixtures", "gate-reading.jsonl"), "utf8");
const AT = new Date("2026-10-24T12:09:37Z");

const reading = (sevenDay: number, fiveHour = 0.1): Reading => ({
  at: AT.toISOString(),
  fiveHour: { utilization: fiveHour, resetsAt: "2026-10-24T15:30:00.000Z" },
  sevenDay: { utilization: sevenDay, resetsAt: "2026-10-27T01:00:00.000Z" },
});

describe("the gate's reading", () => {
  test("comes from a one-line Haiku call, streamed, with no MCP server, settings or session", () => {
    expect(GATE_ARGS).toEqual([
      "claude",
      "-p",
      "Reply with OK",
      "--model",
      "haiku",
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--no-session-persistence",
    ]);
  });

  test("is both windows' utilization and reset time, from the real event", () => {
    expect(readingFrom(FIXTURE, AT)).toEqual({
      at: "2026-10-24T12:09:37.000Z",
      fiveHour: { utilization: 0.05, resetsAt: "2026-10-24T14:50:00.000Z" },
      sevenDay: { utilization: 0.46, resetsAt: "2026-10-26T22:00:00.000Z" },
    });
  });

  test("fails when claude printed no rate_limit_event", () => {
    const withoutIt = FIXTURE.split("\n").filter((line) => !line.includes("rate_limit_event"));

    expect(() => readingFrom(withoutIt.join("\n"), AT)).toThrow("no rate_limit_event");
  });

  test("fails when a window lacks its utilization or reset time", () => {
    const event = JSON.parse(FIXTURE.split("\n")[0] ?? "");
    delete event.rate_limit_info.unifiedWindows.seven_day.utilization;

    expect(() => readingFrom(JSON.stringify(event), AT)).toThrow("seven_day.utilization");
  });
});

describe("the gate", () => {
  test("lets a Stage start when the week, the Stages running and its own estimate stay within the Ceiling", () => {
    expect(
      gateCheck({ reading: reading(0.5), ceiling: 0.6, running: [0.05], estimate: 0.05 }),
    ).toEqual({ ok: true });
  });

  test("keeps it from starting when they would go over", () => {
    const check = gateCheck({
      reading: reading(0.52),
      ceiling: 0.6,
      running: [0.05],
      estimate: 0.05,
    });

    expect(check.ok).toBe(false);
    expect(check.ok ? "" : check.why).toContain("over the Ceiling of 60%");
  });

  test("keeps everything from starting at 80% of the five-hour window", () => {
    expect(
      gateCheck({ reading: reading(0.1, 0.79), ceiling: 0.6, running: [], estimate: 0.05 }).ok,
    ).toBe(true);
    const check = gateCheck({
      reading: reading(0.1, 0.8),
      ceiling: 0.6,
      running: [],
      estimate: 0.05,
    });

    expect(check.ok).toBe(false);
    expect(check.ok ? "" : check.why).toContain("five-hour window is at 80%");
  });

  test("skips only the Ceiling when forced", () => {
    expect(
      gateCheck({ reading: reading(0.9), ceiling: 0.6, running: [], estimate: 0.05, force: true }),
    ).toEqual({ ok: true });
    expect(
      gateCheck({
        reading: reading(0.9, 0.85),
        ceiling: 0.6,
        running: [],
        estimate: 0.05,
        force: true,
      }).ok,
    ).toBe(false);
  });
});
