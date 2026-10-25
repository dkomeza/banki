import type { StageKind } from "../cli/args";
import { type Closing, MAINTAINER } from "./closing";
import type { StageResult, Variant, Wait } from "./result";
import { RUNS_IN, STATUS } from "./statuses";

// What comes next on one issue (ADR-0013), from its status, its assignee, its
// status history, its closing comments and, for the waits, what GitHub says:
// a Stage to start, a wait that goes on, a hand-off to the Maintainer, a
// stop on them, or nothing. No LLM, and no tokens. Pure, so it is
// unit-tested; tick.ts gathers the facts and acts.

export { RUNS_IN, STATUS } from "./statuses";

/** How long each wait may take (`references/stages.md` § Waits). */
export const DEADLINES_MS: Record<Wait, number> = {
  "slug-previews": 60 * 60_000,
  "claude-review": 45 * 60_000,
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

export type Finding = { status: string; severity: string };

export type ReviewFacts = {
  pr: { number: number; headSha: string; open: boolean; createdAt: string } | null;
  /** When the head SHA was pushed: its check suite's creation. */
  pushedAt: string | null;
  /** The `claude-review` check run on the head SHA, or null before there is one. */
  check: { status: string; conclusion: string | null } | null;
  /** The summary comment: the commit it is at (as it names it, 7 characters) and its findings. */
  summary: { sha: string; findings: Finding[] } | null;
  /** Unresolved review threads `claude-review` started. */
  openThreads: number;
  /** The newest `preview` deployment on the head SHA. */
  preview: Deployment | null;
};

/** Each Variant's newest `slug-preview` deployment at its commit, by Slug. */
export type DesignFacts = Record<string, Deployment | null>;

export type Facts = { review?: ReviewFacts; design?: DesignFacts };

/** A Dispatcher-made stop: the result its closing comment holds. */
export type Stop = Omit<StageResult, "outcome"> & { outcome: "stopped" };

export type Decision =
  | { type: "skip"; why: string }
  /** Unassign the issue, then decide again. */
  | { type: "hand-back"; why: string }
  | { type: "stage"; stage: StageKind; why: string }
  | { type: "wait"; why: string; on?: WaitOn }
  | { type: "hand-off"; to: string; comment: string }
  | { type: "stop"; stop: Stop }
  /** The facts from GitHub this issue's decision needs. */
  | { type: "need"; what: "review" }
  | { type: "need"; what: "design"; variants: Variant[] };

const MINUTE = 60_000;
const AGENT_STATUSES: readonly string[] = [STATUS.todo, STATUS.inDesign, STATUS.inReview];
const short = (sha: string) => sha.slice(0, 7);
const sameSha = (a: string | null, b: string) =>
  a !== null && a.length >= 7 && (a.startsWith(b) || b.startsWith(a));
const later = (a: string, b: string | undefined) => (b !== undefined && b > a ? b : a);
const SIGN_IN =
  "Sign in with the Preview's Email and Password (README § Setting up the server, in `deploy/preview/bootstrap`).";

export function decide(issue: IssueFacts, now: Date, facts: Facts = {}): Decision {
  const { status } = issue;
  if (!AGENT_STATUSES.includes(status)) {
    return { type: "skip", why: `${status} isn't an agent's status` };
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
    return { type: "skip", why: "it is assigned" };
  }

  // A stop waits on the Maintainer; once the issue is unassigned again, its
  // Stage runs again, and a wait's stop restarts the wait.
  const newest = issue.closings.at(-1);
  if (
    newest?.result.outcome === "stopped" &&
    newest.result.wait === null &&
    RUNS_IN[newest.result.stage] === status
  ) {
    return { type: "stage", stage: newest.result.stage, why: "handed back after its stop" };
  }
  const replyAt = newestStop?.replies.at(-1)?.createdAt;

  if (status === STATUS.todo) return { type: "stage", stage: "implement", why: "Todo" };
  if (status === STATUS.inDesign) return inDesign(issue, now, facts.design, replyAt);
  return inReview(issue, now, facts.review, replyAt);
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

  const stop = (summary: string): Decision => ({
    type: "stop",
    stop: dispatcherStop(issue, "design", "slug-previews", summary, [
      "Dispatch the Slug Preview again (`gh workflow run slug-preview.yml -f branch=<branch> -f slug=<slug> -f ttl_hours=336`), then reply here to wait again",
      "Reply here to wait another 60 minutes",
      "Move the issue to Design Review yourself, without the Runner's hand-off",
    ]),
  });
  if (variants.length === 0)
    return stop("The design Stage's result lists no Variants, so there is nothing to wait for.");

  const pending: string[] = [];
  for (const variant of variants) {
    const deployment = design[variant.slug] ?? null;
    if (deployment?.state === "success") continue;
    if (deployment?.state === "failure" || deployment?.state === "inactive") {
      return stop(
        `The Slug Preview \`${variant.slug}\` at \`${short(variant.commit)}\` is ${deployment.state}${deployment.description === "" ? "" : `: ${deployment.description}`}.`,
      );
    }
    pending.push(`\`${variant.slug}\` (${deployment?.state ?? "no deployment yet"})`);
  }
  if (pending.length === 0) {
    return {
      type: "hand-off",
      to: STATUS.designReview,
      comment: designHandOff(issue, round.result, design),
    };
  }
  const since = later(round.at, replyAt);
  const deadline = Date.parse(since) + DEADLINES_MS["slug-previews"];
  if (now.getTime() > deadline) {
    return stop(
      `The Slug Previews weren't up ${DEADLINES_MS["slug-previews"] / MINUTE} minutes after the design Stage ended: ${pending.join(", ")}.`,
    );
  }
  return {
    type: "wait",
    why: `waiting for the Slug Previews: ${pending.join(", ")}`,
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

  const fitsNone = (summary: string): Decision => ({
    type: "stop",
    stop: dispatcherStop(issue, "review-round", null, summary, [
      "Reply here to run a review round again",
      "Move the issue to Acceptance yourself",
      "Push a fix, or an empty commit, to start over on a new head SHA",
    ]),
  });
  const failedWait = (wait: Wait, summary: string, options: string[]): Decision => ({
    type: "stop",
    stop: dispatcherStop(issue, "review-round", wait, summary, options),
  });

  const { pr } = review;
  if (pr === null)
    return fitsNone(`The issue is In Review, but \`${issue.branch}\` has no pull request.`);
  if (!pr.open) return fitsNone(`The issue is In Review, but PR #${pr.number} is closed.`);
  const head = pr.headSha;
  // Without GitHub's check suite, the push is no earlier than the PR, nor than
  // the newest Stage that pushes to it, so the deadlines still hold.
  const pushedAt =
    review.pushedAt ??
    issue.closings
      .filter(
        (closing) =>
          closing.result.stage === "implement" || closing.result.stage === "acceptance-fix",
      )
      .reduce((latest, closing) => later(latest, closing.at), pr.createdAt);
  const pushed = later(pushedAt, replyAt);

  const { check } = review;
  if (check === null || check.status !== "completed") {
    if (now.getTime() > Date.parse(pushed) + DEADLINES_MS["claude-review"]) {
      return failedWait(
        "claude-review",
        `\`claude-review\` hadn't finished on \`${short(head)}\` ${DEADLINES_MS["claude-review"] / MINUTE} minutes after the push (${check === null ? "no check yet" : check.status}).`,
        [
          "Re-run the `claude-review` check (`gh run rerun`), then reply here to wait again",
          "Reply here to wait another 45 minutes",
        ],
      );
    }
    return {
      type: "wait",
      why: `waiting for \`claude-review\` on \`${short(head)}\``,
      on: {
        wait: "claude-review",
        since: pushed,
        deadlineMs: DEADLINES_MS["claude-review"],
        deployments: [],
      },
    };
  }
  if (check.conclusion !== "success" && check.conclusion !== "failure") {
    return failedWait(
      "claude-review",
      `\`claude-review\` ended ${check.conclusion ?? "with no conclusion"} on \`${short(head)}\`, so it didn't review it.`,
      ["Re-run the `claude-review` check (`gh run rerun`), then reply here to wait again"],
    );
  }

  // A round that pushed nothing is on this SHA if it says so, or if it came
  // after this SHA's push: its headSha is the Stage's own, and may be wrong.
  const round = issue.closings.findLast(
    (closing) =>
      ran(closing, "review-round") &&
      !closing.result.pushed &&
      (sameSha(closing.result.headSha, head) || closing.at > pushedAt),
  );
  const findings =
    review.summary !== null && sameSha(review.summary.sha, head)
      ? review.summary.findings.filter(
          (finding) => finding.status === "new" || finding.status === "open",
        )
      : [];
  const toTriage = findings.length > 0 || review.openThreads > 0;
  if (round === undefined && toTriage) {
    return {
      type: "stage",
      stage: "review-round",
      why: `${findings.length} findings and ${review.openThreads} open threads on \`${short(head)}\``,
    };
  }

  // After a round on this SHA, summary-only findings don't hold it back: the
  // round triaged them and answered them in its PR comment.
  if (check.conclusion === "success" && review.openThreads === 0) {
    if (issue.history.some((change) => change.to === STATUS.acceptance && change.at > pushedAt)) {
      return fitsNone(
        `\`${short(head)}\` was handed off to Acceptance already, and the issue is back In Review with no new push and no Acceptance fix to make.`,
      );
    }
    const preview = review.preview;
    const options = [
      "Push an empty commit to rebuild the PR Preview (it re-runs `claude-review`, so a review round follows)",
      "Reply here to wait another 60 minutes",
      "Move the issue to Acceptance yourself, without the PR Preview",
    ];
    if (preview?.state === "success") {
      return {
        type: "hand-off",
        to: STATUS.acceptance,
        comment: acceptanceHandOff(pr.number, preview),
      };
    }
    if (preview?.state === "failure" || preview?.state === "inactive") {
      return failedWait(
        "pr-preview",
        `The PR Preview of \`${short(head)}\` is ${preview.state}${preview.description === "" ? "" : `: ${preview.description}`}.`,
        options,
      );
    }
    if (now.getTime() > Date.parse(pushed) + DEADLINES_MS["pr-preview"]) {
      return failedWait(
        "pr-preview",
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

  const state = `\`claude-review\` ${check.conclusion === "success" ? "passes" : "fails"} on \`${short(head)}\`, with ${findings.length} new or open findings and ${review.openThreads} unresolved threads`;
  return fitsNone(
    round === undefined
      ? `${state}, and nothing for a review round to triage.`
      : `A review round ran on \`${short(head)}\` and pushed nothing, and the rounds haven't ended: ${state}.`,
  );
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
    roundsEnded: null,
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
