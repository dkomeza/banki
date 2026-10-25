import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closingComment, MAINTAINER } from "../../dispatch/closing";
import type { Reading } from "../../dispatch/gate";
import type { GitHub } from "../../dispatch/github";
import type { ActiveRecord, StageRecord } from "../../dispatch/lifecycle";
import type { Move } from "../../dispatch/linear";
import { parseResult } from "../../dispatch/result";
import { crashStop } from "../../dispatch/lifecycle";
import { fakeGitHub, fakeIssue, type FakeIssue, RUNNER_ID } from "../../dispatch/test-fakes";

// A Runner shaped like BAN-11's night, for the Dashboard's tests and for
// looking at its pages locally (fixture.ts): the design Stage on BAN-11
// failed four times for four reasons (it never started, it crashed, it timed
// out, it left no result), then was done, and its Slug Preview `ban-11-b`
// sat queued past the wait's 60 minutes, which stopped on the Maintainer;
// they replied, and the wait is on again. Beside it: a Stage running, one
// paused, one ready behind the cap, one waiting on its PR Preview, one the
// Maintainer holds, an In Progress issue no supervisor started, and the tick
// log.

export const NOW = new Date("2026-10-24T08:00:00.000Z");
const at = (time: string) => new Date(`2026-10-${time}Z`).toISOString();

const reading = (week: number, time: string): Reading => ({
  at: at(time),
  fiveHour: { utilization: 0.12, resetsAt: at("24T10:00:00") },
  sevenDay: { utilization: week, resetsAt: at("27T00:00:00") },
});

const log = (issue: string, start: string, kind: string) =>
  `/work/logs/${issue}/${start.replaceAll(":", "-")}Z-${kind}.jsonl`;

const event = (fields: Record<string, unknown>) => JSON.stringify(fields);
const runner = (time: string, fields: Record<string, unknown>) =>
  event({ type: "runner", at: at(time), ...fields });
const init = (session: string) =>
  event({
    type: "system",
    subtype: "init",
    model: "claude-opus-5-5",
    session_id: session,
    mcp_servers: [{ name: "linear-banki", status: "connected" }],
  });
const say = (text: string) =>
  event({ type: "assistant", message: { content: [{ type: "text", text }] } });
const tool = (name: string, input: Record<string, unknown>) =>
  event({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const toolResult = (isError = false, text = "") =>
  event({
    type: "user",
    message: { content: [{ type: "tool_result", is_error: isError, content: text }] },
  });
const result = (usd: number, turns: number, ms: number) =>
  event({
    type: "result",
    subtype: "success",
    num_turns: turns,
    duration_ms: ms,
    total_cost_usd: usd,
  });

// A fake value, built at runtime so secret scanners don't flag it.
const TOKEN = ["ghs", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"].join("_");

const LOGS: Record<string, string[]> = {
  [log("BAN-11", "2026-10-23T23:00:05", "design")]: [
    runner("23T23:00:05", { event: "start", argv: ["claude", "-p", "…"] }),
    runner("23T23:00:06", {
      event: "stderr",
      line: "error: Can't reach the broker at /run/banki-broker/broker.sock: ECONNREFUSED",
    }),
    runner("23T23:00:07", { event: "exit", exitCode: 1, signal: null }),
  ],
  [log("BAN-11", "2026-10-23T23:30:00", "design")]: [
    runner("23T23:30:00", { event: "start", argv: ["claude", "-p", "…"] }),
    init("sess-crash"),
    say("I'll read the design Stage's instructions first."),
    tool("Read", { file_path: ".claude/skills/work-issue/stages/design.md" }),
    toolResult(),
    tool("Bash", { command: `GH_TOKEN=${TOKEN} gh pr list` }),
    toolResult(),
  ],
  [log("BAN-11", "2026-10-24T00:20:00", "design")]: [
    runner("24T00:20:00", { event: "start", argv: ["claude", "-p", "…"] }),
    init("sess-timeout"),
    say("Building Variant A: a dense table of decks."),
    tool("Bash", { command: "bun run ui shoot --agent prototyper /decks" }),
    toolResult(true, "Error: timed out waiting for the stack to come up"),
    runner("24T03:20:00", { event: "time limit", signal: "SIGTERM" }),
    runner("24T03:20:05", { event: "exit", exitCode: 143, signal: "SIGTERM" }),
  ],
  [log("BAN-11", "2026-10-24T03:50:00", "design")]: [
    runner("24T03:50:00", { event: "start", argv: ["claude", "-p", "…"] }),
    init("sess-noresult"),
    say("Both Variants are pushed. Writing the result."),
    tool("Write", { file_path: ".ui/stage-result.json" }),
    toolResult(),
    result(2.4, 61, 2_400_000),
    runner("24T04:30:00", { event: "exit", exitCode: 0, signal: null }),
  ],
  [log("BAN-11", "2026-10-24T04:50:00", "design")]: [
    runner("24T04:50:00", { event: "start", argv: ["claude", "-p", "…"] }),
    init("sess-done"),
    say("Variant A, the dense table, and Variant B, the cards, are up for Slug Previews."),
    tool("Bash", {
      command:
        "gh workflow run slug-preview.yml -f branch=dkomeza/ban-11-x-proto-b -f slug=ban-11-b -f ttl_hours=336",
    }),
    toolResult(),
    say("<script>alert('a log line')</script> is just text here."),
    result(3.2, 88, 3_000_000),
    runner("24T05:40:00", { event: "exit", exitCode: 0, signal: null }),
  ],
  [log("BAN-12", "2026-10-23T22:00:00", "implement")]: [
    runner("23T22:00:00", { event: "start", argv: ["claude", "-p", "…"] }),
    init("sess-12"),
    result(1.1, 40, 4_000_000),
  ],
  [log("BAN-12", "2026-10-24T07:20:00", "implement")]: [
    runner("24T07:20:00", { event: "start", argv: ["claude", "-p", "…", "--resume", "sess-12"] }),
    init("sess-12"),
    say("Going on from the parser tests."),
    tool("Bash", { command: "bun test apps/api/src/parse" }),
    toolResult(),
    tool("Edit", { file_path: "apps/api/src/parse/cloze.ts" }),
    toolResult(),
  ],
};

/** The supervisor's own lines, beside a Stage's log. */
const SUPERVISOR: Record<string, string[]> = {
  [log("BAN-11", "2026-10-23T23:00:05", "design").replace(/\.jsonl$/, ".log")]: [
    "2026-10-23T23:00:04.000Z Starting the design Stage on BAN-11, with 180 minutes left of its limit",
    "2026-10-23T23:00:07.000Z The Stage failed to run: Can't reach the broker at /run/banki-broker/broker.sock: ECONNREFUSED. Is the broker container up?",
    "2026-10-23T23:00:08.000Z The Stage stopped on the Maintainer: The design Stage failed before claude started",
  ],
};

const run = (
  start: string,
  end: string | undefined,
  before: number | null,
  after: number | null,
  usd?: number,
) => ({
  startedAt: at(start),
  ...(end === undefined ? {} : { endedAt: at(end) }),
  log: log("BAN-11", `2026-10-${start}`, "design"),
  before: before === null ? null : reading(before, start),
  ...(end === undefined ? {} : { after: after === null ? null : reading(after, end) }),
  ...(usd === undefined ? {} : { costUsd: usd }),
});

export const STAGES: StageRecord[] = [
  {
    issue: "BAN-12",
    kind: "implement",
    outcome: "done",
    endedAt: at("23T21:00:00"),
    runs: [
      {
        startedAt: at("23T20:00:00"),
        endedAt: at("23T21:00:00"),
        log: "/work/logs/BAN-12/2026-10-23T20-00-00Z-implement.jsonl",
        before: reading(0.25, "23T20:00:00"),
        after: reading(0.29, "23T21:00:00"),
        costUsd: 2,
      },
    ],
  },
  {
    issue: "BAN-11",
    kind: "design",
    outcome: "no-result",
    endedAt: at("23T23:00:08"),
    runs: [run("23T23:00:05", "23T23:00:07", 0.3, null, 0)],
  },
  {
    issue: "BAN-11",
    kind: "design",
    outcome: "crashed",
    endedAt: at("23T23:55:00"),
    runs: [{ ...run("23T23:30:00", "23T23:55:00", 0.3, null), after: null }],
  },
  {
    issue: "BAN-11",
    kind: "design",
    outcome: "timed-out",
    endedAt: at("24T03:21:00"),
    runs: [run("24T00:20:00", "24T03:20:00", 0.3, 0.36, 6.1)],
  },
  {
    issue: "BAN-11",
    kind: "design",
    outcome: "no-result",
    endedAt: at("24T04:31:00"),
    runs: [run("24T03:50:00", "24T04:30:00", 0.36, 0.385, 2.4)],
  },
  {
    issue: "BAN-11",
    kind: "design",
    outcome: "done",
    endedAt: at("24T05:40:30"),
    runs: [run("24T04:50:00", "24T05:40:00", 0.385, 0.42, 3.2)],
  },
];

export const ACTIVE: ActiveRecord[] = [
  {
    issue: "BAN-12",
    kind: "implement",
    state: "running",
    pid: 4242,
    sessionId: "sess-12",
    runs: [
      {
        startedAt: at("23T22:00:00"),
        endedAt: at("23T23:10:00"),
        log: log("BAN-12", "2026-10-23T22:00:00", "implement"),
        before: reading(0.29, "23T22:00:00"),
        after: reading(0.3, "23T23:10:00"),
        costUsd: 1.1,
      },
      {
        startedAt: at("24T07:20:00"),
        log: log("BAN-12", "2026-10-24T07:20:00", "implement"),
        before: reading(0.42, "24T07:20:00"),
      },
    ],
  },
  {
    issue: "BAN-13",
    kind: "review-round",
    state: "paused",
    pid: null,
    sessionId: "sess-13",
    resetsAt: at("24T10:00:00"),
    runs: [
      {
        startedAt: at("24T05:00:00"),
        endedAt: at("24T06:10:00"),
        log: log("BAN-13", "2026-10-24T05:00:00", "review-round"),
        before: reading(0.4, "24T05:00:00"),
        after: reading(0.42, "24T06:10:00"),
        costUsd: 0.9,
      },
    ],
  },
];

const VARIANTS = [
  { key: "a", slug: "ban-11-a", name: "Dense table", bet: "Every deck on one screen." },
  { key: "b", slug: "ban-11-b", name: "Cards", bet: "Each deck at a glance." },
].map((variant) => ({
  ...variant,
  branch: `dkomeza/ban-11-x-proto-${variant.key}`,
  commit: variant.key.repeat(40),
  states: ["empty"],
}));

const stopResult = (why: string) =>
  crashStop({ kind: "design", issue: "BAN-11", status: "In Design", why });

const closing = (id: string, time: string, json: Record<string, unknown>, userId = RUNNER_ID) => ({
  id,
  createdAt: at(time),
  userId,
  parentId: null,
  body: closingComment(parseResult(json), json),
});
const reply = (id: string, parentId: string, time: string, body: string) => ({
  id,
  createdAt: at(time),
  userId: MAINTAINER.linearId,
  parentId,
  body,
});

const WAIT_STOP = {
  ...stopResult(
    "The Slug Previews weren't up 60 minutes after the design Stage ended: `ban-11-b` (queued).",
  ),
  wait: "slug-previews",
  options: [
    "Dispatch the Slug Preview again (`gh workflow run slug-preview.yml -f branch=<branch> -f slug=<slug> -f ttl_hours=336`), then reply here to wait again",
    "Reply here to wait another 60 minutes",
    "Move the issue to Design Review yourself, without the Runner's hand-off",
  ],
};

const COMMENTS = [
  closing(
    "c1",
    "23T23:00:08",
    stopResult(
      "The design Stage failed before claude started: Can't reach the broker at /run/banki-broker/broker.sock: ECONNREFUSED. Is the broker container up?",
    ),
  ),
  reply("r1", "c1", "23T23:20:00", "The Broker is back up: go on."),
  closing(
    "c2",
    "23T23:55:00",
    stopResult(
      "The design Stage's supervisor is gone, with the issue still In Progress: it crashed, or the Runner restarted.",
    ),
  ),
  reply("r2", "c2", "24T00:10:00", "That was me restarting the Runner. Go again."),
  closing(
    "c3",
    "24T03:21:00",
    stopResult("The design Stage ran for 3 hours, its limit, so the supervisor stopped it."),
  ),
  reply("r3", "c3", "24T03:40:00", "The `ui` stack hung; fixed on main. Again, please."),
  closing(
    "c4",
    "24T04:31:00",
    stopResult(
      "The design Stage ended (claude exited 0) without a result the Runner can use: its result can't be read: result.nextStatus: expected a string.",
    ),
  ),
  reply("r4", "c4", "24T04:40:00", "<script>alert('a comment')</script> Once more."),
  closing("c5", "24T05:40:00", {
    stage: "design",
    issue: "BAN-11",
    outcome: "done",
    summary: "Built two Variants of the deck list: a dense table, and cards.",
    nextStatus: "In Design",
    question: null,
    options: [],
    keptCommits: [],
    pr: null,
    headSha: null,
    pushed: true,
    roundsEnded: null,
    routes: ["/decks"],
    variants: VARIANTS,
    wait: null,
  }),
  closing("c6", "24T06:41:00", WAIT_STOP),
  reply("r6", "c6", "24T07:13:00", "Dispatched ban-11-b again: wait once more."),
];

const status = (time: string, by: string | null, from: string | null, to: string): Move => ({
  at: at(time),
  by,
  status: { from, to },
});
const assign = (time: string, by: string | null, to: string | null): Move => ({
  at: at(time),
  by,
  assignee: { from: to === null ? MAINTAINER.linearId : null, to },
});

const MOVES: Move[] = [
  status("23T20:00:00", MAINTAINER.linearId, "Backlog", "In Design"),
  status("23T23:00:04", RUNNER_ID, "In Design", "In Progress"),
  status("23T23:00:08", RUNNER_ID, "In Progress", "In Design"),
  assign("23T23:00:08", RUNNER_ID, MAINTAINER.linearId),
  assign("23T23:25:00", RUNNER_ID, null),
  status("23T23:29:59", RUNNER_ID, "In Design", "In Progress"),
  status("23T23:55:00", RUNNER_ID, "In Progress", "In Design"),
  assign("23T23:55:00", RUNNER_ID, MAINTAINER.linearId),
  assign("24T00:15:00", RUNNER_ID, null),
  status("24T00:19:59", RUNNER_ID, "In Design", "In Progress"),
  status("24T03:21:00", RUNNER_ID, "In Progress", "In Design"),
  assign("24T03:21:00", RUNNER_ID, MAINTAINER.linearId),
  assign("24T03:45:00", RUNNER_ID, null),
  status("24T03:49:59", RUNNER_ID, "In Design", "In Progress"),
  status("24T04:31:00", RUNNER_ID, "In Progress", "In Design"),
  assign("24T04:31:00", RUNNER_ID, MAINTAINER.linearId),
  assign("24T04:45:00", RUNNER_ID, null),
  status("24T04:49:59", RUNNER_ID, "In Design", "In Progress"),
  status("24T05:40:01", RUNNER_ID, "In Progress", "In Design"),
  assign("24T06:41:00", RUNNER_ID, MAINTAINER.linearId),
  assign("24T07:15:00", RUNNER_ID, null),
];

export function issues(): FakeIssue[] {
  return [
    fakeIssue("BAN-11", {
      title: "Deck list: dense or cards?",
      status: "In Design",
      createdAt: at("20T10:00:00"),
      description: "## Prototype\n\n- **Question**: How dense is the deck list?\n",
      branch: "dkomeza/ban-11-x",
      comments: COMMENTS,
      moves: MOVES,
      history: MOVES.flatMap((move) =>
        move.status === undefined ? [] : [{ at: move.at, ...move.status }],
      ),
    }),
    fakeIssue("BAN-12", { title: "Cloze parsing", status: "In Progress" }),
    fakeIssue("BAN-13", { title: "Review queue", status: "In Progress" }),
    fakeIssue("BAN-14", { title: "Study streaks", status: "Todo", priority: 2 }),
    fakeIssue("BAN-15", {
      title: "Import from Anki",
      status: "In Review",
      branch: "dkomeza/ban-15-import",
    }),
    fakeIssue("BAN-16", { title: "Settings page", status: "In Progress" }),
    fakeIssue("BAN-17", {
      title: "Deck sharing",
      status: "Todo",
      assigneeId: MAINTAINER.linearId,
    }),
  ];
}

/** GitHub, as BAN-11's and BAN-15's waits see it. */
export function github(): GitHub {
  const base = fakeGitHub({
    pr: { number: 38, headSha: "f".repeat(40), open: true, createdAt: at("24T07:00:00") },
    pushedAt: at("24T07:30:00"),
    check: { status: "completed", conclusion: "success" },
    summary: { sha: "fffffff", findings: [] },
    openThreads: 0,
    preview: { state: "queued", description: "", url: null, createdAt: at("24T07:40:00") },
  });
  const slugs = [
    { id: 11, slug: "ban-11-a", sha: VARIANTS[0]?.commit ?? "", createdAt: at("24T05:45:00") },
    { id: 12, slug: "ban-11-b", sha: VARIANTS[1]?.commit ?? "", createdAt: at("24T07:13:00") },
  ];
  const states: Record<number, string | null> = { 11: "success", 12: "queued", 38: "queued" };
  return {
    ...base,
    slugDeployments: async () => slugs,
    newestStatus: async (id) => ({ state: states[id] ?? null, description: "", url: null }),
    recentDeployments: async (environment) =>
      environment === "slug-preview"
        ? slugs.map((found) => ({
            id: found.id,
            environment,
            name: found.slug,
            createdAt: found.createdAt,
          }))
        : [{ id: 38, environment, name: "PR #38", createdAt: at("24T07:40:00") }],
  };
}

const TICKS = [
  ...Array.from({ length: 16 }, (_, i) => ({
    at: new Date(Date.parse(at("24T06:00:00")) + i * 5 * 60_000).toISOString(),
    main: "abc1234",
    line: "Tick on main abc1234",
  })),
  {
    at: at("24T07:15:01"),
    main: "abc1234",
    line: "Handed BAN-11 back: @dkomeza replied to the stop at 2026-10-24T07:13:00.000Z",
  },
  {
    at: at("24T07:15:02"),
    main: "abc1234",
    line: "BAN-11: waiting for the Slug Previews: `ban-11-b` (queued)",
  },
  { at: at("24T07:20:00"), main: "abc1234", line: "Tick on main abc1234" },
  {
    at: at("24T07:20:03"),
    main: "abc1234",
    line: "Started the implement Stage on BAN-12 (resumes): /work/logs/BAN-12/2026-10-24T07-20-00Z-implement.jsonl",
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    at: new Date(Date.parse(at("24T07:25:00")) + i * 5 * 60_000).toISOString(),
    main: "def5678",
    line: "Tick on main def5678",
  })),
].toSorted((a, b) => a.at.localeCompare(b.at));

/** Writes the fixture's records and logs into `work`, shaped like /work. */
export function writeVolume(work: string): void {
  const dispatcher = join(work, "dispatcher");
  mkdirSync(join(dispatcher, "active"), { recursive: true });
  writeFileSync(
    join(dispatcher, "stages.jsonl"),
    `${STAGES.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  for (const record of ACTIVE)
    writeFileSync(join(dispatcher, "active", `${record.issue}.json`), JSON.stringify(record));
  writeFileSync(
    join(dispatcher, "gate.json"),
    JSON.stringify({ reading: reading(0.42, "24T07:55:00"), at: at("24T07:55:00") }),
  );
  writeFileSync(
    join(dispatcher, "ticks.jsonl"),
    `${TICKS.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  for (const [path, lines] of Object.entries({ ...LOGS, ...SUPERVISOR })) {
    const local = join(work, "logs", ...path.split("/").slice(-2));
    mkdirSync(join(local, ".."), { recursive: true });
    writeFileSync(local, `${lines.join("\n")}\n`);
  }
}
