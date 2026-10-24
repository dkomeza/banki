import { describe, expect, test } from "bun:test";
import {
  type ActiveRecord,
  crashStop,
  ending,
  reconcile,
  STAGE_LIMIT_MS,
  statusBefore,
  timeLeft,
} from "./lifecycle";
import { STATUS } from "./select";
import type { LogFacts } from "./stage-log";

// A Stage's life under its supervisor: how a run ends, the time it has left,
// pausing and resuming, and what a crash restores.

const NOW = new Date("2026-10-24T03:00:00.000Z");
const plain: LogFacts = { sessionId: "sess-1", costUsd: 2, fiveHourLimit: undefined };
const result = {
  stage: "implement",
  issue: "BAN-7",
  outcome: "done",
  nextStatus: "In Review",
  summary: "Opened PR #3.",
};
const end = (fields: Partial<Parameters<typeof ending>[0]>) =>
  ending({
    kind: "implement",
    issue: "BAN-7",
    result: undefined,
    timedOut: false,
    exitCode: 0,
    log: plain,
    now: NOW,
    ...fields,
  });

describe("how a run ends", () => {
  test("with the Stage's result, which its closing comment posts", () => {
    expect(end({ result })).toMatchObject({
      type: "closing",
      result: { outcome: "done", nextStatus: "In Review" },
      json: result,
    });
  });

  test("paused, when the five-hour limit cut it short, until that window starts over", () => {
    const log = { ...plain, fiveHourLimit: { resetsAt: "2026-10-24T05:00:00.000Z" } };

    expect(end({ exitCode: 1, log })).toEqual({
      type: "paused",
      resetsAt: "2026-10-24T05:00:00.000Z",
    });
  });

  test("paused for an hour when the log doesn't say when the window starts over", () => {
    expect(end({ exitCode: 1, log: { ...plain, fiveHourLimit: { resetsAt: undefined } } })).toEqual(
      {
        type: "paused",
        resetsAt: "2026-10-24T04:00:00.000Z",
      },
    );
  });

  test("as a timeout past the limit, whatever else it did", () => {
    expect(end({ timedOut: true, result })).toMatchObject({ type: "crash", outcome: "timed-out" });
  });

  test("as a crash without a result, or with another Stage's", () => {
    expect(end({ exitCode: 1 })).toMatchObject({ type: "crash", outcome: "no-result" });
    const other = end({ result: { ...result, stage: "design" } });

    expect(other).toMatchObject({ type: "crash", outcome: "no-result" });
    expect(other.type === "crash" ? other.why : "").toContain("the design Stage on BAN-7");
  });
});

describe("the time a Stage has left", () => {
  test("is 3 hours less the time its earlier runs ran, its pauses aside", () => {
    const runs = [
      {
        startedAt: "2026-10-24T01:00:00.000Z",
        endedAt: "2026-10-24T02:00:00.000Z",
        log: "",
        before: null,
      },
      {
        startedAt: "2026-10-24T06:00:00.000Z",
        endedAt: "2026-10-24T06:30:00.000Z",
        log: "",
        before: null,
      },
      { startedAt: "2026-10-24T07:00:00.000Z", log: "", before: null },
    ];

    expect(timeLeft(runs)).toBe(STAGE_LIMIT_MS - 90 * 60_000);
    expect(timeLeft([])).toBe(STAGE_LIMIT_MS);
  });
});

const record = (fields: Partial<ActiveRecord>): ActiveRecord => ({
  issue: "BAN-7",
  kind: "implement",
  state: "running",
  pid: 42,
  runs: [],
  ...fields,
});

describe("an active record, each tick", () => {
  test("is running while its supervisor is", () => {
    expect(reconcile(record({}), true, STATUS.inProgress, NOW)).toEqual({ type: "running" });
  });

  test("crashed when its supervisor is gone", () => {
    expect(reconcile(record({}), false, STATUS.inProgress, NOW)).toEqual({ type: "crashed" });
    expect(reconcile(record({}), false, STATUS.todo, NOW)).toEqual({ type: "crashed" });
  });

  test("paused until its reset time, and due from then", () => {
    const paused = record({ state: "paused", pid: null, resetsAt: "2026-10-24T03:30:00.000Z" });

    expect(reconcile(paused, false, STATUS.inProgress, NOW)).toEqual({
      type: "paused",
      due: false,
    });
    expect(
      reconcile(paused, false, STATUS.inProgress, new Date("2026-10-24T03:30:00.000Z")),
    ).toEqual({
      type: "paused",
      due: true,
    });
  });

  test("left behind once its issue isn't In Progress any more", () => {
    const paused = record({ state: "paused", pid: null, resetsAt: "2026-10-24T03:30:00.000Z" });

    expect(reconcile(paused, false, STATUS.todo, NOW).type).toBe("abandoned");
  });
});

describe("after a crash", () => {
  test("the status from before In Progress comes back", () => {
    const history = [
      { at: "2026-10-23T01:00:00.000Z", from: STATUS.todo, to: STATUS.inProgress },
      { at: "2026-10-23T02:00:00.000Z", from: STATUS.inProgress, to: STATUS.inReview },
      { at: "2026-10-24T01:00:00.000Z", from: STATUS.inReview, to: STATUS.inProgress },
    ];

    expect(statusBefore(history)).toBe(STATUS.inReview);
    expect(statusBefore([])).toBeUndefined();
  });

  test("the stop is the Stage's own, so a reply runs it again", () => {
    expect(
      crashStop({
        kind: "review-round",
        issue: "BAN-7",
        status: STATUS.inReview,
        why: "It crashed.",
      }),
    ).toMatchObject({
      stage: "review-round",
      outcome: "stopped",
      nextStatus: STATUS.inReview,
      wait: null,
      summary: "It crashed.",
    });
  });
});
