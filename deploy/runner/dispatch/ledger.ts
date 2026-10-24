import type { StageKind } from "../cli/args";
import { type CostRun, estimate, runCosts } from "./costs";
import type { ActiveRecord, StageRecord } from "./lifecycle";

// The Stages' costs and each kind's estimate, from what the volume records:
// every run of every Stage, ended or not, so that a run still going holds
// back the cost of every run it overlapped. Pure, so it is unit-tested.

export type Ledger = {
  /** Each ended Stage's cost, in the order given, or undefined while it isn't known. */
  costs: (number | undefined)[];
  estimates: Record<StageKind, number>;
};

export function ledger(stages: readonly StageRecord[], active: readonly ActiveRecord[]): Ledger {
  const runs: CostRun[] = [
    ...stages.flatMap((stage, i) => stage.runs.map((run, j) => ({ ...run, key: `s${i}:${j}` }))),
    ...active.flatMap((record) =>
      record.runs.map((run, j) => ({ ...run, key: `a${record.issue}:${j}` })),
    ),
  ];
  const known = runCosts(runs);
  const costs = stages.map((stage, i) => {
    const measured = stage.runs
      .map((run, j) => ({ run, key: `s${i}:${j}` }))
      .filter(({ run }) => run.before != null && run.after != null);
    if (measured.length === 0 || measured.some(({ key }) => !known.has(key))) return undefined;
    return measured.reduce((sum, { key }) => sum + (known.get(key) ?? 0), 0);
  });
  const of = (kind: StageKind) =>
    estimate(
      stages.flatMap((stage, i) =>
        stage.kind === kind && costs[i] !== undefined ? [costs[i]] : [],
      ),
    );
  const estimates: Record<StageKind, number> = {
    design: of("design"),
    implement: of("implement"),
    "review-round": of("review-round"),
    "acceptance-fix": of("acceptance-fix"),
  };
  return { costs, estimates };
}
