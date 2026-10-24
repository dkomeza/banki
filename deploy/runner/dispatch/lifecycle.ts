import { STAGE_KINDS, type StageKind } from "../cli/args";
import { asObject, isRecord } from "../lib/parse";
import type { Reading } from "./gate";
import { parseResult, type StageResult } from "./result";
import { STATUS, type Stop, type Transition } from "./select";
import type { LogFacts } from "./stage-log";

// A Stage's life under its supervisor, as the Runner's volume records it: it
// runs, it may be paused by the five-hour limit and resumed in its own
// session, and it ends with its result, or with a timeout or a crash, which
// stop on the Maintainer. Pure, so it is unit-tested; supervisor.ts and
// tick.ts act on it.

export type RunRecord = {
  startedAt: string;
  endedAt?: string;
  /** The run's stream-json log. */
  log: string;
  before: Reading | null;
  after?: Reading | null;
  costUsd?: number;
};

/** A Stage running under its supervisor, or paused until the five-hour window starts over. */
export type ActiveRecord = {
  issue: string;
  kind: StageKind;
  state: "running" | "paused";
  /** The supervisor's, while it runs. */
  pid: number | null;
  /** Every run so far, the one going on included. */
  runs: RunRecord[];
  sessionId?: string;
  resetsAt?: string;
};

export type Outcome = "done" | "stopped" | "timed-out" | "no-result" | "crashed" | "abandoned";
/** A Stage that has ended, kept for its cost. */
export type StageRecord = {
  issue: string;
  kind: StageKind;
  outcome: Outcome;
  endedAt: string;
  runs: RunRecord[];
};

/** The limit on the time a Stage actually runs, across its runs. */
export const STAGE_LIMIT_MS = 3 * 60 * 60_000;
/** How long after SIGTERM a Stage that hasn't ended gets SIGKILL. */
export const KILL_AFTER_MS = 60_000;

/** The time a Stage has left to run, after the runs it has had. */
export function timeLeft(runs: readonly RunRecord[]): number {
  const used = runs.reduce(
    (sum, run) =>
      sum + (run.endedAt === undefined ? 0 : Date.parse(run.endedAt) - Date.parse(run.startedAt)),
    0,
  );
  return Math.max(0, STAGE_LIMIT_MS - used);
}

export type Ending =
  | { type: "closing"; result: StageResult; json: Record<string, unknown> }
  | { type: "paused"; resetsAt: string }
  | { type: "crash"; outcome: "timed-out" | "no-result"; why: string };

/** How a run ended: with the Stage's result, paused by the five-hour limit, or as a crash. */
export function ending(input: {
  kind: StageKind;
  issue: string;
  /** The result the Stage wrote during this run, as JSON, if it wrote one. */
  result: unknown;
  timedOut: boolean;
  exitCode: number;
  log: LogFacts;
  now: Date;
}): Ending {
  if (input.timedOut) {
    return {
      type: "crash",
      outcome: "timed-out",
      why: `The ${input.kind} Stage ran for ${STAGE_LIMIT_MS / 3_600_000} hours, its limit, so the supervisor stopped it.`,
    };
  }
  let problem: string | undefined;
  if (input.result !== undefined) {
    try {
      const result = parseResult(input.result);
      if (result.stage === input.kind && result.issue.toUpperCase() === input.issue.toUpperCase()) {
        return { type: "closing", result, json: asObject(input.result, "result") };
      }
      problem = `its result is for the ${result.stage} Stage on ${result.issue}`;
    } catch (error) {
      problem = `its result can't be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (input.log.fiveHourLimit !== undefined) {
    return {
      type: "paused",
      resetsAt:
        input.log.fiveHourLimit.resetsAt ??
        new Date(input.now.getTime() + 60 * 60_000).toISOString(),
    };
  }
  return {
    type: "crash",
    outcome: "no-result",
    why: `The ${input.kind} Stage ended (claude exited ${input.exitCode}) without a result the Runner can use${problem === undefined ? "" : `: ${problem}`}.`,
  };
}

/** The status the issue had before it last went In Progress, to restore after a crash. */
export function statusBefore(history: readonly Transition[]): string | undefined {
  return history.findLast((change) => change.to === STATUS.inProgress)?.from ?? undefined;
}

/** The stop a timeout or a crash makes, its log's tail beside it in the comment. */
export function crashStop(input: {
  kind: StageKind;
  issue: string;
  status: string;
  why: string;
}): Stop {
  return {
    stage: input.kind,
    issue: input.issue,
    outcome: "stopped",
    summary: input.why,
    nextStatus: input.status,
    question: "What should the Runner do?",
    options: [
      "Reply here to run the Stage again from its start, keeping what it pushed",
      "Run it live with `/work-issue`",
    ],
    keptCommits: [],
    pr: null,
    headSha: null,
    pushed: false,
    roundsEnded: null,
    routes: [],
    variants: [],
    wait: null,
  };
}

export type Reconcile =
  | { type: "running" }
  | { type: "crashed" }
  | { type: "paused"; due: boolean }
  | { type: "abandoned"; why: string };

/** What the tick makes of an active record: still running, crashed, paused (and whether it is due), or left behind. */
export function reconcile(
  record: ActiveRecord,
  alive: boolean,
  /** The issue's status now, or undefined when it couldn't be read. */
  status: string | undefined,
  now: Date,
): Reconcile {
  if (record.state === "running") return alive ? { type: "running" } : { type: "crashed" };
  if (status !== undefined && status !== STATUS.inProgress) {
    return { type: "abandoned", why: `the issue is ${status} now, not In Progress` };
  }
  return {
    type: "paused",
    due: record.resetsAt === undefined || Date.parse(record.resetsAt) <= now.getTime(),
  };
}

const isKind = (value: unknown): value is StageKind =>
  (STAGE_KINDS as readonly unknown[]).includes(value);

function isRun(value: unknown): value is RunRecord {
  return isRecord(value) && typeof value.startedAt === "string" && typeof value.log === "string";
}

/** An active record, as read back from the volume. */
export function isActive(value: unknown): value is ActiveRecord {
  return (
    isRecord(value) &&
    typeof value.issue === "string" &&
    isKind(value.kind) &&
    (value.state === "running" || value.state === "paused") &&
    (value.pid === null || typeof value.pid === "number") &&
    Array.isArray(value.runs) &&
    value.runs.every(isRun)
  );
}

/** An ended Stage's record, as read back from the volume. */
export function isStageRecord(value: unknown): value is StageRecord {
  return (
    isRecord(value) &&
    typeof value.issue === "string" &&
    isKind(value.kind) &&
    typeof value.outcome === "string" &&
    typeof value.endedAt === "string" &&
    Array.isArray(value.runs) &&
    value.runs.every(isRun)
  );
}
