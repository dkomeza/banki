import { describe, expect, test } from "bun:test";
import type { StageKind } from "../cli/args";
import type { Reading } from "./gate";
import { ledger } from "./ledger";
import type { ActiveRecord, RunRecord, StageRecord } from "./lifecycle";

// The Stages' costs and the estimates learned from them.

const reading = (sevenDay: number): Reading => ({
  at: "2026-10-24T00:00:00.000Z",
  fiveHour: { utilization: 0.1, resetsAt: "2026-10-24T05:00:00.000Z" },
  sevenDay: { utilization: sevenDay, resetsAt: "2026-10-27T00:00:00.000Z" },
});
const t = (hour: number) => new Date(Date.UTC(2026, 9, 20, hour)).toISOString();
const run = (from: number, to: number | undefined, before: number, after?: number): RunRecord => ({
  startedAt: t(from),
  endedAt: to === undefined ? undefined : t(to),
  log: "",
  before: reading(before),
  after: after === undefined ? undefined : reading(after),
  costUsd: 1,
});
const stage = (kind: StageKind, runs: RunRecord[]): StageRecord => ({
  issue: "BAN-1",
  kind,
  outcome: "done",
  endedAt: runs.at(-1)?.endedAt ?? t(0),
  runs,
});
const round = (values: (number | undefined)[]) =>
  values.map((value) => (value === undefined ? value : Math.round(value * 1000) / 1000));

describe("the ledger", () => {
  test("costs a paused Stage the sum over its runs", () => {
    const { costs } = ledger(
      [stage("implement", [run(1, 2, 0.1, 0.12), run(7, 8, 0.2, 0.23)])],
      [],
    );

    expect(round(costs)).toEqual([0.05]);
  });

  test("holds back a cost while a run it overlapped is still going", () => {
    const running: ActiveRecord = {
      issue: "BAN-2",
      kind: "design",
      state: "running",
      pid: 1,
      runs: [run(2, undefined, 0.11)],
    };

    expect(ledger([stage("implement", [run(1, 3, 0.1, 0.15)])], [running]).costs).toEqual([
      undefined,
    ]);
  });

  test("has no cost for a Stage that crashed without a reading after it", () => {
    expect(ledger([stage("implement", [{ ...run(1, 2, 0.1), after: null }])], []).costs).toEqual([
      undefined,
    ]);
  });

  test("estimates each kind from its known costs, the default until it has three", () => {
    const { estimates } = ledger(
      [
        stage("implement", [run(1, 2, 0.1, 0.2)]),
        stage("implement", [run(3, 4, 0.2, 0.22)]),
        stage("implement", [run(5, 6, 0.22, 0.25)]),
        stage("design", [run(7, 8, 0.25, 0.4)]),
      ],
      [],
    );

    expect(round([estimates.implement, estimates.design, estimates["review-round"]])).toEqual([
      0.03, 0.05, 0.05,
    ]);
  });
});
