import type { StageKind } from "../cli/args";
import { gateCheck, type Reading } from "./gate";
import { STATUS } from "./select";

// Which ready Stages start this tick (ADR-0013): the paused ones that are due
// first, then the ready queue, urgent issues first, then closest to Done,
// then by Linear priority, then oldest. Each must fit the gate, and at most
// `maxStages` run or wait paused at once. A Stage that doesn't fit leaves
// room for a cheaper one behind it. An urgent issue's Stage skips the
// Ceiling, as it skips the window. Pure, so it is unit-tested.

export type Ready = {
  issue: string;
  status: string;
  /** Linear's: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number;
  createdAt: string;
  stage: StageKind;
  /** A paused Stage, resumed in its own session. */
  resume?: boolean;
};

const CLOSEST_TO_DONE = [STATUS.inReview, STATUS.todo, STATUS.inDesign] as string[];
const rank = (ready: Ready) => {
  const status = CLOSEST_TO_DONE.indexOf(ready.status);
  return status === -1 ? CLOSEST_TO_DONE.length : status;
};
const urgency = (priority: number) => (priority >= 1 && priority <= 4 ? priority : 5);

/** Linear's Urgent: its Stages start outside the window and skip the Ceiling. */
export const isUrgent = (ready: Pick<Ready, "priority">) => ready.priority === 1;

export function order(ready: readonly Ready[]): Ready[] {
  return ready.toSorted(
    (a, b) =>
      Number(isUrgent(b)) - Number(isUrgent(a)) ||
      rank(a) - rank(b) ||
      urgency(a.priority) - urgency(b.priority) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.issue.localeCompare(b.issue),
  );
}

export type Verdict = { ready: Ready; start: boolean; why: string };

/**
 * What happens to each candidate, resumes first and the queue in order:
 * whether it starts, and why or why not.
 */
export function plan(input: {
  resumes: readonly Ready[];
  ready: readonly Ready[];
  /** The gate's reading, or undefined when it failed: then nothing starts. */
  reading: Reading | undefined;
  readingError?: string;
  ceiling: number;
  maxStages: number;
  /** Running or paused Stages, a resume's own included. */
  active: number;
  /** The kinds of the Stages running now. */
  running: readonly StageKind[];
  estimates: Record<StageKind, number>;
  /** run-now --force: skips the Ceiling, and only that. */
  force?: boolean;
}): Verdict[] {
  const runningEstimates = input.running.map((kind) => input.estimates[kind]);
  let active = input.active;
  const verdicts: Verdict[] = [];
  for (const ready of [...input.resumes, ...order(input.ready)]) {
    if (input.reading === undefined) {
      verdicts.push({
        ready,
        start: false,
        why: `the gate has no reading: ${input.readingError ?? "it failed"}`,
      });
      continue;
    }
    if (ready.resume !== true && active >= input.maxStages) {
      verdicts.push({
        ready,
        start: false,
        why: `${input.maxStages} Stages are running or paused already`,
      });
      continue;
    }
    const estimate = input.estimates[ready.stage];
    const check = gateCheck({
      reading: input.reading,
      ceiling: input.ceiling,
      running: runningEstimates,
      estimate,
      force: input.force === true || isUrgent(ready),
    });
    if (!check.ok) {
      verdicts.push({ ready, start: false, why: check.why });
      continue;
    }
    runningEstimates.push(estimate);
    if (ready.resume !== true) active += 1;
    verdicts.push({ ready, start: true, why: ready.resume === true ? "resumes" : "starts" });
  }
  return verdicts;
}
