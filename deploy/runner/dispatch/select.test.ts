import { describe, expect, test } from "bun:test";
import { type Closing, type Comment, MAINTAINER } from "./closing";
import { parseResult } from "./result";
import {
  decide,
  type Decision,
  type IssueFacts,
  prototypeQuestion,
  type ReviewFacts,
  STATUS,
  type Transition,
} from "./select";

// What comes next on one issue, per status: a Stage, a wait, a hand-off, a
// stop, or nothing.

const HEAD = "a".repeat(40);
const NEXT = "b".repeat(40);
const NOW = new Date("2026-10-24T03:00:00.000Z");
/** A time `minutes` before NOW. */
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function closing(
  at: string,
  fields: Record<string, unknown>,
  replies: Partial<Comment>[] = [],
): Closing {
  const result = parseResult({
    issue: "BAN-7",
    outcome: "done",
    nextStatus: "In Review",
    summary: "",
    ...fields,
  });
  return {
    id: `c-${at}`,
    at,
    result,
    replies: replies.map((reply, i) => ({
      id: `r${i}`,
      body: "go on",
      createdAt: reply.createdAt ?? at,
      userId: MAINTAINER.linearId,
      parentId: `c-${at}`,
    })),
  };
}

function issue(fields: Partial<IssueFacts> = {}): IssueFacts {
  return {
    identifier: "BAN-7",
    priority: 0,
    createdAt: ago(10_000),
    status: STATUS.todo,
    assigneeId: null,
    branch: "dkomeza/ban-7-x",
    description: "",
    history: [],
    closings: [],
    ...fields,
  };
}

const moved = (at: string, from: string | null, to: string): Transition => ({ at, from, to });

function review(fields: Partial<ReviewFacts> = {}): ReviewFacts {
  return {
    pr: { number: 12, headSha: HEAD, open: true, createdAt: ago(600) },
    pushedAt: ago(30),
    check: { status: "completed", conclusion: "success" },
    summary: { sha: HEAD.slice(0, 7), findings: [] },
    openThreads: 0,
    preview: { state: "success", description: "", url: "https://pr-12.banki.dkomeza.com" },
    ...fields,
  };
}

const variant = (key: string) => ({
  key,
  branch: `dkomeza/ban-7-x-proto-${key}`,
  commit: key.repeat(40),
  slug: `ban-7-${key}`,
  name: `Variant ${key.toUpperCase()}`,
  bet: `Bet ${key}.`,
  states: ["empty"],
});
const inDesign = (fields: Partial<IssueFacts> = {}) =>
  issue({
    status: STATUS.inDesign,
    history: [moved(ago(200), STATUS.backlog, STATUS.inDesign)],
    description:
      "## Prototype\n\n- **Question**: How dense is the deck list?\n- **Routes**: /decks\n\n## Other\n",
    ...fields,
  });
const inReview = (fields: Partial<IssueFacts> = {}) =>
  issue({
    status: STATUS.inReview,
    history: [moved(ago(300), STATUS.inProgress, STATUS.inReview)],
    ...fields,
  });
const roundOn = (sha: string, pushed: boolean) =>
  closing(ago(20), { stage: "review-round", nextStatus: STATUS.inReview, headSha: sha, pushed });

const round = (at: string) =>
  closing(at, {
    stage: "design",
    nextStatus: STATUS.inDesign,
    routes: ["/decks"],
    variants: [variant("a"), variant("b")],
  });

/** Review facts with no check suite yet, on a PR opened `minutes` ago. */
const unchecked = (minutes: number) =>
  review({
    pushedAt: null,
    check: null,
    pr: { number: 12, headSha: HEAD, open: true, createdAt: ago(minutes) },
  });

const stageOf = (decision: Decision): string =>
  decision.type === "stage" ? decision.stage : decision.type;
const stopOf = (decision: Decision) => {
  if (decision.type !== "stop") throw new Error(`expected a stop, got ${JSON.stringify(decision)}`);
  return decision.stop;
};

describe("whose move it is", () => {
  test.each([STATUS.backlog, STATUS.designReview, STATUS.acceptance, "Done", "Canceled"])(
    "nothing starts in %s",
    (status) => {
      expect(decide(issue({ status }), NOW).type).toBe("skip");
    },
  );

  test("an assigned issue is held, saying who holds it", () => {
    expect(decide(issue({ assigneeId: MAINTAINER.linearId }), NOW)).toEqual({
      type: "skip",
      why: "it is assigned to @dkomeza",
      held: true,
    });
    expect(decide(issue({ assigneeId: "someone" }), NOW)).toEqual({
      type: "skip",
      why: "it is assigned to Linear user someone",
      held: true,
    });
  });

  test("an issue held after a stop says which stop", () => {
    const stopped = closing(ago(60), {
      stage: "implement",
      outcome: "stopped",
      nextStatus: "Todo",
    });

    expect(decide(issue({ assigneeId: MAINTAINER.linearId, closings: [stopped] }), NOW)).toEqual({
      type: "skip",
      why: `it is assigned to @dkomeza, after its stop of ${ago(60)}`,
      held: true,
    });
  });

  test("the Maintainer's reply in the newest stop's thread hands it back", () => {
    const stopped = closing(
      ago(60),
      { stage: "implement", outcome: "stopped", nextStatus: "Todo" },
      [{ createdAt: ago(5) }],
    );

    expect(decide(issue({ assigneeId: MAINTAINER.linearId, closings: [stopped] }), NOW).type).toBe(
      "hand-back",
    );
  });

  test("a reply made before the Maintainer took the issue again doesn't, so a live session keeps it", () => {
    const stopped = closing(
      ago(60),
      { stage: "implement", outcome: "stopped", nextStatus: "Todo" },
      [{ createdAt: ago(30) }],
    );

    expect(
      decide(
        issue({ assigneeId: MAINTAINER.linearId, assignedAt: ago(10), closings: [stopped] }),
        NOW,
      ).type,
    ).toBe("skip");
    expect(
      decide(
        issue({ assigneeId: MAINTAINER.linearId, assignedAt: ago(59), closings: [stopped] }),
        NOW,
      ).type,
    ).toBe("hand-back");
  });

  test("a stop with no reply in its thread doesn't, while it is assigned", () => {
    const stopped = closing(ago(60), {
      stage: "implement",
      outcome: "stopped",
      nextStatus: "Todo",
    });

    expect(decide(issue({ assigneeId: MAINTAINER.linearId, closings: [stopped] }), NOW).type).toBe(
      "skip",
    );
  });

  test("a reply to an older stop doesn't, once a newer one is waiting", () => {
    const older = closing(
      ago(300),
      { stage: "review-round", outcome: "stopped", nextStatus: "In Review" },
      [{ createdAt: ago(200) }],
    );
    const newer = closing(ago(100), {
      stage: "review-round",
      outcome: "stopped",
      nextStatus: "In Review",
    });

    expect(
      decide(
        issue({
          status: STATUS.inReview,
          assigneeId: MAINTAINER.linearId,
          closings: [older, newer],
        }),
        NOW,
      ).type,
    ).toBe("skip");
  });

  test("once handed back, the stopped Stage runs again", () => {
    const stopped = closing(
      ago(60),
      { stage: "review-round", outcome: "stopped", nextStatus: "In Review", headSha: HEAD },
      [{ createdAt: ago(5) }],
    );

    // A round ran on HEAD, which would be a stop; the hand-back runs it again.
    expect(
      stageOf(
        decide(issue({ status: STATUS.inReview, closings: [stopped] }), NOW, { review: review() }),
      ),
    ).toBe("review-round");
  });
});

describe("Todo", () => {
  test("is the implement Stage", () => {
    expect(stageOf(decide(issue(), NOW))).toBe("implement");
  });
});

describe("In Design", () => {
  const up = { state: "success", description: "", url: null };

  test("is the design Stage, with no round built since it came in", () => {
    expect(stageOf(decide(inDesign(), NOW))).toBe("design");
  });

  test("is the design Stage again after another round is asked for", () => {
    const history = [
      moved(ago(500), STATUS.backlog, STATUS.inDesign),
      moved(ago(300), STATUS.inDesign, STATUS.designReview),
      moved(ago(100), STATUS.designReview, STATUS.inDesign),
    ];

    expect(stageOf(decide(inDesign({ history, closings: [round(ago(400))] }), NOW))).toBe("design");
  });

  test("counts a round built after a pause, since In Progress isn't a way in", () => {
    const history = [
      moved(ago(200), STATUS.backlog, STATUS.inDesign),
      moved(ago(190), STATUS.inDesign, STATUS.inProgress),
      moved(ago(20), STATUS.inProgress, STATUS.inDesign),
    ];

    expect(decide(inDesign({ history, closings: [round(ago(20))] }), NOW).type).toBe("need");
  });

  test("after a done round, asks for its Variants' Slug Previews", () => {
    expect(decide(inDesign({ closings: [round(ago(10))] }), NOW)).toMatchObject({
      type: "need",
      what: "design",
      variants: [{ slug: "ban-7-a" }, { slug: "ban-7-b" }],
    });
  });

  test("waits while a Slug Preview isn't up", () => {
    const decision = decide(inDesign({ closings: [round(ago(10))] }), NOW, {
      design: { "ban-7-a": up, "ban-7-b": { state: "in_progress", description: "", url: null } },
    });

    expect(decision.type).toBe("wait");
  });

  test("hands off to Design Review once every one is up, with the question, the Variants, the states and the sign-in", () => {
    const decision = decide(inDesign({ closings: [round(ago(10))] }), NOW, {
      design: { "ban-7-a": up, "ban-7-b": { ...up, url: "https://ban-7-b.banki.dkomeza.com" } },
    });

    if (decision.type !== "hand-off") throw new Error(`expected a hand-off, got ${decision.type}`);
    expect(decision.to).toBe(STATUS.designReview);
    expect(decision.comment).toContain("**Question:** How dense is the deck list?");
    expect(decision.comment).toContain(
      "- **Variant A** (a): https://ban-7-a.banki.dkomeza.com, at [/decks](https://ban-7-a.banki.dkomeza.com/decks). Bet a.",
    );
    expect(decision.comment).toContain("**Variant B** (b)");
    expect(decision.comment).toContain("`?state=<name>`");
    expect(decision.comment).toContain("`empty`");
    expect(decision.comment).toContain("Email and Password");
    expect(decision.comment).toEndWith("@dkomeza");
  });

  test("stops when a Slug Preview failed", () => {
    const stop = stopOf(
      decide(inDesign({ closings: [round(ago(10))] }), NOW, {
        design: {
          "ban-7-a": up,
          "ban-7-b": { state: "failure", description: "build failed", url: null },
        },
      }),
    );

    expect(stop).toMatchObject({
      stage: "design",
      wait: "slug-previews",
      nextStatus: STATUS.inDesign,
    });
    expect(stop.summary).toContain("`ban-7-b`");
    expect(stop.summary).toContain("build failed");
  });

  test("stops when they aren't up 60 minutes after the design closing comment", () => {
    const facts = { design: { "ban-7-a": up, "ban-7-b": null } };

    expect(decide(inDesign({ closings: [round(ago(59))] }), NOW, facts).type).toBe("wait");
    expect(stopOf(decide(inDesign({ closings: [round(ago(61))] }), NOW, facts)).summary).toContain(
      "60 minutes",
    );
  });

  test("counts the deadline from the hand-back reply when that is later", () => {
    const stopped = closing(
      ago(70),
      { stage: "design", outcome: "stopped", nextStatus: STATUS.inDesign, wait: "slug-previews" },
      [{ createdAt: ago(5) }],
    );
    const decision = decide(inDesign({ closings: [round(ago(120)), stopped] }), NOW, {
      design: { "ban-7-a": up, "ban-7-b": null },
    });

    expect(decision.type).toBe("wait");
  });

  test("says what the wait is on: since when, its deadline, and each Slug Preview's newest state", () => {
    const queued = { state: "queued", description: "", url: null, createdAt: ago(9) };
    const decision = decide(inDesign({ closings: [round(ago(47))] }), NOW, {
      design: { "ban-7-a": up, "ban-7-b": queued },
    });

    expect(decision).toMatchObject({
      type: "wait",
      on: {
        wait: "slug-previews",
        since: ago(47),
        deadlineMs: 60 * 60_000,
        deployments: [
          { name: "ban-7-a", deployment: up },
          { name: "ban-7-b", deployment: queued },
        ],
      },
    });
  });
});

describe("In Review", () => {
  test("is the Acceptance fix after a move back from Acceptance", () => {
    const history = [moved(ago(300), STATUS.acceptance, STATUS.inReview)];

    expect(stageOf(decide(inReview({ history }), NOW))).toBe("acceptance-fix");
  });

  test("isn't, once an Acceptance-fix closing comment has come since", () => {
    const history = [moved(ago(300), STATUS.acceptance, STATUS.inReview)];
    const fix = closing(ago(100), { stage: "acceptance-fix", nextStatus: STATUS.inReview });

    expect(decide(inReview({ history, closings: [fix] }), NOW).type).toBe("need");
  });

  test("is still the Acceptance fix after one that stopped, once a newer stop is on the issue", () => {
    const history = [moved(ago(300), STATUS.acceptance, STATUS.inReview)];
    const stoppedFix = closing(ago(100), {
      stage: "acceptance-fix",
      outcome: "stopped",
      nextStatus: STATUS.inReview,
    });
    const waitStop = closing(
      ago(50),
      {
        stage: "review-round",
        outcome: "stopped",
        nextStatus: STATUS.inReview,
        wait: "claude-review",
      },
      [{ createdAt: ago(5) }],
    );

    expect(stageOf(decide(inReview({ history, closings: [stoppedFix, waitStop] }), NOW))).toBe(
      "acceptance-fix",
    );
  });

  test("reads the move back across a pause in In Progress", () => {
    const history = [
      moved(ago(300), STATUS.acceptance, STATUS.inReview),
      moved(ago(200), STATUS.inReview, STATUS.inProgress),
      moved(ago(100), STATUS.inProgress, STATUS.inReview),
    ];

    expect(stageOf(decide(inReview({ history }), NOW))).toBe("acceptance-fix");
  });

  test("waits for claude-review to finish on the head SHA", () => {
    expect(
      decide(inReview(), NOW, {
        review: review({ check: { status: "in_progress", conclusion: null } }),
      }).type,
    ).toBe("wait");
    expect(decide(inReview(), NOW, { review: review({ check: null }) }).type).toBe("wait");
  });

  test("stops when claude-review hasn't finished 45 minutes after the push", () => {
    const stop = stopOf(
      decide(inReview(), NOW, {
        review: review({ pushedAt: ago(46), check: { status: "queued", conclusion: null } }),
      }),
    );

    expect(stop).toMatchObject({ stage: "review-round", wait: "claude-review" });
  });

  test("stops when claude-review was cancelled or skipped", () => {
    for (const conclusion of ["cancelled", "skipped"]) {
      const stop = stopOf(
        decide(inReview(), NOW, { review: review({ check: { status: "completed", conclusion } }) }),
      );

      expect(stop.summary).toContain(conclusion);
    }
  });

  test("is a review round when there is a new or open finding in the summary", () => {
    const summary = {
      sha: HEAD.slice(0, 7),
      findings: [
        { status: "fixed", severity: "major" },
        { status: "open", severity: "minor" },
      ],
    };

    expect(stageOf(decide(inReview(), NOW, { review: review({ summary }) }))).toBe("review-round");
  });

  test("is a review round when a thread claude-review started is unresolved", () => {
    expect(stageOf(decide(inReview(), NOW, { review: review({ openThreads: 1 }) }))).toBe(
      "review-round",
    );
  });

  test("ignores a summary that is for another commit", () => {
    const summary = { sha: NEXT.slice(0, 7), findings: [{ status: "new", severity: "major" }] };

    expect(decide(inReview(), NOW, { review: review({ summary }) }).type).toBe("hand-off");
  });

  test("is no round when one ran on the head SHA and pushed nothing", () => {
    const decision = decide(inReview({ closings: [roundOn(HEAD, false)] }), NOW, {
      review: review({ openThreads: 1 }),
    });

    expect(stopOf(decision).summary).toContain("the rounds haven't ended");
  });

  test("counts a round that pushed nothing since the push as a round on its SHA, whatever headSha it wrote", () => {
    for (const headSha of [null, "abc"]) {
      const written = closing(ago(10), {
        stage: "review-round",
        nextStatus: STATUS.inReview,
        headSha,
        pushed: false,
      });
      const decision = decide(inReview({ closings: [written] }), NOW, {
        review: review({ openThreads: 1, pushedAt: ago(30) }),
      });

      expect(stopOf(decision).summary).toContain("the rounds haven't ended");
    }
  });

  test("doesn't count a Dispatcher's stop on the head SHA as a round that ran", () => {
    // claude-review was cancelled, the Dispatcher stopped on the wait, and the
    // Maintainer re-ran the check and replied: the first round is still to run.
    const waitStop = closing(
      ago(20),
      {
        stage: "review-round",
        outcome: "stopped",
        nextStatus: STATUS.inReview,
        wait: "claude-review",
        pushed: false,
      },
      [{ createdAt: ago(5) }],
    );
    const summary = { sha: HEAD.slice(0, 7), findings: [{ status: "new", severity: "major" }] };

    expect(
      stageOf(
        decide(inReview({ closings: [waitStop] }), NOW, {
          review: review({ check: { status: "completed", conclusion: "failure" }, summary }),
        }),
      ),
    ).toBe("review-round");
  });

  test("doesn't count a stopped round on the head SHA as one that ran, once a newer stop is on the issue", () => {
    const stoppedRound = closing(ago(25), {
      stage: "review-round",
      outcome: "stopped",
      nextStatus: STATUS.inReview,
      headSha: HEAD,
      pushed: false,
    });
    const waitStop = closing(
      ago(20),
      {
        stage: "review-round",
        outcome: "stopped",
        nextStatus: STATUS.inReview,
        wait: "claude-review",
      },
      [{ createdAt: ago(5) }],
    );

    expect(
      stageOf(
        decide(inReview({ closings: [stoppedRound, waitStop] }), NOW, {
          review: review({ openThreads: 1 }),
        }),
      ),
    ).toBe("review-round");
  });

  test("goes on to the PR Preview and Acceptance after a round that pushed nothing, while the summary still lists findings but no thread is open", () => {
    // The round triaged them, and answered the summary-only ones in its PR comment.
    const summary = { sha: HEAD.slice(0, 7), findings: [{ status: "open", severity: "minor" }] };
    const closings = [roundOn(HEAD, false)];
    const building = { state: "in_progress", description: "", url: null };

    expect(
      decide(inReview({ closings }), NOW, { review: review({ summary, openThreads: 0 }) }).type,
    ).toBe("hand-off");
    expect(
      decide(inReview({ closings }), NOW, {
        review: review({ summary, openThreads: 0, preview: building }),
      }).type,
    ).toBe("wait");
  });

  test("doesn't count a round from before the push as one on the new SHA", () => {
    const older = closing(ago(60), {
      stage: "review-round",
      nextStatus: STATUS.inReview,
      headSha: null,
      pushed: false,
    });

    expect(
      stageOf(
        decide(inReview({ closings: [older] }), NOW, {
          review: review({ openThreads: 1, pushedAt: ago(30) }),
        }),
      ),
    ).toBe("review-round");
  });

  test("without GitHub's push time, counts the claude-review deadline from the PR's creation", () => {
    expect(decide(inReview(), NOW, { review: unchecked(40) }).type).toBe("wait");
    expect(stopOf(decide(inReview(), NOW, { review: unchecked(50) }))).toMatchObject({
      wait: "claude-review",
    });
  });

  test("without it, counts from the newest implement or Acceptance-fix closing comment when that is later", () => {
    const fix = closing(ago(20), { stage: "acceptance-fix", nextStatus: STATUS.inReview });
    const facts = review({
      pushedAt: null,
      check: null,
      pr: { number: 12, headSha: HEAD, open: true, createdAt: ago(600) },
    });

    expect(decide(inReview({ closings: [fix] }), NOW, { review: facts }).type).toBe("wait");
  });

  test("is a round on the new head SHA after a round that pushed", () => {
    const decision = decide(inReview({ closings: [roundOn(HEAD, true)] }), NOW, {
      review: review({ openThreads: 1 }),
    });

    expect(stageOf(decision)).toBe("review-round");
  });

  test("hands off to Acceptance once claude-review passes, every thread is resolved and the PR Preview is up", () => {
    const decision = decide(inReview({ closings: [roundOn(HEAD, false)] }), NOW, {
      review: review(),
    });

    if (decision.type !== "hand-off") throw new Error(`expected a hand-off, got ${decision.type}`);
    expect(decision.to).toBe(STATUS.acceptance);
    expect(decision.comment).toContain("https://pr-12.banki.dkomeza.com");
    expect(decision.comment).toContain("https://github.com/dkomeza/banki/pull/12");
    expect(decision.comment).toContain("Email and Password");
    expect(decision.comment).toEndWith("@dkomeza");
  });

  test("waits for the PR Preview, up to 60 minutes after the push", () => {
    const building = { state: "in_progress", description: "", url: null };

    expect(
      decide(inReview(), NOW, { review: review({ preview: building, pushedAt: ago(59) }) }).type,
    ).toBe("wait");
    expect(
      stopOf(decide(inReview(), NOW, { review: review({ preview: null, pushedAt: ago(61) }) })),
    ).toMatchObject({
      wait: "pr-preview",
    });
  });

  test("says what its waits are on, from the push: claude-review, then the PR Preview", () => {
    const building = { state: "queued", description: "", url: null, createdAt: ago(20) };

    expect(decide(inReview(), NOW, { review: review({ check: null }) })).toMatchObject({
      type: "wait",
      on: { wait: "claude-review", since: ago(30), deadlineMs: 45 * 60_000, deployments: [] },
    });
    expect(decide(inReview(), NOW, { review: review({ preview: building }) })).toMatchObject({
      type: "wait",
      on: {
        wait: "pr-preview",
        since: ago(30),
        deadlineMs: 60 * 60_000,
        deployments: [{ name: "PR #12", deployment: building }],
      },
    });
  });

  test("stops when the PR Preview failed or went inactive", () => {
    for (const state of ["failure", "inactive"]) {
      const preview = { state, description: "seed exited 1", url: null };
      const stop = stopOf(decide(inReview(), NOW, { review: review({ preview }) }));

      expect(stop.wait).toBe("pr-preview");
      expect(stop.summary).toContain("seed exited 1");
    }
  });

  test("hands off at most once per head SHA", () => {
    const history = [
      moved(ago(300), STATUS.inProgress, STATUS.inReview),
      moved(ago(20), STATUS.inReview, STATUS.acceptance),
      moved(ago(10), STATUS.acceptance, STATUS.inReview),
    ];
    const fix = closing(ago(5), {
      stage: "acceptance-fix",
      nextStatus: STATUS.inReview,
      pushed: false,
    });

    expect(
      stopOf(decide(inReview({ history, closings: [fix] }), NOW, { review: review() })).summary,
    ).toContain("handed off to Acceptance already");
  });

  test("stops, saying what it found, when claude-review fails with nothing to triage", () => {
    const decision = decide(inReview(), NOW, {
      review: review({ check: { status: "completed", conclusion: "failure" } }),
    });

    expect(stopOf(decision)).toMatchObject({ stage: "review-round", wait: null });
    expect(stopOf(decision).summary).toContain("fails");
  });

  test("stops when the branch has no open pull request", () => {
    expect(stopOf(decide(inReview(), NOW, { review: review({ pr: null }) })).summary).toContain(
      "no pull request",
    );
  });

  test("counts the claude-review deadline from the hand-back reply when that is later", () => {
    const stopped = closing(
      ago(50),
      {
        stage: "review-round",
        outcome: "stopped",
        nextStatus: STATUS.inReview,
        wait: "claude-review",
      },
      [{ createdAt: ago(5) }],
    );
    const decision = decide(inReview({ closings: [stopped] }), NOW, {
      review: review({ pushedAt: ago(120), check: { status: "queued", conclusion: null } }),
    });

    expect(decision.type).toBe("wait");
  });
});

describe("the Prototype section's question", () => {
  test("is read from the section", () => {
    expect(
      prototypeQuestion("Intro\n\n## Prototype\n\n- **Question**: Which layout?\n\n## Next\n"),
    ).toBe("Which layout?");
  });

  test("is missing without the section", () => {
    expect(prototypeQuestion("- **Question**: Not this one\n")).toBeUndefined();
  });
});
