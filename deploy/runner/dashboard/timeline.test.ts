import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closingComment, MAINTAINER } from "../dispatch/closing";
import { parseResult } from "../dispatch/result";
import { store } from "../dispatch/store";
import { dispatcher, fakeIssue, RUNNER_ID } from "../dispatch/test-fakes";
import { issues, NOW, writeVolume } from "./fixtures/ban-11";
import { issuePage, type IssueData, timeline } from "./timeline";
import { issueData, volumePaths } from "./volume";

// The issue page's timeline, from a Runner shaped like BAN-11's night: four
// failed runs, each for its own reason, a done Stage, and a Slug Preview
// wait that timed out, merged with the closing comments and the moves.

const work = mkdtempSync(join(tmpdir(), "banki-dashboard-timeline-"));
writeVolume(work);
afterAll(() => rmSync(work, { recursive: true, force: true }));

function deps(fixture = issues()) {
  const { deps: base, revoked } = dispatcher(fixture, { now: NOW });
  const paths = volumePaths(work);
  return {
    deps: { ...base, records: store(paths.dispatcher), logs: paths.logs, now: () => NOW },
    revoked,
  };
}

const ban11 = async () => issueData(deps().deps, "BAN-11");

describe("BAN-11's timeline", () => {
  test("tells each failed run's outcome apart, never started from a crash, then the done Stage", async () => {
    const attempts = timeline(await ban11()).flatMap((entry) =>
      entry.type === "attempt" ? [[entry.stage, entry.label]] : [],
    );

    expect(attempts).toEqual([
      ["design", "never-started"],
      ["design", "crashed"],
      ["design", "timed-out"],
      ["design", "no-result"],
      ["design", "done"],
    ]);
  });

  test("gives each attempt its one-line reason, from its closing comment", async () => {
    const reasons = timeline(await ban11()).flatMap((entry) =>
      entry.type === "attempt" ? [entry.reason] : [],
    );

    expect(reasons[0]).toStartWith("The design Stage failed before claude started");
    expect(reasons[1]).toContain("supervisor is gone");
    expect(reasons[2]).toContain("ran for 3 hours");
    expect(reasons[3]).toContain("without a result the Runner can use");
    expect(reasons[4]).toBe("Built two Variants of the deck list: a dense table, and cards.");
    for (const reason of reasons) expect(reason).not.toContain("\n");
  });

  test("gives each its cost, the week's share as the ledger counts it and in dollars, its duration and its logs", async () => {
    const entries = timeline(await ban11());
    const timedOut = entries.find(
      (entry) => entry.type === "attempt" && entry.label === "timed-out",
    );
    const neverStarted = entries.find(
      (entry) => entry.type === "attempt" && entry.label === "never-started",
    );

    expect(timedOut).toMatchObject({ usd: 6.1, durationMs: 3 * 60 * 60_000 });
    if (timedOut?.type !== "attempt") throw new Error("no timed-out attempt");
    expect(timedOut.share).toBeCloseTo(0.06, 5);
    expect(timedOut.runs).toEqual([
      expect.objectContaining({ log: "/issues/BAN-11/logs/2026-10-24T00-20-00Z-design.jsonl" }),
    ]);
    expect(neverStarted).toMatchObject({ share: undefined, usd: 0 });
    if (neverStarted?.type !== "attempt") throw new Error("no never-started attempt");
    expect(neverStarted.runs[0]?.supervisor).toBe(
      "/issues/BAN-11/logs/2026-10-23T23-00-05Z-design.log",
    );
  });

  test("shows the Slug Preview wait that timed out as the Dispatcher's stop, with its question and the reply", async () => {
    const stop = timeline(await ban11()).find((entry) => entry.type === "closing");

    expect(stop).toMatchObject({
      type: "closing",
      by: "dispatcher",
      closing: {
        result: { wait: "slug-previews", question: "What should the Runner do?" },
        replies: [{ text: "Dispatched ban-11-b again: wait once more." }],
      },
    });
    expect(stop?.type === "closing" && stop.closing.result.summary).toContain(
      "`ban-11-b` (queued)",
    );
  });

  test("merges the moves, the hand-backs and the Maintainer's own, oldest first", async () => {
    const entries = timeline(await ban11());
    const moves = entries.flatMap((entry) =>
      entry.type === "move" ? [`${entry.what}, by ${entry.by}`] : [],
    );

    expect(entries.map((entry) => entry.at)).toEqual(entries.map((entry) => entry.at).toSorted());
    expect(moves[0]).toBe("Backlog → In Design, by the Maintainer");
    expect(moves).toContain("assigned the Maintainer: a stop, by the Runner");
    expect(moves).toContain("unassigned: handed back after a reply, by the Runner");
  });

  test("reads at a glance on the page, escaped, and revokes its Linear token", async () => {
    const { deps: base, revoked } = deps();
    const text = issuePage(await issueData(base, "BAN-11"), "UTC");

    for (const words of [
      "never started",
      "crashed",
      "timed out",
      "no result",
      "the wait for the Slug Previews stopped",
      "Deck list: dense or cards?",
    ]) {
      expect(text).toContain(words);
    }
    expect(text).toContain("&lt;script&gt;alert(&#39;a comment&#39;)&lt;/script&gt; Once more.");
    expect(text).not.toContain("<script>alert");
    expect(revoked).toEqual(["tick-token"]);
  });
});

const base = (linear: IssueData["linear"]): IssueData => ({
  issue: "BAN-7",
  now: NOW,
  stages: [],
  active: [],
  runs: {},
  linear,
});

describe("a timeline", () => {
  const result = {
    stage: "implement",
    issue: "BAN-7",
    outcome: "done",
    summary: "Built it live.",
    nextStatus: "In Review",
  };

  test("marks a Stage run live, from the Maintainer's closing comment, with no log", () => {
    const data = base({
      title: "",
      status: "In Review",
      assigneeId: null,
      runnerId: RUNNER_ID,
      moves: [],
      comments: [
        {
          id: "live",
          body: closingComment(parseResult(result), result),
          createdAt: "2026-10-24T01:00:00.000Z",
          userId: MAINTAINER.linearId,
          parentId: null,
        },
      ],
    });

    expect(timeline(data)).toEqual([expect.objectContaining({ type: "closing", by: "live" })]);
    expect(issuePage(data, "UTC")).toContain("no log on the Runner");
  });

  test("still shows the Runner's records when Linear can't be read, and says why", () => {
    const data: IssueData = {
      ...base({ error: "Can't reach the broker" }),
      stages: [
        {
          issue: "BAN-7",
          kind: "implement",
          outcome: "crashed",
          endedAt: "2026-10-24T01:00:00.000Z",
          runs: [
            {
              startedAt: "2026-10-24T00:00:00.000Z",
              endedAt: "2026-10-24T01:00:00.000Z",
              log: "/work/logs/BAN-7/x.jsonl",
              before: null,
            },
          ],
        },
      ],
      runs: { "x.jsonl": { exists: true, started: true, costUsd: 0.5 } },
    };

    expect(timeline(data)).toEqual([
      expect.objectContaining({ type: "attempt", label: "crashed", usd: 0.5 }),
    ]);
    expect(issuePage(data, "UTC")).toContain("Linear couldn't be read: Can&#39;t reach the broker");
  });

  test("leaves the outcome as recorded once a log is gone with its 30 days", () => {
    const data: IssueData = {
      ...base({ error: "x" }),
      stages: [
        {
          issue: "BAN-7",
          kind: "implement",
          outcome: "crashed",
          endedAt: "2026-09-01T01:00:00.000Z",
          runs: [
            {
              startedAt: "2026-09-01T00:00:00.000Z",
              log: "/work/logs/BAN-7/old.jsonl",
              before: null,
            },
          ],
        },
        {
          issue: "BAN-7",
          kind: "implement",
          outcome: "crashed",
          endedAt: "2026-10-24T01:00:00.000Z",
          runs: [],
        },
      ],
    };

    expect(timeline(data).map((entry) => entry.type === "attempt" && entry.label)).toEqual([
      "crashed",
      "never-started",
    ]);
  });

  test("redacts what it shows", () => {
    const token = ["sk", "ant", "oat01", "Ab3dEf6Gh9Jk2Lm5Np8"].join("-");
    const data = base({
      title: `Leak ${token}`,
      status: "Todo",
      assigneeId: null,
      runnerId: RUNNER_ID,
      moves: [],
      comments: [],
    });

    expect(issuePage(data, "UTC")).toContain("Leak [redacted]");
    expect(issuePage(data, "UTC")).not.toContain(token);
  });

  test("marks the fixture's issues the volume has no records of as having none", async () => {
    const data = await issueData(deps([fakeIssue("BAN-99")]).deps, "BAN-99");

    expect(timeline(data)).toEqual([]);
  });
});
