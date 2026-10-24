import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StageOptions, StageRun } from "../cli/stage";
import { MAINTAINER, resultIn } from "./closing";
import { STAGE_LIMIT_MS } from "./lifecycle";
import { store } from "./store";
import { supervise, type SupervisorDeps } from "./supervisor";
import { fakeGitHub, fakeIssue, type FakeIssue, fakeLinear, reading } from "./test-fakes";

// One Stage under its supervisor, with a stand-in Stage, gate and Linear.

const NOW = new Date("2026-10-24T02:00:00.000Z");
const init = JSON.stringify({
  type: "system",
  subtype: "init",
  model: "m",
  session_id: "sess-1",
  mcp_servers: [],
});
const resultEvent = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: 1.5,
    ...fields,
  });
const rejected = JSON.stringify({
  type: "rate_limit_event",
  rate_limit_info: {
    status: "rejected",
    rateLimitType: "five_hour",
    unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1792863000, status: "rejected" } },
  },
});

function setup(
  issue: FakeIssue,
  stage: (options: StageOptions, log: string) => Partial<StageRun>,
  options: {
    reading?: () => Promise<ReturnType<typeof reading>>;
    heads?: (string | undefined)[];
    /** The branches on origin. */
    branches?: string[];
    /** The branches whose tips were read. */
    tipsOf?: string[];
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "banki-supervisor-"));
  const linear = fakeLinear([issue]);
  const given: StageOptions[] = [];
  const records = store(join(dir, "dispatcher"));
  // As the tick writes it, just before it starts the supervisor.
  records.saveActive({ issue: "BAN-1", kind: "implement", state: "running", pid: null, runs: [] });
  const log = join(dir, "logs", "BAN-1", "run.jsonl");
  mkdirSync(join(dir, "logs", "BAN-1"), { recursive: true });
  const deps: SupervisorDeps = {
    broker: {
      linearToken: async () => ({ id: "sup-token", token: "lin" }),
      endLinearToken: async () => undefined,
      githubToken: async () => "gh",
    },
    linear: () => linear.client,
    github: () => ({
      ...fakeGitHub(),
      branches: async () => options.branches ?? [],
      branchHead: async (branch) => {
        options.tipsOf?.push(branch);
        return options.heads === undefined ? undefined : options.heads.shift();
      },
    }),
    log: () => undefined,
    records,
    takeReading: options.reading ?? (async () => reading()),
    executeStage: async (_kind, _issue, stageOptions) => {
      given.push(stageOptions);
      return { exitCode: 0, timedOut: false, log, ...stage(stageOptions, log) };
    },
    redact: (text) => text,
    now: () => NOW,
    pid: 4242,
  };
  return { deps, linear, given, records, log };
}

const done = {
  stage: "implement",
  issue: "BAN-1",
  outcome: "done",
  nextStatus: "In Review",
  summary: "Opened PR #3.",
  pr: 3,
};

/** Supervises a Stage whose issue changed since the tick looked, and checks it started nothing. */
const abandoned = async (
  issue: FakeIssue,
  kind: "implement" | "design",
  resume: boolean,
  paused?: boolean,
) => {
  let ran = false;
  const lines: string[] = [];
  const { deps, linear, records, log } = setup(issue, () => {
    ran = true;
    return { result: done };
  });
  deps.log = (line) => lines.push(line);
  if (paused) {
    records.saveActive({
      issue: "BAN-1",
      kind,
      state: "running",
      pid: null,
      sessionId: "sess-1",
      resetsAt: "2026-10-24T01:00:00.000Z",
      runs: [],
    });
  }
  expect(await supervise(kind, "BAN-1", { log, resume }, deps)).toBe(1);
  expect(ran).toBe(false);
  expect(linear.calls).toEqual([]);
  return { records, lines };
};

describe("a supervised Stage", () => {
  test("sets In Progress, runs the Stage within its limit, posts the closing comment and sets the next status", async () => {
    const issue = fakeIssue("BAN-1");
    const { deps, linear, given, records, log } = setup(issue, (_options, path) => {
      writeFileSync(path, `${init}\n${resultEvent()}\n`);
      return { result: done };
    });

    expect(await supervise("implement", "BAN-1", { log, resume: false }, deps)).toBe(0);

    expect(linear.calls).toEqual(["BAN-1 → In Progress", "BAN-1 comment", "BAN-1 → In Review"]);
    expect(given).toEqual([{ log, resume: undefined, timeLimitMs: STAGE_LIMIT_MS }]);
    expect(resultIn(issue.comments[0]?.body ?? "")).toMatchObject({ outcome: "done", pr: 3 });
    expect(records.activeRecords()).toEqual([]);
    const [ended] = records.stageRecords();
    expect(ended).toMatchObject({ issue: "BAN-1", kind: "implement", outcome: "done" });
    expect(ended?.runs[0]).toMatchObject({ costUsd: 1.5, log });
    expect(ended?.runs[0]?.before).toBeDefined();
    expect(ended?.runs[0]?.after).toBeDefined();
  });

  test("on a stop, posts its question and assigns the Maintainer", async () => {
    const issue = fakeIssue("BAN-1");
    const stopped = {
      ...done,
      outcome: "stopped",
      nextStatus: "Todo",
      question: "Which?",
      options: ["A", "B"],
    };
    const { deps, linear, log } = setup(issue, () => ({ result: stopped }));

    await supervise("implement", "BAN-1", { log, resume: false }, deps);

    expect(linear.calls).toEqual([
      "BAN-1 → In Progress",
      "BAN-1 comment",
      "BAN-1 → Todo",
      "BAN-1 assigned the Maintainer",
    ]);
    expect(issue.comments[0]?.body).toContain("**Question:** Which?");
    expect(issue.assigneeId).toBe(MAINTAINER.linearId);
  });

  test("pauses at the five-hour limit, In Progress and unassigned, with its session and reset time", async () => {
    const issue = fakeIssue("BAN-1");
    const { deps, linear, records, log } = setup(issue, (_options, path) => {
      writeFileSync(
        path,
        `${init}\n${rejected}\n${resultEvent({ is_error: true, total_cost_usd: 0.5 })}\n`,
      );
      return { exitCode: 1 };
    });

    await supervise("implement", "BAN-1", { log, resume: false }, deps);

    expect(linear.calls).toEqual(["BAN-1 → In Progress"]);
    expect(records.activeRecord("BAN-1")).toMatchObject({
      state: "paused",
      pid: null,
      sessionId: "sess-1",
      resetsAt: "2026-10-24T17:30:00.000Z",
    });
  });

  test("resumes in its own session with what is left of its 3 hours, and costs the sum over its runs", async () => {
    const issue = fakeIssue("BAN-1", { status: "In Progress" });
    const { deps, linear, given, records, log } = setup(issue, () => ({ result: done }));
    records.saveActive({
      issue: "BAN-1",
      kind: "implement",
      state: "running",
      pid: null,
      sessionId: "sess-1",
      resetsAt: "2026-10-24T01:00:00.000Z",
      runs: [
        {
          startedAt: "2026-10-23T22:00:00.000Z",
          endedAt: "2026-10-23T23:00:00.000Z",
          log: "/first.jsonl",
          before: reading(),
          after: reading(),
          costUsd: 1,
        },
      ],
    });

    await supervise("implement", "BAN-1", { log, resume: true }, deps);

    expect(given).toEqual([{ log, resume: "sess-1", timeLimitMs: STAGE_LIMIT_MS - 60 * 60_000 }]);
    expect(linear.calls).toEqual(["BAN-1 comment", "BAN-1 → In Review"]);
    expect(records.stageRecords()[0]?.runs).toHaveLength(2);
  });

  test("after a timeout, restores the status from before In Progress and stops on the Maintainer with the log's tail", async () => {
    const issue = fakeIssue("BAN-1", { status: "In Review" });
    const { deps, linear, log } = setup(issue, (_options, path) => {
      writeFileSync(
        path,
        `${init}\n${JSON.stringify({ type: "runner", event: "exit", exitCode: 143 })}\n`,
      );
      return { exitCode: 143, timedOut: true };
    });

    await supervise("review-round", "BAN-1", { log, resume: false }, deps);

    expect(linear.calls).toEqual([
      "BAN-1 → In Progress",
      "BAN-1 comment",
      "BAN-1 → In Review",
      "BAN-1 assigned the Maintainer",
    ]);
    expect(issue.comments[0]?.body).toContain("3 hours");
    expect(issue.comments[0]?.body).toContain("claude exited 143");
    expect(resultIn(issue.comments[0]?.body ?? "")).toMatchObject({
      stage: "review-round",
      outcome: "stopped",
      wait: null,
    });
  });

  test("posts the real tip of the issue's branch, before and after, over what the Stage wrote", async () => {
    const issue = fakeIssue("BAN-1", { status: "In Review" });
    const tip = "c".repeat(40);
    const { deps, log } = setup(
      issue,
      () => ({ result: { ...done, stage: "review-round", headSha: "abc", pushed: true } }),
      { heads: [tip, tip] },
    );

    await supervise("review-round", "BAN-1", { log, resume: false }, deps);

    expect(resultIn(issue.comments[0]?.body ?? "")).toMatchObject({ headSha: tip, pushed: false });
  });

  test("reads the tips of the issue's branch on origin, under whoever's prefix started it", async () => {
    const issue = fakeIssue("BAN-1", { status: "In Review", branch: "bankirunner/ban-1-x" });
    const tipsOf: string[] = [];
    const { deps, log } = setup(
      issue,
      () => ({ result: { ...done, stage: "review-round", headSha: null, pushed: false } }),
      { branches: ["main", "dkomeza/ban-1-x"], tipsOf },
    );

    await supervise("review-round", "BAN-1", { log, resume: false }, deps);

    expect(tipsOf).toEqual(["dkomeza/ban-1-x", "dkomeza/ban-1-x"]);
  });

  test("says it pushed when the branch moved, whatever the Stage wrote", async () => {
    const issue = fakeIssue("BAN-1", { status: "In Review" });
    const { deps, log } = setup(
      issue,
      () => ({ result: { ...done, stage: "review-round", headSha: null, pushed: false } }),
      { heads: ["a".repeat(40), "b".repeat(40)] },
    );

    await supervise("review-round", "BAN-1", { log, resume: false }, deps);

    expect(resultIn(issue.comments[0]?.body ?? "")).toMatchObject({
      headSha: "b".repeat(40),
      pushed: true,
    });
  });

  test("keeps the Stage's own Linear token out of a crash's tail", async () => {
    const issue = fakeIssue("BAN-1");
    const stageToken = ["stage", "linear", "token", "0123456789"].join("-");
    const { deps, log } = setup(issue, (_options, path) => {
      writeFileSync(
        path,
        `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: `echo ${stageToken}` } }] } })}\n`,
      );
      return { exitCode: 1, tokens: [stageToken] };
    });

    await supervise("implement", "BAN-1", { log, resume: false }, deps);

    expect(issue.comments[0]?.body).toContain("tool: Bash echo [redacted]");
    expect(issue.comments[0]?.body).not.toContain(stageToken);
  });

  test("starts nothing when the gate's reading fails", async () => {
    const issue = fakeIssue("BAN-1");
    let ran = false;
    const { deps, linear, records, log } = setup(
      issue,
      () => {
        ran = true;
        return {};
      },
      {
        reading: async () => {
          throw new Error("no rate_limit_event");
        },
      },
    );

    expect(await supervise("implement", "BAN-1", { log, resume: false }, deps)).toBe(1);

    expect(ran).toBe(false);
    expect(linear.calls).toEqual([]);
    expect(records.activeRecords()).toEqual([]);
  });

  // The issue may change between the tick's survey and the supervisor's
  // fresh look, while the gate's reading takes its time.
  describe("abandons the start, touching nothing in Linear, when the issue changed since the tick looked", () => {
    test("the Maintainer took the issue", async () => {
      const { records, lines } = await abandoned(
        fakeIssue("BAN-1", { assigneeId: MAINTAINER.linearId }),
        "implement",
        false,
      );
      expect(records.activeRecords()).toEqual([]);
      expect(lines.join("\n")).toContain("assigned");
    });

    test("a fresh start's issue left the status its Stage runs in", async () => {
      const { records, lines } = await abandoned(
        fakeIssue("BAN-1", { status: "Backlog" }),
        "implement",
        false,
      );
      expect(records.activeRecords()).toEqual([]);
      expect(lines.join("\n")).toContain("Backlog");
    });

    test("a fresh design start whose issue is in Todo", async () => {
      const { records } = await abandoned(fakeIssue("BAN-1"), "design", false);
      expect(records.activeRecords()).toEqual([]);
    });

    test("a resume's issue is no longer In Progress, and it stays paused", async () => {
      const { records, lines } = await abandoned(
        fakeIssue("BAN-1", { status: "Todo" }),
        "implement",
        true,
        true,
      );
      expect(records.activeRecord("BAN-1")).toMatchObject({
        state: "paused",
        pid: null,
        sessionId: "sess-1",
      });
      expect(lines.join("\n")).toContain("Todo");
    });

    test("a resume's issue was assigned, and it stays paused", async () => {
      const { records } = await abandoned(
        fakeIssue("BAN-1", { status: "In Progress", assigneeId: MAINTAINER.linearId }),
        "implement",
        true,
        true,
      );
      expect(records.activeRecord("BAN-1")).toMatchObject({ state: "paused", pid: null });
    });
  });
});
