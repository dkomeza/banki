import type { StageKind } from "../cli/args";

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
  "review-round": STATUS.inReview,
  "acceptance-fix": STATUS.inReview,
};

/** Where a done Stage leaves its issue. */
const DONE_IN: Record<StageKind, string> = {
  design: STATUS.inDesign,
  implement: STATUS.inReview,
  "review-round": STATUS.inReview,
  "acceptance-fix": STATUS.inReview,
};

/** The status a result of this kind and outcome must name: a stop stays where its Stage runs. */
export function allowedNext(kind: StageKind, outcome: "done" | "stopped"): string {
  return outcome === "stopped" ? RUNS_IN[kind] : DONE_IN[kind];
}

/** Why a result's `nextStatus` can't be applied, or undefined when it can. */
export function badNextStatus(result: {
  stage: StageKind;
  outcome: "done" | "stopped";
  nextStatus: string;
}): string | undefined {
  const allowed = allowedNext(result.stage, result.outcome);
  if (result.nextStatus === allowed) return undefined;
  return `its nextStatus is ${JSON.stringify(result.nextStatus)}, and a ${result.outcome === "done" ? "done" : "stopped"} ${result.stage} Stage leaves the issue in ${allowed}`;
}
