import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closingComment, MAINTAINER } from "./closing";
import { runNow, status, tick } from "./dispatcher";
import { dispatcher, fakeGitHub, fakeIssue, reading, RUNNER_ID, WEDNESDAY } from "./test-fakes";
import { parseResult } from "./result";

// The tick, `run-now` and `runner status`, through stand-ins for Linear,
// GitHub, the Broker, the gate and the supervisors.

const HEAD = "a".repeat(40);

describe("a tick", () => {
  test("starts the ready Stages inside the window, under their supervisors, and revokes its token", async () => {
    const { deps, started, revoked } = dispatcher([
      fakeIssue("BAN-1"),
      fakeIssue("BAN-2", { status: "Backlog" }),
    ]);

    await tick(deps);

    expect(started.map((start) => [start.issue, start.kind, start.resume])).toEqual([
      ["BAN-1", "implement", false],
    ]);
    expect(started[0]?.log).toContain("BAN-1/");
    expect(deps.records.activeRecord("BAN-1")).toMatchObject({
      state: "running",
      kind: "implement",
    });
    expect(revoked).toEqual(["tick-token"]);
  });

  test("starts nothing outside the window, and takes no reading", async () => {
    let read = false;
    const { deps, started } = dispatcher([fakeIssue("BAN-1")], {
      now: WEDNESDAY,
      reading: async () => {
        read = true;
        return reading();
      },
    });

    await tick(deps);

    expect(started).toEqual([]);
    expect(read).toBe(false);
  });

  test("starts nothing when the gate's reading fails", async () => {
    const { deps, started, lines } = dispatcher([fakeIssue("BAN-1")], {
      reading: async () => {
        throw new Error("claude exited 1");
      },
    });

    await tick(deps);

    expect(started).toEqual([]);
    expect(lines.join("\n")).toContain("claude exited 1");
    expect(deps.records.gate()?.error).toContain("claude exited 1");
  });

  test("skips an assigned issue, and one In Progress that no supervisor started", async () => {
    const { deps, started } = dispatcher([
      fakeIssue("BAN-1", { assigneeId: MAINTAINER.linearId }),
      fakeIssue("BAN-2", { status: "In Progress" }),
    ]);

    await tick(deps);

    expect(started).toEqual([]);
  });

  test("hands an issue back on the Maintainer's reply to its stop, and runs that Stage again", async () => {
    const stopped = {
      stage: "implement",
      issue: "BAN-1",
      outcome: "stopped",
      nextStatus: "Todo",
      summary: "?",
      question: "Which?",
    };
    const issue = fakeIssue("BAN-1", {
      assigneeId: MAINTAINER.linearId,
      comments: [
        {
          id: "stop",
          body: closingComment(parseResult(stopped), stopped),
          createdAt: "2026-10-23T01:00:00.000Z",
          userId: RUNNER_ID,
          parentId: null,
        },
        {
          id: "reply",
          body: "The first one.",
          createdAt: "2026-10-23T09:00:00.000Z",
          userId: MAINTAINER.linearId,
          parentId: "stop",
        },
      ],
    });
    const { deps, started, linear } = dispatcher([issue]);

    await tick(deps);

    expect(linear.calls).toContain("BAN-1 assigned null");
    expect(started.map((start) => start.kind)).toEqual(["implement"]);
  });

  test("hands off to Acceptance once the rounds have ended and the PR Preview is up, outside the window too", async () => {
    const issue = fakeIssue("BAN-1", {
      status: "In Review",
      history: [{ at: "2026-10-01T00:00:00.000Z", from: "In Progress", to: "In Review" }],
    });
    const github = fakeGitHub({
      pr: { number: 12, headSha: HEAD, open: true },
      pushedAt: "2026-10-21T11:00:00.000Z",
      check: { status: "completed", conclusion: "success" },
      summary: { sha: HEAD.slice(0, 7), findings: [] },
      preview: { state: "success", description: "", url: "https://pr-12.banki.dkomeza.com" },
    });
    const { deps, linear } = dispatcher([issue], { now: WEDNESDAY, github });

    await tick(deps);

    expect(linear.calls).toEqual(["BAN-1 comment", "BAN-1 → Acceptance"]);
    expect(issue.comments[0]?.body).toContain("https://pr-12.banki.dkomeza.com");
  });

  test("stops on the Maintainer when a wait fails, assigning them", async () => {
    const issue = fakeIssue("BAN-1", {
      status: "In Review",
      history: [{ at: "2026-10-01T00:00:00.000Z", from: "In Progress", to: "In Review" }],
    });
    const github = fakeGitHub({
      pr: { number: 12, headSha: HEAD, open: true },
      pushedAt: "2026-10-21T10:00:00.000Z",
      check: { status: "completed", conclusion: "cancelled" },
    });
    const { deps, linear } = dispatcher([issue], { now: WEDNESDAY, github });

    await tick(deps);

    expect(linear.calls).toEqual(["BAN-1 comment", "BAN-1 assigned the Maintainer"]);
    expect(issue.comments[0]?.body).toContain("+++ Stage result");
  });

  test("after a crash, restores the status from before In Progress, posts the log's tail and assigns the Maintainer", async () => {
    const issue = fakeIssue("BAN-1", {
      status: "In Progress",
      history: [{ at: "2026-10-24T01:00:00.000Z", from: "In Review", to: "In Progress" }],
    });
    const { deps, linear, dir } = dispatcher([issue], { alive: false, now: WEDNESDAY });
    const log = join(dir, "BAN-1.jsonl");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      log,
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Fixing the query" }] } })}\n`,
    );
    deps.records.saveActive({
      issue: "BAN-1",
      kind: "review-round",
      state: "running",
      pid: 99,
      runs: [{ startedAt: "2026-10-24T01:00:00.000Z", log, before: reading() }],
    });

    await tick(deps);

    expect(linear.calls).toEqual([
      "BAN-1 comment",
      "BAN-1 → In Review",
      "BAN-1 assigned the Maintainer",
    ]);
    expect(issue.comments[0]?.body).toContain("say: Fixing the query");
    expect(issue.comments[0]?.body).not.toContain('"type":"assistant"');
    expect(deps.records.activeRecords()).toEqual([]);
    expect(deps.records.stageRecords()[0]?.outcome).toBe("crashed");
  });

  test("resumes a paused Stage once its window has started over, inside the window, ahead of the queue", async () => {
    const { deps, started } = dispatcher([
      fakeIssue("BAN-1", { status: "In Progress" }),
      fakeIssue("BAN-2"),
      fakeIssue("BAN-3"),
    ]);
    deps.records.saveActive({
      issue: "BAN-1",
      kind: "implement",
      state: "paused",
      pid: null,
      sessionId: "sess-1",
      resetsAt: "2026-10-24T11:00:00.000Z",
      runs: [
        {
          startedAt: "2026-10-24T09:00:00.000Z",
          endedAt: "2026-10-24T10:00:00.000Z",
          log: "/x.jsonl",
          before: reading(),
        },
      ],
    });

    await tick(deps);

    // The paused Stage holds its slot, so one more starts: 2 at most.
    expect(started.map((start) => [start.issue, start.resume])).toEqual([
      ["BAN-1", true],
      ["BAN-2", false],
    ]);
  });

  test("leaves a paused Stage paused before its window starts over", async () => {
    const { deps, started } = dispatcher([fakeIssue("BAN-1", { status: "In Progress" })]);
    deps.records.saveActive({
      issue: "BAN-1",
      kind: "implement",
      state: "paused",
      pid: null,
      resetsAt: "2026-10-24T13:00:00.000Z",
      runs: [],
    });

    await tick(deps);

    expect(started).toEqual([]);
  });
});

describe("run-now", () => {
  test("starts the issue's next Stage outside the window, and gives the log", async () => {
    const { deps, started } = dispatcher([fakeIssue("BAN-1")], { now: WEDNESDAY });

    const outcome = await runNow("BAN-1", false, deps);

    expect(outcome.log).toContain("BAN-1/");
    expect(started.map((start) => start.issue)).toEqual(["BAN-1"]);
  });

  test("keeps the Ceiling unless forced, and the five-hour check even then", async () => {
    const { deps } = dispatcher([fakeIssue("BAN-1")], {
      now: WEDNESDAY,
      reading: async () => reading(0.7),
    });

    expect((await runNow("BAN-1", false, deps)).why).toContain("Ceiling");
    expect((await runNow("BAN-1", true, deps)).log).toBeDefined();

    const tired = dispatcher([fakeIssue("BAN-2")], {
      now: WEDNESDAY,
      reading: async () => reading(0.1, 0.9),
    });
    expect((await runNow("BAN-2", true, tired.deps)).why).toContain("five-hour");
  });

  test("says why nothing starts on an assigned issue or one that waits", async () => {
    const { deps } = dispatcher([fakeIssue("BAN-1", { assigneeId: "someone" })], {
      now: WEDNESDAY,
    });

    expect((await runNow("BAN-1", false, deps)).why).toBe("it is assigned");
    expect((await runNow("BAN-9", false, deps)).why).toContain("isn't an open issue");
  });
});

describe("runner status", () => {
  test("shows the ready queue with why each would start or not, and the In Progress issues no supervisor started", async () => {
    const { deps } = dispatcher(
      [fakeIssue("BAN-1"), fakeIssue("BAN-2", { status: "In Progress" })],
      { now: WEDNESDAY },
    );
    deps.records.saveGate({ reading: reading(0.3), at: "2026-10-21T11:00:00.000Z" });

    const text = await status(deps);

    expect(text).toContain("Ready, in order (outside the window):");
    expect(text).toContain("BAN-1 implement: would fit the gate");
    expect(text).toContain("In Progress, not started by a supervisor of the Runner:\n  BAN-2");
    expect(text).toContain("the week 30%");
  });
});
