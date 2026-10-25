import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeStarted, logFacts, logLines, logTail } from "./stage-log";

// What a Stage's log says: its session, its cost, whether the five-hour
// limit paused it, and its tail.

const REAL = readFileSync(join(import.meta.dir, "fixtures", "gate-reading.jsonl"), "utf8")
  .trim()
  .split("\n");
const init = JSON.stringify({
  type: "system",
  subtype: "init",
  model: "m",
  session_id: "sess-1",
  mcp_servers: [],
});
const rateLimit = (fiveHour: string, resetsAt = 1792853400) =>
  JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: {
      status: fiveHour,
      resetsAt,
      rateLimitType: "five_hour",
      unifiedWindows: {
        five_hour: { utilization: fiveHour === "rejected" ? 1 : 0.5, resetsAt, status: fiveHour },
        seven_day: { utilization: 0.4, resetsAt: 1793052000, status: "allowed" },
      },
    },
  });
const result = (fields: Record<string, unknown>) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: 1.25,
    ...fields,
  });

describe("a Stage's log", () => {
  test("gives its session and its dollar cost", () => {
    expect(logFacts([init, ...REAL])).toEqual({
      sessionId: "sess-1",
      costUsd: 0.0034515400000000003,
      fiveHourLimit: undefined,
    });
  });

  test("says the five-hour limit stopped it when a rate_limit_event rejects that window", () => {
    expect(
      logFacts([init, rateLimit("allowed"), rateLimit("rejected"), result({ is_error: true })])
        .fiveHourLimit,
    ).toEqual({
      resetsAt: "2026-10-24T14:50:00.000Z",
    });
  });

  test("says so for a result refused with a 429, with the window's reset time from earlier in the log", () => {
    const facts = logFacts([
      init,
      rateLimit("allowed"),
      result({ is_error: true, api_error_status: 429 }),
    ]);

    expect(facts.fiveHourLimit).toEqual({ resetsAt: "2026-10-24T14:50:00.000Z" });
  });

  test("says nothing of a limit for a Stage that ended on its own, or failed otherwise", () => {
    expect(logFacts([init, rateLimit("allowed"), result({})]).fiveHourLimit).toBeUndefined();
    expect(
      logFacts([init, result({ is_error: true, result: "Tool failed" })]).fiveHourLimit,
    ).toBeUndefined();
  });

  test("doesn't take the weekly limit for the five-hour one", () => {
    const weekly = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        rateLimitType: "seven_day",
        unifiedWindows: { seven_day: { utilization: 1, resetsAt: 1793052000, status: "rejected" } },
      },
    });

    expect(
      logFacts([init, weekly, result({ is_error: true, api_error_status: 429 })]).fiveHourLimit,
    ).toBeUndefined();
  });
});

describe("a log's tail", () => {
  test("is its last events as one line each, never the raw JSON", () => {
    const lines = [
      init,
      JSON.stringify({ type: "runner", event: "start", argv: ["claude"] }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }] },
      }),
      JSON.stringify({ type: "runner", event: "stderr", line: "warning: x" }),
      result({}),
      JSON.stringify({ type: "runner", event: "exit", exitCode: 0 }),
    ];

    expect(logTail(lines)).toEqual([
      "start: m, session sess-1, no MCP server",
      "tool: Bash bun test",
      "[stderr] warning: x",
      "end: success, $1.25",
      "claude exited 0",
    ]);
  });

  test("keeps only the last 30", () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: `step ${i}` }] },
      }),
    );

    expect(logTail(lines)).toHaveLength(30);
    expect(logTail(lines)[0]).toBe("say: step 10");
  });
});

const runner = (fields: Record<string, unknown>) =>
  JSON.stringify({ type: "runner", at: "2026-10-24T01:00:00.000Z", ...fields });

describe("a whole log, for the Dashboard", () => {
  test("is every event as one line, by the tail's rules, however long it is", () => {
    const lines = [
      runner({ event: "start", argv: ["claude", "-p", "x"] }),
      init,
      ...Array.from({ length: 40 }, () =>
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
      ),
      runner({ event: "stderr", line: "warn: x" }),
      runner({ event: "exit", exitCode: 0, signal: null }),
      "",
    ];

    const shown = logLines(lines);

    expect(shown).toHaveLength(43);
    expect(shown[0]).toBe("start: m, session sess-1, no MCP server");
    expect(shown.slice(-2)).toEqual(["[stderr] warn: x", "claude exited 0"]);
  });

  test("says whether claude started: an init event, after the Runner's own", () => {
    expect(claudeStarted([runner({ event: "start", argv: [] }), init])).toBe(true);
    expect(
      claudeStarted([
        runner({ event: "start", argv: [] }),
        runner({ event: "stderr", line: "Error: spawn claude ENOENT" }),
        runner({ event: "exit", exitCode: 1, signal: null }),
      ]),
    ).toBe(false);
    expect(claudeStarted([])).toBe(false);
  });
});
