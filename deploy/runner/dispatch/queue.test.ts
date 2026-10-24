import { describe, expect, test } from "bun:test";
import type { StageKind } from "../cli/args";
import type { Reading } from "./gate";
import { order, plan, type Ready } from "./queue";
import { STATUS } from "./select";

// The ready queue's order, and which Stages start under the gate and the cap.

const ready = (issue: string, status: string, fields: Partial<Ready> = {}): Ready => ({
  issue,
  status,
  priority: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  stage:
    status === STATUS.inReview ? "review-round" : status === STATUS.todo ? "implement" : "design",
  ...fields,
});
const reading = (sevenDay: number, fiveHour = 0.1): Reading => ({
  at: "2026-10-24T01:00:00.000Z",
  fiveHour: { utilization: fiveHour, resetsAt: "2026-10-24T05:00:00.000Z" },
  sevenDay: { utilization: sevenDay, resetsAt: "2026-10-27T00:00:00.000Z" },
});
const ESTIMATES: Record<StageKind, number> = {
  design: 0.05,
  implement: 0.1,
  "review-round": 0.03,
  "acceptance-fix": 0.04,
};
const base = {
  resumes: [],
  ceiling: 0.6,
  maxStages: 2,
  active: 0,
  running: [],
  estimates: ESTIMATES,
};
const started = (verdicts: ReturnType<typeof plan>) =>
  verdicts.filter((verdict) => verdict.start).map((verdict) => verdict.ready.issue);

describe("the ready queue", () => {
  test("runs closest to Done first, then by priority, then oldest", () => {
    const queue = order([
      ready("BAN-1", STATUS.inDesign, { priority: 1 }),
      ready("BAN-2", STATUS.todo, { priority: 0 }),
      ready("BAN-3", STATUS.todo, { priority: 4 }),
      ready("BAN-4", STATUS.todo, { priority: 1, createdAt: "2026-10-02T00:00:00.000Z" }),
      ready("BAN-5", STATUS.todo, { priority: 1, createdAt: "2026-09-02T00:00:00.000Z" }),
      ready("BAN-6", STATUS.inReview, { priority: 3 }),
      ready("BAN-7", STATUS.todo, { priority: 2 }),
    ]);

    expect(queue.map((item) => item.issue)).toEqual([
      "BAN-6",
      "BAN-5",
      "BAN-4",
      "BAN-7",
      "BAN-3",
      "BAN-2",
      "BAN-1",
    ]);
  });
});

describe("what starts", () => {
  test("starts in order up to the cap", () => {
    const verdicts = plan({
      ...base,
      reading: reading(0.2),
      ready: [
        ready("BAN-1", STATUS.todo),
        ready("BAN-2", STATUS.inReview),
        ready("BAN-3", STATUS.inDesign),
      ],
    });

    expect(started(verdicts)).toEqual(["BAN-2", "BAN-1"]);
    expect(verdicts[2]?.why).toBe("2 Stages are running or paused already");
  });

  test("counts the paused and running Stages toward the cap", () => {
    expect(
      started(
        plan({ ...base, active: 2, reading: reading(0.2), ready: [ready("BAN-1", STATUS.todo)] }),
      ),
    ).toEqual([]);
  });

  test("lets a cheaper Stage start when the next one doesn't fit", () => {
    // 0.5 + implement 0.1 is over 0.6; 0.5 + review-round 0.03 isn't.
    const verdicts = plan({
      ...base,
      reading: reading(0.5),
      ready: [
        ready("BAN-1", STATUS.todo, { priority: 1 }),
        ready("BAN-2", STATUS.inDesign),
        ready("BAN-3", STATUS.inReview, { stage: "review-round" }),
      ],
    });

    expect(started(verdicts)).toEqual(["BAN-3", "BAN-2"]);
  });

  test("adds each one it starts to the Stages running", () => {
    const verdicts = plan({
      ...base,
      maxStages: 5,
      running: ["implement"],
      reading: reading(0.4),
      ready: [
        ready("BAN-1", STATUS.inDesign),
        ready("BAN-2", STATUS.inDesign),
        ready("BAN-3", STATUS.inDesign),
      ],
    });

    // 0.4 + 0.1 running + 0.05 = 0.55; a second design makes 0.6, still within; a third, 0.65, isn't.
    expect(started(verdicts)).toEqual(["BAN-1", "BAN-2"]);
  });

  test("resumes a due paused Stage ahead of the queue, without a new slot, still behind the gate", () => {
    const resume = ready("BAN-9", STATUS.inProgress, { stage: "implement", resume: true });

    expect(
      started(
        plan({
          ...base,
          active: 2,
          resumes: [resume],
          reading: reading(0.2),
          ready: [ready("BAN-1", STATUS.todo)],
        }),
      ),
    ).toEqual(["BAN-9"]);
    expect(
      started(
        plan({ ...base, active: 2, resumes: [resume], reading: reading(0.2, 0.85), ready: [] }),
      ),
    ).toEqual([]);
  });

  test("starts nothing without a reading", () => {
    const verdicts = plan({
      ...base,
      reading: undefined,
      readingError: "claude exited 1",
      ready: [ready("BAN-1", STATUS.todo)],
    });

    expect(started(verdicts)).toEqual([]);
    expect(verdicts[0]?.why).toContain("claude exited 1");
  });

  test("forced, skips the Ceiling but not the cap or the five-hour check", () => {
    const one = [ready("BAN-1", STATUS.todo)];

    expect(started(plan({ ...base, force: true, reading: reading(0.95), ready: one }))).toEqual([
      "BAN-1",
    ]);
    expect(
      started(plan({ ...base, force: true, active: 2, reading: reading(0.1), ready: one })),
    ).toEqual([]);
    expect(started(plan({ ...base, force: true, reading: reading(0.1, 0.9), ready: one }))).toEqual(
      [],
    );
  });
});
