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

/** The status each kind of Stage runs in. */
export const RUNS_IN: Record<StageKind, string> = {
  design: STATUS.inDesign,
  implement: STATUS.todo,
  "acceptance-fix": STATUS.inReview,
};

/** Where a done Stage leaves its issue. */
const DONE_IN: Record<StageKind, string> = {
  design: STATUS.inDesign,
  implement: STATUS.inReview,
  "acceptance-fix": STATUS.inReview,
};

/** Where the Dispatcher's stop on a wait leaves its issue: where it waited. */
const WAITS_IN: Record<Wait, string> = {
  "slug-previews": STATUS.inDesign,
  "pr-preview": STATUS.inReview,
};

/**
 * The status a result of this kind and outcome must name: a stop stays where
 * its Stage runs, or, on a wait, where it waited.
 */
export function allowedNext(
  kind: StageKind,
  outcome: "done" | "stopped",
  wait: Wait | null = null,
): string {
  if (outcome === "done") return DONE_IN[kind];
  return wait === null ? RUNS_IN[kind] : WAITS_IN[wait];
}

/** Why a result's `nextStatus` can't be applied, or undefined when it can. */
export function badNextStatus(result: {
  stage: StageKind;
  outcome: "done" | "stopped";
  nextStatus: string;
  wait?: Wait | null;
}): string | undefined {
  const allowed = allowedNext(result.stage, result.outcome, result.wait);
  if (result.nextStatus === allowed) return undefined;
  return `its nextStatus is ${JSON.stringify(result.nextStatus)}, and a ${result.outcome === "done" ? "done" : "stopped"} ${result.stage} Stage leaves the issue in ${allowed}`;
}
