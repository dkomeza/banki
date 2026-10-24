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
import type { StageKind } from "../cli/args";
import type { Closing } from "./closing";
import { parseResult } from "./result";
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

  test("as a crash when its result names a status its Stage can't send the issue to", () => {
    const outcome = end({ result: { ...result, nextStatus: "Acceptance" } });

    expect(outcome).toMatchObject({ type: "crash", outcome: "no-result" });
    expect(outcome.type === "crash" ? outcome.why : "").toContain('nextStatus is "Acceptance"');
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

const inProgress = { status: STATUS.inProgress, assigneeId: null };
const at = (status: string, assigneeId: string | null = null) => ({ status, assigneeId });
const closingSince = (stage: StageKind, iso: string): Closing => ({
  id: "c",
  at: iso,
  replies: [],
  result: parseResult({
    stage,
    issue: "BAN-7",
    outcome: "done",
    nextStatus: "In Review",
    summary: "",
  }),
});
const RUN_START = "2026-10-24T01:00:00.000Z";
const started = (fields: Partial<ActiveRecord> = {}) =>
  record({ runs: [{ startedAt: RUN_START, log: "/x.jsonl", before: null }], ...fields });

describe("an active record, each tick", () => {
  test("is running while its supervisor is", () => {
    expect(reconcile(started(), { alive: true, issue: inProgress, now: NOW })).toEqual({
      type: "running",
    });
  });

  test("crashed when its supervisor is gone with the issue still In Progress", () => {
    expect(reconcile(started(), { alive: false, issue: inProgress, now: NOW })).toEqual({
      type: "crashed",
    });
  });

  test("ended quietly when its supervisor is gone and the issue has left In Progress", () => {
    expect(reconcile(started(), { alive: false, issue: at(STATUS.inReview), now: NOW }).type).toBe(
      "gone",
    );
    expect(reconcile(started(), { alive: false, issue: undefined, now: NOW }).type).toBe("gone");
  });

  test("closed when its supervisor posted the closing comment and died before setting the status", () => {
    const closing = closingSince("implement", "2026-10-24T02:00:00.000Z");

    expect(reconcile(started(), { alive: false, issue: inProgress, closing, now: NOW })).toEqual({
      type: "closed",
      closing,
    });
  });

  test("crashed all the same when the closing comment is an earlier run's, or another Stage's", () => {
    const earlier = closingSince("implement", "2026-10-24T00:30:00.000Z");
    const other = closingSince("design", "2026-10-24T02:00:00.000Z");

    expect(
      reconcile(started(), { alive: false, issue: inProgress, closing: earlier, now: NOW }).type,
    ).toBe("crashed");
    expect(
      reconcile(started(), { alive: false, issue: inProgress, closing: other, now: NOW }).type,
    ).toBe("crashed");
  });

  test("starting, for 2 minutes after it was written, while its supervisor hasn't recorded its pid", () => {
    const fresh = record({ pid: null, since: "2026-10-24T02:59:00.000Z" });
    const stale = record({ pid: null, since: "2026-10-24T02:57:00.000Z" });

    expect(reconcile(fresh, { alive: false, issue: at(STATUS.todo), now: NOW })).toEqual({
      type: "starting",
    });
    expect(reconcile(stale, { alive: false, issue: at(STATUS.todo), now: NOW }).type).toBe("gone");
    expect(reconcile(stale, { alive: false, issue: inProgress, now: NOW }).type).toBe("crashed");
  });

  test("paused until its reset time, and due from then", () => {
    const paused = record({ state: "paused", pid: null, resetsAt: "2026-10-24T03:30:00.000Z" });

    expect(reconcile(paused, { alive: false, issue: inProgress, now: NOW })).toEqual({
      type: "paused",
      due: false,
    });
    expect(
      reconcile(paused, {
        alive: false,
        issue: inProgress,
        now: new Date("2026-10-24T03:30:00.000Z"),
      }),
    ).toEqual({ type: "paused", due: true });
  });

  test("held, never resumed, while its issue is assigned", () => {
    const paused = record({ state: "paused", pid: null, resetsAt: "2026-10-24T01:00:00.000Z" });

    expect(
      reconcile(paused, { alive: false, issue: at(STATUS.inProgress, "someone"), now: NOW }).type,
    ).toBe("held");
  });

  test("left behind once its issue isn't In Progress any more", () => {
    const paused = record({ state: "paused", pid: null, resetsAt: "2026-10-24T03:30:00.000Z" });

    expect(reconcile(paused, { alive: false, issue: at(STATUS.todo), now: NOW }).type).toBe(
      "abandoned",
    );
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
