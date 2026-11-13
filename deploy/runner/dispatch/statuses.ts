import type { StageKind } from "../cli/args";
import type { Wait } from "./result";

// The Linear statuses the pipeline runs on (ADR-0013), the one each kind of
// Stage runs in, and the ones a Stage's result may send its issue to
// (`references/stages.md`'s table). A result is LLM-written, so a status
// outside these is never applied. Pure, so it is unit-tested.

export const STATUS = {
  backlog: "Backlog",
  inDesign: "In Design",
  designReview: "Design Review",
  todo: "Todo",
  inReview: "In Review",
  acceptance: "Acceptance",
  inProgress: "In Progress",
} as const;

/**
 * The statuses each kind of Stage runs in. The Rebase Stage runs wherever a
 * pull request waits on its PR Preview or on the Maintainer.
 */
export const RUNS_IN: Record<StageKind, readonly string[]> = {
  design: [STATUS.inDesign],
  implement: [STATUS.todo],
  "acceptance-fix": [STATUS.inReview],
  rebase: [STATUS.inReview, STATUS.acceptance],
};

/** The statuses whose issues the Dispatcher decides on each tick. */
export const WATCHED: readonly string[] = [
  STATUS.todo,
  STATUS.inDesign,
  STATUS.inReview,
  STATUS.acceptance,
];

/** Where a done Stage leaves its issue, or undefined for where it ran. */
const DONE_IN: Record<StageKind, string | undefined> = {
  design: STATUS.inDesign,
  implement: STATUS.inReview,
  "acceptance-fix": STATUS.inReview,
  rebase: undefined,
};

/** Where the Dispatcher's stop on a wait leaves its issue: where it waited. */
const WAITS_IN: Record<Wait, string> = {
  "slug-previews": STATUS.inDesign,
  "pr-preview": STATUS.inReview,
};

/**
 * The statuses a result of this kind and outcome may name: a stop stays where
 * its Stage runs, or, on a wait, where it waited. A Stage that runs in more
 * than one status leaves the issue in the one it ran from, which the
 * Dispatcher reads from the issue's history, not from the result.
 */
export function allowedNext(
  kind: StageKind,
  outcome: "done" | "stopped",
  wait: Wait | null = null,
): readonly string[] {
  if (wait !== null) return [WAITS_IN[wait]];
  const done = outcome === "done" ? DONE_IN[kind] : undefined;
  return done === undefined ? RUNS_IN[kind] : [done];
}

/** Why a result's `nextStatus` can't be applied, or undefined when it can. */
export function badNextStatus(result: {
  stage: StageKind;
  outcome: "done" | "stopped";
  nextStatus: string;
  wait?: Wait | null;
}): string | undefined {
  const allowed = allowedNext(result.stage, result.outcome, result.wait);
  if (allowed.includes(result.nextStatus)) return undefined;
  return `its nextStatus is ${JSON.stringify(result.nextStatus)}, and a ${result.outcome === "done" ? "done" : "stopped"} ${result.stage} Stage leaves the issue in ${allowed.join(" or ")}`;
}
