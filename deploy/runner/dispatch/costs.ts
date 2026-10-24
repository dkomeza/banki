import type { Reading } from "./gate";

// What each Stage cost, and what each kind of Stage is estimated to cost
// (ADR-0013). A Stage's cost is how far `seven_day.utilization` moved between
// the gate's readings before and after it, so the Maintainer's own use while
// it ran counts toward it. Runs that overlapped, taken as one connected group,
// split the group's move in proportion to each one's `total_cost_usd`. A
// paused Stage's cost is the sum over its runs. Pure, so it is unit-tested.

/** One run of a Stage, as the volume records it. A run still going has no end. */
export type CostRun = {
  key: string;
  startedAt: string;
  endedAt?: string;
  before?: Reading | null;
  after?: Reading | null;
  costUsd?: number;
};

/** The default estimate, until a kind has this many recorded costs. */
export const DEFAULT_ESTIMATE = 0.05;
export const ESTIMATE_AFTER = 3;

/**
 * Each finished run's cost, by key. A run lacking either reading (one that
 * crashed) is left out, and so is every run in a group with one still going:
 * its group's move isn't known yet.
 */
export function runCosts(runs: readonly CostRun[]): Map<string, number> {
  const usable = runs
    .filter((run) => run.before != null && (run.endedAt === undefined || run.after != null))
    .map((run) => ({
      run,
      start: Date.parse(run.startedAt),
      end: run.endedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(run.endedAt),
    }))
    .toSorted((a, b) => a.start - b.start);

  const groups: (typeof usable)[] = [];
  let reach = Number.NEGATIVE_INFINITY;
  for (const entry of usable) {
    const last = groups.at(-1);
    if (last !== undefined && entry.start < reach) {
      last.push(entry);
      reach = Math.max(reach, entry.end);
    } else {
      groups.push([entry]);
      reach = entry.end;
    }
  }

  const costs = new Map<string, number>();
  for (const group of groups) {
    if (group.some((entry) => entry.end === Number.POSITIVE_INFINITY)) continue;
    const first = group[0];
    const last = group.reduce((latest, entry) => (entry.end > latest.end ? entry : latest));
    if (first?.run.before == null || last.run.after == null) continue;
    const move = moved(first.run.before, last.run.after);
    const usd = group.map((entry) => Math.max(0, entry.run.costUsd ?? 0));
    const totalUsd = usd.reduce((sum, value) => sum + value, 0);
    group.forEach((entry, i) => {
      const share = totalUsd > 0 ? (usd[i] ?? 0) / totalUsd : 1 / group.length;
      costs.set(entry.run.key, move * share);
    });
  }
  return costs;
}

/**
 * How far the week's utilization moved between two readings. When the weekly
 * window started over in between, what was used since is all that is known.
 */
export function moved(before: Reading, after: Reading): number {
  if (Date.parse(after.sevenDay.resetsAt) > Date.parse(before.sevenDay.resetsAt)) {
    return after.sevenDay.utilization;
  }
  return Math.max(0, after.sevenDay.utilization - before.sevenDay.utilization);
}

/** A kind's estimate: the median of its recorded costs, or the default until it has three. */
export function estimate(costs: readonly number[]): number {
  if (costs.length < ESTIMATE_AFTER) return DEFAULT_ESTIMATE;
  const sorted = costs.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
