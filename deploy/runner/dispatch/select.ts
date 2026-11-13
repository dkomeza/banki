import type { StageKind } from "../cli/args";
import { type Closing, MAINTAINER } from "./closing";
import type { StageResult, Variant, Wait } from "./result";
import { RUNS_IN, STATUS, WATCHED } from "./statuses";

// What comes next on one issue (ADR-0013), from its status, its assignee, its
// status history, its closing comments and, for the waits and the pull
// request's conflicts with `main` (ADR-0035), what GitHub says:
// a Stage to start, a wait that goes on, a hand-off to the Maintainer, a
// stop on them, or nothing. No LLM, and no tokens. Pure, so it is
// unit-tested; tick.ts gathers the facts and acts.

export { RUNS_IN, STATUS, WATCHED } from "./statuses";

/** How long each wait may take (`references/stages.md` § Waits). */
export const DEADLINES_MS: Record<Wait, number> = {
  "slug-previews": 60 * 60_000,
  "pr-preview": 60 * 60_000,
};

export type Transition = { at: string; from: string | null; to: string };

export type IssueFacts = {
  identifier: string;
  /** Linear's: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number;
  createdAt: string;
  status: string;
  assigneeId: string | null;
  /** When it was last assigned or unassigned, from its history, if that says. */
  assignedAt?: string;
  branch: string;
  description: string;
  /** Status changes, oldest first. */
  history: Transition[];
  closings: Closing[];
};

/** A deployment's newest status, or none yet. */
export type Deployment = {
  state: string | null;
  description: string;
  url: string | null;
  /** When the deployment was made, for the Dashboard's pull-agent flag. */
  createdAt?: string;
};

/** What a wait is on, for the Dashboard: since when its deadline runs, and the deployments it waits for. */
export type WaitOn = {
  wait: Wait;
  since: string;
  deadlineMs: number;
  /** Each deployment it waits for, by name (a Slug, or the PR), with its newest state, or null for none yet. */
  deployments: { name: string; deployment: Deployment | null }[];
};

export type ReviewFacts = {
  pr: {
    number: number;
    headSha: string;
    open: boolean;
    createdAt: string;
    /** GitHub says it can't merge into `main`; unset while GitHub works it out. */
    conflicting?: boolean;
  } | null;
  /** When `main`'s tip was committed, read only when the pull request conflicts. */
  mainAt?: string;
  /** When the head SHA was pushed: its check suite's creation. */
  pushedAt: string | null;
  /** The newest `preview` deployment on the head SHA. */
  preview: Deployment | null;
};

/** Each Variant's newest `slug-preview` deployment at its commit, by Slug. */
export type DesignFacts = Record<string, Deployment | null>;

/** When each of a Variant's `slug-preview` deployments at its commit was made, by Slug. */
export type DesignTries = Record<string, string[]>;

export type Facts = { review?: ReviewFacts; design?: DesignFacts; designTries?: DesignTries };

/**
 * How many times the Dispatcher dispatches a failed Slug Preview again, since
 * the round or the Maintainer's newest reply to a stop, before it stops on
 * them. Most failures are the home server's uplink stalling, and pass.
 */
export const SLUG_REDEPLOYS = 2;

/** A Dispatcher-made stop: the result its closing comment holds. */
export type Stop = Omit<StageResult, "outcome"> & { outcome: "stopped" };

export type Decision =
  /** `held`: an assignee holds it, which `runner status` lists. */
  | { type: "skip"; why: string; held?: true }
  /** Unassign the issue, then decide again. */
  | { type: "hand-back"; why: string }
  | { type: "stage"; stage: StageKind; why: string }
  | { type: "wait"; why: string; on?: WaitOn }
  | { type: "hand-off"; to: string; comment: string }
  | { type: "stop"; stop: Stop }
  /** Dispatch these Variants' Slug Previews again, then go on waiting. */
  | { type: "redeploy"; why: string; variants: Variant[] }
  /** The facts from GitHub this issue's decision needs. */
  | { type: "need"; what: "review" }
  | { type: "need"; what: "design"; variants: Variant[] };

const MINUTE = 60_000;
const short = (sha: string) => sha.slice(0, 7);
const later = (a: string, b: string | undefined) => (b !== undefined && b > a ? b : a);
const SIGN_IN =
  "Sign in with the Preview's Email and Password (README § Setting up the server, in `deploy/preview/bootstrap`).";

export function decide(issue: IssueFacts, now: Date, facts: Facts = {}): Decision {
  const { status } = issue;
  if (!WATCHED.includes(status)) {
    return { type: "skip", why: `the Runner doesn't watch ${status}` };
  }
  const stops = issue.closings.filter((closing) => closing.result.outcome === "stopped");
  const newestStop = stops.at(-1);
  if (issue.assigneeId !== null) {
    if (issue.assigneeId === MAINTAINER.linearId && newestStop !== undefined) {
      // A reply from before the Maintainer took the issue again, to run it
      // live, hands nothing back.
      const reply = newestStop.replies.at(-1);
      if (
        reply !== undefined &&
        (issue.assignedAt === undefined || reply.createdAt > issue.assignedAt)
      ) {
        return {
          type: "hand-back",
          why: `@${MAINTAINER.handle} replied to the stop at ${reply.createdAt}`,
        };
      }
    }
    return { type: "skip", why: heldBy(issue.assigneeId, issue.closings.at(-1)), held: true };
  }

  // A stop waits on the Maintainer; once the issue is unassigned again, its
  // Stage runs again, and a wait's stop restarts the wait.
  const newest = issue.closings.at(-1);
  if (
    newest?.result.outcome === "stopped" &&
    newest.result.wait === null &&
    RUNS_IN[newest.result.stage].includes(status)
  ) {
    return { type: "stage", stage: newest.result.stage, why: "handed back after its stop" };
  }
  const replyAt = newestStop?.replies.at(-1)?.createdAt;

  if (status === STATUS.todo) return { type: "stage", stage: "implement", why: "Todo" };
  if (status === STATUS.inDesign)
    return inDesign(issue, now, facts.design, facts.designTries, replyAt);
  if (status === STATUS.acceptance) return inAcceptance(issue, facts.review);
  return inReview(issue, now, facts.review, replyAt);
}

/** Who holds an assigned issue, and the stop it is held on, when its newest closing comment is one. */
function heldBy(assigneeId: string, newest: Closing | undefined): string {
  if (assigneeId !== MAINTAINER.linearId) return `it is assigned to Linear user ${assigneeId}`;
  const stop = newest?.result.outcome === "stopped" ? `, after its stop of ${newest.at}` : "";
  return `it is assigned to @${MAINTAINER.handle}${stop}`;
}

/**
 * Whether this closing comment is a `stage` that ran to its end. A stop (the
 * Stage's own, or the Dispatcher's on a wait, a crash or a timeout) isn't: it
 * runs again through the hand-back.
 */
const ran = (closing: Closing, stage: StageKind) =>
  closing.result.stage === stage && closing.result.outcome === "done";

/** When the issue last moved into `status` from one of `from` (any, when empty), or undefined. */
function lastEntry(issue: IssueFacts, status: string, from: readonly string[] = []) {
  return issue.history.findLast(
    (change) =>
      change.to === status &&
      change.from !== STATUS.inProgress &&
      (from.length === 0 || (change.from !== null && from.includes(change.from))),
  );
}

function inDesign(
  issue: IssueFacts,
  now: Date,
  design: DesignFacts | undefined,
  tries: DesignTries | undefined,
  replyAt: string | undefined,
): Decision {
  const entered =
    lastEntry(issue, STATUS.inDesign, [STATUS.backlog, STATUS.designReview])?.at ?? issue.createdAt;
  const round = issue.closings.findLast(
    (closing) => ran(closing, "design") && closing.at > entered,
  );
  if (round === undefined)
    return {
      type: "stage",
      stage: "design",
      why: "In Design, with no round built since it came in",
    };
  const { variants } = round.result;
  if (design === undefined) return { type: "need", what: "design", variants };

  const stop = (summary: string, options: string[]): Decision => ({
    type: "stop",
    stop: dispatcherStop(issue, "design", "slug-previews", summary, [
      ...options,
      "Move the issue to Design Review yourself, without the Runner's hand-off",
    ]),
  });
  if (variants.length === 0)
    return stop(
      "The design Stage's result lists no Variants, so there is nothing to wait for.",
      [],
    );

  // The deadline and the retries both count from the round, or from the
  // Maintainer's newest reply to a stop: a reply starts them over.
  const since = later(round.at, replyAt);
  const late = now.getTime() > Date.parse(since) + DEADLINES_MS["slug-previews"];
  const redeploysOf = (variant: Variant) =>
    (tries?.[variant.slug] ?? []).filter((at) => at > since).length;
  const pending: Variant[] = [];
  const failed: Variant[] = [];
  for (const variant of variants) {
    const deployment = design[variant.slug] ?? null;
    if (deployment?.state === "success") continue;
    if (deployment?.state === "inactive") {
      // Taken down, or past its time to live: dispatching it again is the
      // Maintainer's call.
      return stop(
        `The Slug Preview \`${variant.slug}\` at \`${short(variant.commit)}\` is inactive${deployment.description === "" ? "" : `: ${deployment.description}`}.`,
        [`${dispatchAgain([variant])}, then reply here to wait for it`],
      );
    }
    (deployment?.state === "failure" ? failed : pending).push(variant);
  }

  if (failed.length > 0) {
    if (!late && failed.every((variant) => redeploysOf(variant) < SLUG_REDEPLOYS)) {
      return {
        type: "redeploy",
        why: `dispatching again the failed Slug Previews: ${failed.map((variant) => `\`${variant.slug}\` (${design[variant.slug]?.description || "failure"})`).join(", ")}`,
        variants: failed,
      };
    }
    const summaries = failed.map((variant) => {
      const description = design[variant.slug]?.description ?? "";
      const redeploys = redeploysOf(variant);
      const after =
        redeploys === 0
          ? ""
          : `, after the Runner dispatched it again ${redeploys === 1 ? "once" : `${redeploys} times`}`;
      return `The Slug Preview \`${variant.slug}\` at \`${short(variant.commit)}\` is failure${description === "" ? "" : `: ${description}`}${after}.`;
    });
    return stop(summaries.join(" "), [
      "Reply here: the Runner dispatches the failed Slug Previews again and waits for them",
    ]);
  }
  if (pending.length === 0) {
    return {
      type: "hand-off",
      to: STATUS.designReview,
      comment: designHandOff(issue, round.result, design),
    };
  }
  const states = pending.map(
    (variant) => `\`${variant.slug}\` (${design[variant.slug]?.state ?? "no deployment yet"})`,
  );
  if (late) {
    return stop(
      `The Slug Previews weren't up ${DEADLINES_MS["slug-previews"] / MINUTE} minutes after the design Stage ended: ${states.join(", ")}.`,
      ["Reply here to wait another 60 minutes", `${dispatchAgain(pending)}, then reply here`],
    );
  }
  return {
    type: "wait",
    why: `waiting for the Slug Previews: ${states.join(", ")}`,
    on: {
      wait: "slug-previews",
      since,
      deadlineMs: DEADLINES_MS["slug-previews"],
      deployments: variants.map((variant) => ({
        name: variant.slug,
        deployment: design[variant.slug] ?? null,
      })),
    },
  };
}

function inReview(
  issue: IssueFacts,
  now: Date,
  review: ReviewFacts | undefined,
  replyAt: string | undefined,
): Decision {
  const entered = lastEntry(issue, STATUS.inReview);
  if (
    entered?.from === STATUS.acceptance &&
    !issue.closings.some((closing) => ran(closing, "acceptance-fix") && closing.at > entered.at)
  ) {
    return { type: "stage", stage: "acceptance-fix", why: "back from Acceptance" };
  }
  if (review === undefined) return { type: "need", what: "review" };

  const pushes = issue.closings.filter((closing) => closing.result.stage !== "design");
  // A stop here is on the PR Preview wait, so a reply waits again rather than
  // running a Stage; it names the Stage that last pushed to the PR.
  const pusher = pushes.at(-1)?.result.stage ?? "implement";
  const stop = (summary: string, options: string[]): Decision => ({
    type: "stop",
    stop: dispatcherStop(issue, pusher, "pr-preview", summary, options),
  });
  const moveYourself = "Move the issue to Acceptance yourself, without the PR Preview";

  const { pr } = review;
  if (pr === null)
    return stop(`The issue is In Review, but \`${issue.branch}\` has no pull request.`, [
      "Open the pull request, then reply here to wait for its PR Preview",
      moveYourself,
    ]);
  if (!pr.open)
    return stop(`The issue is In Review, but PR #${pr.number} is closed.`, [
      "Reopen the pull request, then reply here to wait for its PR Preview",
      moveYourself,
    ]);
  // GitHub builds no PR Preview of a pull request that conflicts.
  const conflict = onConflict(issue, review);
  if (conflict !== undefined) return conflict;
  const head = pr.headSha;
  // Without GitHub's check suite, the push is no earlier than the PR, nor than
  // the newest Stage that pushes to it, so the deadline still holds.
  const pushedAt =
    review.pushedAt ?? pushes.reduce((latest, closing) => later(latest, closing.at), pr.createdAt);
  const pushed = later(pushedAt, replyAt);

  // A Rebase Stage that ran in Acceptance ends there again, which is no hand-off.
  if (
    issue.history.some(
      (change) =>
        change.to === STATUS.acceptance &&
        change.from !== STATUS.inProgress &&
        change.at > pushedAt,
    )
  ) {
    return stop(
      `\`${short(head)}\` was handed off to Acceptance already, and the issue is back In Review with no new push and no Acceptance fix to make.`,
      [
        "Push a fix, then reply here to wait for its PR Preview",
        "Move the issue back to Acceptance yourself",
      ],
    );
  }
  const preview = review.preview;
  const options = [
    "Push an empty commit to rebuild the PR Preview, then reply here to wait for it",
    "Reply here to wait another 60 minutes",
    moveYourself,
  ];
  if (preview?.state === "success") {
    return {
      type: "hand-off",
      to: STATUS.acceptance,
      comment: acceptanceHandOff(pr.number, preview),
    };
  }
  if (preview?.state === "failure" || preview?.state === "inactive") {
    return stop(
      `The PR Preview of \`${short(head)}\` is ${preview.state}${preview.description === "" ? "" : `: ${preview.description}`}.`,
      options,
    );
  }
  if (now.getTime() > Date.parse(pushed) + DEADLINES_MS["pr-preview"]) {
    return stop(
      `The PR Preview of \`${short(head)}\` wasn't up ${DEADLINES_MS["pr-preview"] / MINUTE} minutes after the push (${preview?.state ?? "no deployment yet"}).`,
      options,
    );
  }
  return {
    type: "wait",
    why: `waiting for the PR Preview of \`${short(head)}\``,
    on: {
      wait: "pr-preview",
      since: pushed,
      deadlineMs: DEADLINES_MS["pr-preview"],
      deployments: [{ name: `PR #${pr.number}`, deployment: preview }],
    },
  };
}

/**
 * In Acceptance, the issue is the Maintainer's, but for its pull request
 * conflicting with `main`, which can't be merged until it is rebased.
 */
function inAcceptance(issue: IssueFacts, review: ReviewFacts | undefined): Decision {
  if (review === undefined) return { type: "need", what: "review" };
  const { pr } = review;
  if (pr === null || !pr.open)
    return { type: "skip", why: "it is in Acceptance, with no open pull request" };
  return (
    onConflict(issue, review) ?? {
      type: "skip",
      why: `it is in Acceptance, and PR #${pr.number} doesn't conflict with main`,
    }
  );
}

/**
 * The Rebase Stage, when the open pull request conflicts with `main`; or a
 * stop, when the newest Rebase Stage ended on this head SHA and `main` hasn't
 * moved since, as it would run again to the same end. Undefined when it
 * doesn't conflict, or GitHub hasn't said yet.
 */
function onConflict(issue: IssueFacts, review: ReviewFacts): Decision | undefined {
  const { pr, mainAt } = review;
  if (pr?.conflicting !== true) return undefined;
  const rebased = issue.closings.findLast((closing) => ran(closing, "rebase"));
  if (
    rebased !== undefined &&
    rebased.result.headSha === pr.headSha &&
    (mainAt === undefined || mainAt <= rebased.at)
  ) {
    return {
      type: "stop",
      stop: dispatcherStop(
        issue,
        "rebase",
        null,
        `The Rebase Stage of ${rebased.at} ended on \`${short(pr.headSha)}\`, and PR #${pr.number} still conflicts with \`main\`, which hasn't moved since.`,
        [
          "Reply here: the Runner runs the Rebase Stage again",
          "Rebase the branch yourself, then reply here",
        ],
      ),
    };
  }
  return { type: "stage", stage: "rebase", why: `PR #${pr.number} conflicts with main` };
}

function dispatcherStop(
  issue: IssueFacts,
  stage: StageKind,
  wait: Wait | null,
  summary: string,
  options: string[],
): Stop {
  return {
    stage,
    issue: issue.identifier,
    outcome: "stopped",
    summary,
    nextStatus: issue.status,
    question: "What should the Runner do?",
    options,
    keptCommits: [],
    pr: null,
    headSha: null,
    pushed: false,
    routes: [],
    variants: [],
    wait,
  };
}

/** The Prototype section's Question, from the issue's description. */
export function prototypeQuestion(description: string): string | undefined {
  const section = /^##\s+Prototype\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(description)?.[1] ?? "";
  const line = /^\s*[-*]?\s*\*\*Question\*\*\s*:?\s*(.+)$/m.exec(section)?.[1];
  return line?.replace(/^:\s*/, "").trim();
}

const previewUrl = (slug: string) => `https://${slug}.banki.dkomeza.com`;

/** "Dispatch it again (`gh workflow run …`)", with each Variant's own command. */
const dispatchAgain = (variants: readonly Variant[]) => {
  const commands = variants.map(
    (variant) =>
      `\`gh workflow run slug-preview.yml -f branch=${variant.branch} -f slug=${variant.slug} -f ttl_hours=336\``,
  );
  return `Dispatch ${variants.length === 1 ? "it" : "them"} again (${commands.join(", ")})`;
};

function designHandOff(issue: IssueFacts, result: StageResult, design: DesignFacts): string {
  const question = prototypeQuestion(issue.description);
  const lines = result.variants.map((variant) => {
    const base = (design[variant.slug]?.url ?? previewUrl(variant.slug)).replace(/\/$/, "");
    const routes = result.routes.map((route) => `[${route}](${base}${route})`).join(", ");
    return `- **${variant.name}** (${variant.key}): ${base}${routes === "" ? "" : `, at ${routes}`}. ${variant.bet}`;
  });
  const states = [...new Set(result.variants.flatMap((variant) => variant.states))];
  return [
    "**Ready for Design Review**",
    ...(question === undefined ? [] : [`**Question:** ${question}`]),
    lines.join("\n"),
    ...(states.length === 0
      ? []
      : [
          `States to try, with \`?state=<name>\` on a route: ${states.map((state) => `\`${state}\``).join(", ")}.`,
        ]),
    SIGN_IN,
    `@${MAINTAINER.handle}`,
  ].join("\n\n");
}

function acceptanceHandOff(pr: number, preview: Deployment): string {
  return [
    "**Ready for Acceptance**",
    [
      `- PR Preview: ${preview.url ?? `https://pr-${pr}.banki.dkomeza.com`}`,
      `- PR: https://github.com/dkomeza/banki/pull/${pr} (its body has the before/after shots)`,
    ].join("\n"),
    SIGN_IN,
    `@${MAINTAINER.handle}`,
  ].join("\n\n");
}
