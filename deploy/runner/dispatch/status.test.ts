import { describe, expect, test } from "bun:test";
import { renderStatus, type StatusView } from "./status";

// `runner status`'s text, pinned whole: the Dashboard shares its view, and
// this output mustn't change under it.

const NOW = new Date("2026-10-24T02:00:00.000Z");
const READING = {
  at: "2026-10-24T01:55:00.000Z",
  fiveHour: { utilization: 0.12, resetsAt: "2026-10-24T05:00:00.000Z" },
  sevenDay: { utilization: 0.4, resetsAt: "2026-10-27T00:00:00.000Z" },
};

const VIEW: StatusView = {
  now: NOW,
  closed: undefined,
  running: [
    {
      issue: "BAN-11",
      kind: "design",
      state: "running",
      pid: 7,
      runs: [
        {
          startedAt: "2026-10-24T00:47:00.000Z",
          log: "/work/logs/BAN-11/2026-10-24T00-47-00Z-design.jsonl",
          before: READING,
        },
      ],
    },
    { issue: "BAN-12", kind: "implement", state: "running", pid: null, runs: [] },
  ],
  paused: [
    {
      issue: "BAN-13",
      kind: "review-round",
      state: "paused",
      pid: null,
      runs: [],
      resetsAt: "2026-10-24T05:00:00.000Z",
      sessionId: "s-13",
    },
  ],
  queue: [
    {
      ready: {
        issue: "BAN-14",
        status: "Todo",
        priority: 2,
        createdAt: "2026-10-01T00:00:00.000Z",
        stage: "implement",
      },
      start: true,
      why: "starts",
    },
    {
      ready: {
        issue: "BAN-13",
        status: "In Progress",
        priority: 2,
        createdAt: "2026-10-01T00:00:00.000Z",
        stage: "review-round",
        resume: true,
      },
      start: false,
      why: "the five-hour window is at 85%, 80% at most",
    },
  ],
  waiting: [{ issue: "BAN-15", status: "In Review", what: "waiting for `claude-review`" }],
  gate: { reading: READING, at: READING.at },
  estimates: { design: 0.05, implement: 0.08, "review-round": 0.03, "acceptance-fix": 0.05 },
  recent: [
    {
      record: {
        issue: "BAN-10",
        kind: "implement",
        outcome: "done",
        endedAt: "2026-10-23T03:00:00.000Z",
        runs: [],
      },
      cost: 0.071,
    },
    {
      record: {
        issue: "BAN-9",
        kind: "design",
        outcome: "crashed",
        endedAt: "2026-10-23T02:00:00.000Z",
        runs: [
          { startedAt: "2026-10-23T01:00:00.000Z", log: "a", before: null },
          { startedAt: "2026-10-23T01:30:00.000Z", log: "b", before: null },
        ],
      },
      cost: undefined,
    },
  ],
  orphans: ["BAN-16"],
};

describe("runner status's text", () => {
  test("lists every section, as it always has", () => {
    expect(renderStatus(VIEW)).toBe(
      [
        "Running:",
        "  BAN-11 design, for 1 h 13 min, log /work/logs/BAN-11/2026-10-24T00-47-00Z-design.jsonl",
        "  BAN-12 implement, for a moment",
        "",
        "Paused:",
        "  BAN-13 review-round, by the five-hour limit until 2026-10-24T05:00:00.000Z, in session s-13",
        "",
        "Ready, in order:",
        "  BAN-14 implement: would start now",
        "  BAN-13 review-round (resume): waits: the five-hour window is at 85%, 80% at most",
        "",
        "Waiting:",
        "  BAN-15 (In Review): waiting for `claude-review`",
        "",
        "Gate:",
        "  at 2026-10-24T01:55:00.000Z: the week 40% (starts over 2026-10-27T00:00:00.000Z), the five hours 12% (starts over 2026-10-24T05:00:00.000Z)",
        "  estimates: design 5%, implement 8%, review-round 3%, acceptance-fix 5%",
        "",
        "Recent Stages:",
        "  2026-10-23T03:00:00.000Z BAN-10 implement: done, 7.1%",
        "  2026-10-23T02:00:00.000Z BAN-9 design: crashed, cost not known over 2 runs",
        "",
        "In Progress, not started by a supervisor of the Runner:",
        "  BAN-16",
      ].join("\n"),
    );
  });

  test("says when the window is closed, and when the gate's reading failed", () => {
    const text = renderStatus({
      ...VIEW,
      closed: "outside the window",
      running: [],
      paused: [],
      waiting: [],
      recent: [],
      orphans: [],
      gate: { error: "claude exited 1", at: "2026-10-24T01:00:00.000Z" },
    });

    expect(text).toContain(
      "Ready, in order (outside the window):\n  BAN-14 implement: would fit the gate\n",
    );
    expect(text).toContain("Running:\n  none\n");
    expect(text).toContain("the last reading failed at 2026-10-24T01:00:00.000Z: claude exited 1");
    expect(text).toContain("Recent Stages:\n  none yet\n");
  });
});
