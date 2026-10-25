import { describe, expect, test } from "bun:test";
import { logPage, shownLines } from "./log-page";
import { collapse, ticksPage } from "./ticks-page";

// The Stage-log page and the tick log's page.

const event = (fields: Record<string, unknown>) => JSON.stringify(fields);
const LINES = [
  event({ type: "runner", at: "2026-10-24T01:00:00.000Z", event: "start", argv: ["claude"] }),
  event({ type: "system", subtype: "init", model: "m", session_id: "s", mcp_servers: [] }),
  event({
    type: "assistant",
    message: { content: [{ type: "text", text: "<script>alert(1)</script> done" }] },
  }),
  event({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Bash",
          input: { command: `echo ${["ghs", "x".repeat(30)].join("_")}` },
        },
      ],
    },
  }),
  event({ type: "runner", at: "2026-10-24T01:05:00.000Z", event: "exit", exitCode: 0 }),
];

describe("a Stage log's page", () => {
  test("shows one line per event, never the raw JSON", () => {
    expect(shownLines("a.jsonl", LINES)).toEqual([
      "start: m, session s, no MCP server",
      "say: <script>alert(1)</script> done",
      `tool: Bash echo ${["ghs", "x".repeat(30)].join("_")}`,
      "claude exited 0",
    ]);
    expect(shownLines("a.log", ["one", "", "two"])).toEqual(["one", "two"]);
  });

  test("escapes and redacts every line, then shows the Stage's result", () => {
    const text = logPage(
      {
        issue: "BAN-11",
        file: "a.jsonl",
        lines: shownLines("a.jsonl", LINES),
        skipped: 0,
        offset: 100,
        running: false,
        attempt: {
          type: "attempt",
          at: "2026-10-24T01:00:00.000Z",
          endedAt: "2026-10-24T01:05:00.000Z",
          stage: "design",
          label: "no-result",
          reason: "It ended without a result the Runner can use.",
          usd: 1.5,
          durationMs: 300_000,
          runs: [],
        },
      },
      "UTC",
    );

    expect(text).toContain("say: &lt;script&gt;alert(1)&lt;/script&gt; done");
    expect(text).not.toContain("<script>alert");
    expect(text).toContain("tool: Bash echo [redacted]");
    expect(text).not.toContain("ghs_");
    expect(text).not.toContain('"type"');
    expect(text.indexOf("claude exited 0")).toBeLessThan(text.indexOf("no result"));
    expect(text).toContain("It ended without a result the Runner can use.");
    expect(text).not.toContain("/live.js");
  });

  test("says how many earlier lines it left out, when it shows only the last ones", () => {
    const text = logPage(
      {
        issue: "BAN-11",
        file: "a.jsonl",
        lines: ["claude exited 0"],
        skipped: 31_337,
        offset: 9,
        running: false,
      },
      "UTC",
    );

    expect(text).toContain("The log's first 31337 lines are left out");
  });

  test("streams a running Stage's log from where the page ends", () => {
    const text = logPage(
      { issue: "BAN-12", file: "b.jsonl", lines: [], skipped: 0, offset: 4096, running: true },
      "UTC",
    );

    expect(text).toContain('data-stream="/issues/BAN-12/logs/b.jsonl/events?from=4096"');
    expect(text).toContain('<script src="/live.js" defer></script>');
    expect(text).toContain('<noscript><meta http-equiv="refresh" content="30"></noscript>');
  });
});

const at = (minute: number) => `2026-10-24T07:${String(minute).padStart(2, "0")}:00.000Z`;
const tick = (minute: number, line = "Tick on main abc1234") => ({
  at: at(minute),
  main: "abc1234",
  line,
});

describe("the tick log's page", () => {
  test("is newest first, with consecutive identical lines collapsed", () => {
    const lines = [tick(0), tick(5), tick(10), tick(10, "BAN-11: waiting"), tick(15), tick(20)];

    expect(collapse(lines)).toEqual([
      { line: "Tick on main abc1234", count: 2, first: at(15), last: at(20) },
      { line: "BAN-11: waiting", count: 1, first: at(10), last: at(10) },
      { line: "Tick on main abc1234", count: 3, first: at(0), last: at(10) },
    ]);
  });

  test("says how many times a line came, escaped and redacted", () => {
    const token = ["lin", "oauth", "0123456789abcdef0123"].join("_");
    const text = ticksPage(
      [...Array.from({ length: 60 }, (_, i) => tick(i % 60)), tick(59, `<b>${token}</b>`)],
      "UTC",
    );

    expect(text).toContain('Tick on main abc1234 <span class="count">×60</span>');
    expect(text).toContain("&lt;b&gt;[redacted]&lt;/b&gt;");
  });
});
