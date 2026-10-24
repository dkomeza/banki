import { describe, expect, test } from "bun:test";
import { type CostRun, DEFAULT_ESTIMATE, estimate, runCosts } from "./costs";
import type { Reading } from "./gate";

// What the Stages cost, from the gate's readings around them.

const WEEK_RESETS = "2026-10-27T01:00:00.000Z";
const reading = (sevenDay: number, resetsAt = WEEK_RESETS): Reading => ({
  at: "2026-10-24T00:00:00.000Z",
  fiveHour: { utilization: 0.1, resetsAt: "2026-10-24T05:00:00.000Z" },
  sevenDay: { utilization: sevenDay, resetsAt },
});
const t = (hour: number) => new Date(Date.UTC(2026, 9, 24, hour)).toISOString();

function run(
  key: string,
  from: number,
  to: number | undefined,
  before: number,
  after: number | undefined,
  costUsd = 1,
): CostRun {
  return {
    key,
    startedAt: t(from),
    endedAt: to === undefined ? undefined : t(to),
    before: reading(before),
    after: after === undefined ? undefined : reading(after),
    costUsd,
  };
}

const rounded = (costs: Map<string, number>) =>
  Object.fromEntries([...costs].map(([key, cost]) => [key, Math.round(cost * 1e6) / 1e6]));

describe("a run's cost", () => {
  test("is how far the week moved between its readings, when it ran alone", () => {
    expect(rounded(runCosts([run("a", 1, 2, 0.4, 0.43), run("b", 3, 4, 0.43, 0.45)]))).toEqual({
      a: 0.03,
      b: 0.02,
    });
  });

  test("splits an overlapping group's move by each run's dollar cost", () => {
    // a: 1–3, b: 2–5, c: 4–6, all connected; the week moved 0.40 → 0.52.
    const costs = runCosts([
      run("a", 1, 3, 0.4, 0.44, 1),
      run("b", 2, 5, 0.42, 0.5, 2),
      run("c", 4, 6, 0.48, 0.52, 3),
    ]);

    expect(rounded(costs)).toEqual({ a: 0.02, b: 0.04, c: 0.06 });
  });

  test("splits evenly when no run reported a dollar cost", () => {
    expect(rounded(runCosts([run("a", 1, 3, 0.4, 0.45, 0), run("b", 2, 4, 0.41, 0.5, 0)]))).toEqual(
      {
        a: 0.05,
        b: 0.05,
      },
    );
  });

  test("waits while a run in its group is still going", () => {
    const costs = runCosts([
      run("c", 1, 2, 0.4, 0.41),
      run("a", 4, 6, 0.41, 0.44),
      run("b", 5, undefined, 0.42, undefined),
    ]);

    expect(rounded(costs)).toEqual({ c: 0.01 });
  });

  test("leaves out a run that crashed, with no reading after it", () => {
    expect(rounded(runCosts([{ ...run("a", 1, 2, 0.4, 0.5), after: null }]))).toEqual({});
  });

  test("is never negative, and is what was used since when the week started over", () => {
    expect(rounded(runCosts([run("a", 1, 2, 0.4, 0.38)]))).toEqual({ a: 0 });
    expect(
      rounded(
        runCosts([
          { ...run("a", 1, 2, 0.9, 0.04), after: reading(0.04, "2026-11-03T01:00:00.000Z") },
        ]),
      ),
    ).toEqual({ a: 0.04 });
  });
});

describe("a kind's estimate", () => {
  test("is the default until it has three costs", () => {
    expect(estimate([])).toBe(DEFAULT_ESTIMATE);
    expect(estimate([0.2, 0.3])).toBe(0.05);
  });

  test("is then the median of its costs", () => {
    expect(estimate([0.03, 0.1, 0.02])).toBe(0.03);
    expect(estimate([0.04, 0.01, 0.02, 0.1])).toBe(0.03);
  });
});
