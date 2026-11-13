import { describe, expect, test } from "bun:test";
import { type Closing, type Comment, MAINTAINER } from "./closing";
import { parseResult } from "./result";
import {
  decide,
  type Decision,
  type IssueFacts,
  prototypeQuestion,
  type ReviewFacts,
  SLUG_REDEPLOYS,
  STATUS,
  type Transition,
} from "./select";

// What comes next on one issue, per status: a Stage, a wait, a hand-off, a
// stop, or nothing.

const HEAD = "a".repeat(40);
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
const round = (at: string) =>
  closing(at, {
    stage: "design",
    nextStatus: STATUS.inDesign,
    routes: ["/decks"],
    variants: [variant("a"), variant("b")],
  });

/** Review facts with no check suite nor PR Preview yet, on a PR opened `minutes` ago. */
const unchecked = (minutes: number) =>
  review({
    pushedAt: null,
    preview: null,
    pr: { number: 12, headSha: HEAD, open: true, createdAt: ago(minutes) },
  });

const stageOf = (decision: Decision): string =>
  decision.type === "stage" ? decision.stage : decision.type;
const stopOf = (decision: Decision) => {
  if (decision.type !== "stop") throw new Error(`expected a stop, got ${JSON.stringify(decision)}`);
  return decision.stop;
};

describe("whose move it is", () => {
  test.each([STATUS.backlog, STATUS.designReview, "Done", "Canceled"])(
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
      { stage: "acceptance-fix", outcome: "stopped", nextStatus: "In Review" },
      [{ createdAt: ago(200) }],
    );
    const newer = closing(ago(100), {
      stage: "acceptance-fix",
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
      { stage: "acceptance-fix", outcome: "stopped", nextStatus: "In Review", headSha: HEAD },
      [{ createdAt: ago(5) }],
    );

    // The PR Preview is up, which would be a hand-off; the hand-back runs the fix again.
    expect(
      stageOf(
        decide(issue({ status: STATUS.inReview, closings: [stopped] }), NOW, { review: review() }),
      ),
    ).toBe("acceptance-fix");
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

  const failed = {
    state: "failure",
    description: "Pangolin: couldn't create the resource",
    url: null,
  };

  test("dispatches a failed Slug Preview again, rather than stopping on the Maintainer", () => {
    const decision = decide(inDesign({ closings: [round(ago(10))] }), NOW, {
      design: { "ban-7-a": up, "ban-7-b": failed },
      designTries: { "ban-7-a": [ago(15)], "ban-7-b": [ago(15)] },
    });

    if (decision.type !== "redeploy") throw new Error(`expected a redeploy, got ${decision.type}`);
    expect(decision.variants.map((redeployed) => redeployed.slug)).toEqual(["ban-7-b"]);
    expect(decision.why).toContain("Pangolin: couldn't create the resource");
  });

  test(`stops once the Runner dispatched it again ${SLUG_REDEPLOYS} times since the round`, () => {
    const stop = stopOf(
      decide(inDesign({ closings: [round(ago(30))] }), NOW, {
        design: { "ban-7-a": up, "ban-7-b": failed },
        designTries: { "ban-7-b": [ago(35), ago(20), ago(10)] },
      }),
    );

    expect(stop).toMatchObject({
      stage: "design",
      wait: "slug-previews",
      nextStatus: STATUS.inDesign,
    });
    expect(stop.summary).toBe(
      "The Slug Preview `ban-7-b` at `bbbbbbb` is failure: Pangolin: couldn't create the resource, after the Runner dispatched it again 2 times.",
    );
    expect(stop.options[0]).toContain("the Runner dispatches the failed Slug Previews again");
  });

  test("a reply to the stop starts the retries over", () => {
    const stopped = closing(
      ago(25),
      { stage: "design", outcome: "stopped", nextStatus: STATUS.inDesign, wait: "slug-previews" },
      [{ createdAt: ago(5) }],
    );
    const decision = decide(inDesign({ closings: [round(ago(30)), stopped] }), NOW, {
      design: { "ban-7-a": up, "ban-7-b": failed },
      designTries: { "ban-7-b": [ago(35), ago(20), ago(10)] },
    });

    expect(decision.type).toBe("redeploy");
  });

  test("stops on a failure past the deadline, however few the retries", () => {
    const decision = decide(inDesign({ closings: [round(ago(61))] }), NOW, {
      design: { "ban-7-a": up, "ban-7-b": failed },
      designTries: { "ban-7-b": [ago(65)] },
    });

    expect(stopOf(decision).summary).toContain("`ban-7-b`");
  });

  test("stops on a Slug Preview gone inactive, with the command that brings it back", () => {
    const stop = stopOf(
      decide(inDesign({ closings: [round(ago(10))] }), NOW, {
        design: { "ban-7-a": up, "ban-7-b": { state: "inactive", description: "", url: null } },
      }),
    );

    expect(stop.summary).toContain("is inactive");
    expect(stop.options[0]).toContain(
      "`gh workflow run slug-preview.yml -f branch=dkomeza/ban-7-x-proto-b -f slug=ban-7-b -f ttl_hours=336`",
    );
  });

  test("stops when they aren't up 60 minutes after the design closing comment", () => {
    const facts = { design: { "ban-7-a": up, "ban-7-b": null } };

    expect(decide(inDesign({ closings: [round(ago(59))] }), NOW, facts).type).toBe("wait");
    const stop = stopOf(decide(inDesign({ closings: [round(ago(61))] }), NOW, facts));
    expect(stop.summary).toContain("60 minutes");
    expect(stop.options.join("\n")).toContain("-f branch=dkomeza/ban-7-x-proto-b -f slug=ban-7-b");
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
        stage: "acceptance-fix",
        outcome: "stopped",
        nextStatus: STATUS.inReview,
        wait: "pr-preview",
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

  test("without GitHub's push time, counts the PR Preview deadline from the PR's creation", () => {
    expect(decide(inReview(), NOW, { review: unchecked(50) }).type).toBe("wait");
    expect(stopOf(decide(inReview(), NOW, { review: unchecked(70) }))).toMatchObject({
      wait: "pr-preview",
    });
  });

  test("without it, counts from the newest implement or Acceptance-fix closing comment when that is later", () => {
    const fix = closing(ago(20), { stage: "acceptance-fix", nextStatus: STATUS.inReview });
    const facts = unchecked(600);

    expect(decide(inReview(), NOW, { review: facts }).type).toBe("stop");
    expect(decide(inReview({ closings: [fix] }), NOW, { review: facts }).type).toBe("wait");
  });

  test("hands off to Acceptance once the PR Preview is up", () => {
    const decision = decide(inReview(), NOW, { review: review() });

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

  test("says what its wait is on, from the push: the PR Preview", () => {
    const building = { state: "queued", description: "", url: null, createdAt: ago(20) };

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

  test("stops when the branch has no open pull request", () => {
    expect(stopOf(decide(inReview(), NOW, { review: review({ pr: null }) })).summary).toContain(
      "no pull request",
    );
    const closed = { number: 12, headSha: HEAD, open: false, createdAt: ago(600) };
    expect(stopOf(decide(inReview(), NOW, { review: review({ pr: closed }) })).summary).toContain(
      "PR #12 is closed",
    );
  });

  test("stops on the PR Preview wait, naming the Stage that last pushed to the PR", () => {
    const failed = review({ preview: { state: "failure", description: "", url: null } });
    const implemented = closing(ago(200), { stage: "implement", nextStatus: STATUS.inReview });
    const fix = closing(ago(100), { stage: "acceptance-fix", nextStatus: STATUS.inReview });

    expect(stopOf(decide(inReview(), NOW, { review: failed }))).toMatchObject({
      stage: "implement",
      wait: "pr-preview",
      nextStatus: STATUS.inReview,
    });
    expect(
      stopOf(decide(inReview({ closings: [implemented, fix] }), NOW, { review: failed })),
    ).toMatchObject({ stage: "acceptance-fix", wait: "pr-preview" });
    expect(stopOf(decide(inReview(), NOW, { review: review({ pr: null }) }))).toMatchObject({
      stage: "implement",
      wait: "pr-preview",
    });
  });

  test("counts the PR Preview deadline from the hand-back reply, and runs no Stage again", () => {
    const stopped = closing(
      ago(50),
      {
        stage: "acceptance-fix",
        outcome: "stopped",
        nextStatus: STATUS.inReview,
        wait: "pr-preview",
      },
      [{ createdAt: ago(5) }],
    );
    const decision = decide(inReview({ closings: [stopped] }), NOW, {
      review: review({ pushedAt: ago(120), preview: null }),
    });

    expect(decision).toMatchObject({ type: "wait", on: { wait: "pr-preview", since: ago(5) } });
  });
});

const conflicting = (fields: Partial<ReviewFacts> = {}) =>
  review({
    pr: { number: 12, headSha: HEAD, open: true, createdAt: ago(600), conflicting: true },
    preview: null,
    mainAt: ago(40),
    ...fields,
  });
const inAcceptance = (fields: Partial<IssueFacts> = {}) =>
  issue({
    status: STATUS.acceptance,
    history: [
      moved(ago(300), STATUS.inProgress, STATUS.inReview),
      moved(ago(200), STATUS.inReview, STATUS.acceptance),
    ],
    ...fields,
  });
const rebased = (at: string, fields: Record<string, unknown> = {}) =>
  closing(at, { stage: "rebase", nextStatus: STATUS.inReview, headSha: HEAD, ...fields });

describe("a pull request that conflicts with main", () => {
  test("is rebased In Review, before the PR Preview wait, which GitHub never builds for it", () => {
    expect(decide(inReview(), NOW, { review: conflicting() })).toEqual({
      type: "stage",
      stage: "rebase",
      why: "PR #12 conflicts with main",
    });
  });

  test("is rebased in Acceptance too, and an Acceptance issue that merges cleanly is left alone", () => {
    expect(decide(inAcceptance(), NOW).type).toBe("need");
    expect(stageOf(decide(inAcceptance(), NOW, { review: conflicting() }))).toBe("rebase");
    expect(decide(inAcceptance(), NOW, { review: review() })).toMatchObject({ type: "skip" });
    expect(decide(inAcceptance(), NOW, { review: review({ pr: null }) })).toMatchObject({
      type: "skip",
    });
  });

  test("isn't rebased while GitHub hasn't said, nor while the Maintainer holds the issue", () => {
    expect(decide(inReview(), NOW, { review: review() }).type).toBe("hand-off");
    expect(
      decide(inAcceptance({ assigneeId: MAINTAINER.linearId }), NOW, { review: conflicting() }),
    ).toMatchObject({ type: "skip", held: true });
  });

  test("leaves a move back from Acceptance to the Acceptance fix, which rebases first", () => {
    const history = [moved(ago(300), STATUS.acceptance, STATUS.inReview)];

    expect(stageOf(decide(inReview({ history }), NOW, { review: conflicting() }))).toBe(
      "acceptance-fix",
    );
  });

  test("is rebased again once main has moved since the newest Rebase Stage on this head", () => {
    expect(
      stageOf(decide(inReview({ closings: [rebased(ago(60))] }), NOW, { review: conflicting() })),
    ).toBe("rebase");
    const other = rebased(ago(20), { headSha: "b".repeat(40) });
    expect(stageOf(decide(inReview({ closings: [other] }), NOW, { review: conflicting() }))).toBe(
      "rebase",
    );
  });

  test("stops when the newest Rebase Stage ended on this head and main hasn't moved since", () => {
    const stop = stopOf(
      decide(inAcceptance({ closings: [rebased(ago(20))] }), NOW, { review: conflicting() }),
    );

    expect(stop).toMatchObject({ stage: "rebase", wait: null, nextStatus: STATUS.acceptance });
    expect(stop.summary).toContain("still conflicts");
  });

  test("runs the Rebase Stage again on a reply to its stop, in Acceptance as In Review", () => {
    const stopped = closing(
      ago(20),
      { stage: "rebase", outcome: "stopped", nextStatus: STATUS.acceptance },
      [{ createdAt: ago(5) }],
    );

    expect(decide(inAcceptance({ closings: [stopped] }), NOW)).toEqual({
      type: "stage",
      stage: "rebase",
      why: "handed back after its stop",
    });
  });

  test("restarts a PR Preview wait on a reply, and rebases when the PR conflicts", () => {
    const waitStop = closing(
      ago(50),
      { stage: "implement", outcome: "stopped", nextStatus: STATUS.inReview, wait: "pr-preview" },
      [{ createdAt: ago(5) }],
    );

    expect(
      stageOf(decide(inReview({ closings: [waitStop] }), NOW, { review: conflicting() })),
    ).toBe("rebase");
  });

  test("a Rebase Stage in Acceptance is no hand-off, and its push is the one the PR Preview waits on", () => {
    const history = [
      moved(ago(300), STATUS.inProgress, STATUS.inReview),
      moved(ago(200), STATUS.inReview, STATUS.acceptance),
      moved(ago(40), STATUS.acceptance, STATUS.inProgress),
      moved(ago(20), STATUS.inProgress, STATUS.acceptance),
      moved(ago(10), STATUS.acceptance, STATUS.inReview),
    ];
    const fix = closing(ago(5), { stage: "acceptance-fix", nextStatus: STATUS.inReview });
    const failed = { state: "failure", description: "", url: null };

    expect(
      decide(inReview({ history, closings: [fix] }), NOW, { review: review({ pushedAt: ago(30) }) })
        .type,
    ).toBe("hand-off");
    expect(
      stopOf(
        decide(inReview({ closings: [rebased(ago(20))] }), NOW, {
          review: review({ preview: failed }),
        }),
      ),
    ).toMatchObject({ stage: "rebase", wait: "pr-preview" });
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
