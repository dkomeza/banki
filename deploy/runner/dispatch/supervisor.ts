import { readFileSync } from "node:fs";
import type { StageKind } from "../cli/args";
import type { Broker } from "../cli/broker-client";
import type { StageOptions, StageRun } from "../cli/stage";
import { errorText } from "../lib/config";
import { closingComment, MAINTAINER } from "./closing";
import type { Reading } from "./gate";
import {
  type ActiveRecord,
  type Ending,
  ending,
  type Outcome,
  type RunRecord,
  timeLeft,
} from "./lifecycle";
import { type Linear, type LinearIssue, moveTo } from "./linear";
import { RUNS_IN, STATUS } from "./select";
import { redactTokens } from "./secrets";
import { logFacts } from "./stage-log";
import { openSession, type SessionDeps } from "./session";
import type { Store } from "./store";

// `runner supervise <kind> BAN-N --log <path> [--resume]` (ADR-0013): one
// Stage under its supervisor, detached from the tick that started it. It
// takes the gate's reading before the Stage, looks at the issue afresh (and
// starts nothing if it was assigned or moved since; an assignment to the
// Runner app, Linear's for a linked PR, it undoes), sets it In Progress, runs
// the Stage as `runner stage` does with what is left of its 3 hours, takes
// the reading after, records the run, and then either pauses the Stage (the
// five-hour limit cut it short), or posts its closing comment and sets the
// next status from its result, or stops on the Maintainer after a timeout or
// a Stage that left no result. Headless, the Stage itself leaves Linear's
// statuses, assignees and comments to this.

export type SupervisorDeps = SessionDeps & {
  records: Store;
  broker: Pick<Broker, "linearToken" | "endLinearToken" | "githubToken">;
  takeReading: () => Promise<Reading>;
  executeStage: (kind: StageKind, issue: string, options: StageOptions) => Promise<StageRun>;
  redact: (text: string) => string;
  now: () => Date;
  pid: number;
};

export type SuperviseOptions = { log: string; resume: boolean };

export async function supervise(
  kind: StageKind,
  issue: string,
  options: SuperviseOptions,
  deps: SupervisorDeps,
): Promise<number> {
  const say = (line: string) => deps.log(`${deps.now().toISOString()} ${line}`);
  const record: ActiveRecord = (await recordOf(deps.records, issue)) ?? {
    issue,
    kind,
    state: "running",
    pid: deps.pid,
    runs: [],
  };
  record.kind = kind;
  record.state = "running";
  record.pid = deps.pid;
  deps.records.saveActive(record);

  let before: Reading;
  try {
    before = await deps.takeReading();
  } catch (error) {
    // A reading that fails starts nothing.
    say(
      `The gate's reading failed, so the ${kind} Stage on ${issue} doesn't start: ${errorText(error)}`,
    );
    giveBack(deps.records, record, options.resume);
    return 1;
  }

  try {
    const unfit = await withLinear(deps, async (linear, session) => {
      const found = await linear.issue(issue);
      if (found === undefined) throw new Error(`Linear has no issue ${issue}`);
      // The tick surveyed the issue before the reading; it may have moved since.
      await session.release(found);
      const why = unfitToStart(kind, found, options.resume);
      if (why !== undefined) return why;
      if (!options.resume) await moveTo(linear, found, STATUS.inProgress);
      // The branch's tip as the Stage first starts, from GitHub, not the Stage.
      record.headBefore ??= await tipOf(session, found, say);
      return undefined;
    });
    if (unfit !== undefined) {
      say(`The ${kind} Stage on ${issue} doesn't start: ${unfit}`);
      giveBack(deps.records, record, options.resume);
      return 1;
    }
  } catch (error) {
    say(`Couldn't ready ${issue} in Linear, so the Stage doesn't start: ${errorText(error)}`);
    giveBack(deps.records, record, options.resume);
    return 1;
  }

  const earlier = record.runs.filter((run) => run.endedAt !== undefined);
  const current: RunRecord = { startedAt: deps.now().toISOString(), log: options.log, before };
  record.runs = [...earlier, current];
  deps.records.saveActive(record);
  say(
    `${options.resume ? "Resuming" : "Starting"} the ${kind} Stage on ${issue}, with ${Math.round(timeLeft(earlier) / 60_000)} minutes left of its limit`,
  );

  let run: StageRun;
  /** Why the Stage failed before `claude` started, if it did. */
  let failedToRun: string | undefined;
  try {
    run = await deps.executeStage(kind, issue, {
      log: options.log,
      resume: options.resume ? record.sessionId : undefined,
      timeLimitMs: timeLeft(earlier),
    });
  } catch (error) {
    failedToRun = errorText(error);
    say(`The Stage failed to run: ${failedToRun}`);
    run = { exitCode: 1, timedOut: false };
  }

  // A Stage that never started spent nothing of its own: with no reading
  // after, its cost isn't known, so it stays out of its kind's estimate.
  const after =
    failedToRun === undefined
      ? await deps.takeReading().catch((error: unknown) => {
          say(
            `The gate's reading after the Stage failed, so its cost isn't known: ${errorText(error)}`,
          );
          return null;
        })
      : null;
  let lines: string[] = [];
  try {
    lines = readFileSync(options.log, "utf8").split("\n");
  } catch {
    lines = [];
  }
  const facts = logFacts(lines);
  current.endedAt = deps.now().toISOString();
  current.after = after;
  current.costUsd = facts.costUsd;
  record.sessionId ??= facts.sessionId;
  deps.records.saveActive(record);

  const end: Ending =
    failedToRun === undefined
      ? ending({
          kind,
          issue,
          result: run.result,
          timedOut: run.timedOut,
          exitCode: run.exitCode,
          log: facts,
          now: deps.now(),
        })
      : {
          type: "crash",
          outcome: "no-result",
          why: `The ${kind} Stage failed before claude started: ${failedToRun}`,
        };
  if (end.type === "paused") {
    if (record.sessionId === undefined) {
      say(
        "The five-hour limit cut the Stage short, but its log has no session to resume, so it stops instead",
      );
    } else {
      record.state = "paused";
      record.pid = null;
      record.resetsAt = end.resetsAt;
      deps.records.saveActive(record);
      say(
        `The five-hour limit paused the Stage until ${end.resetsAt}; it resumes in session ${record.sessionId}`,
      );
      return 0;
    }
  }

  // A crash's tail never shows the Linear token the Stage was given.
  const redact = (text: string) => redactTokens(deps.redact(text), run.tokens ?? []);
  const outcome = await withLinear(deps, async (linear, session): Promise<Outcome> => {
    const found = await linear.issue(issue);
    if (found === undefined) throw new Error(`Linear has no issue ${issue}`);
    if (end.type === "closing") {
      // The branch's real tip, and whether it moved, over what the Stage wrote.
      const headAfter = await tipOf(session, found, say);
      const pushed =
        record.headBefore !== undefined && headAfter !== undefined
          ? record.headBefore !== headAfter
          : end.result.pushed;
      const headSha = headAfter ?? end.result.headSha;
      const result = { ...end.result, headSha, pushed };
      await linear.comment(found.id, closingComment(result, { ...end.json, headSha, pushed }));
      const assignee = result.outcome === "stopped" ? MAINTAINER.linearId : undefined;
      if (found.status === STATUS.inProgress && result.nextStatus !== found.status) {
        await moveTo(linear, found, result.nextStatus, assignee);
      } else if (assignee !== undefined) {
        await linear.update(found.id, { assigneeId: assignee });
      }
      if (assignee === undefined) {
        // A PR the Stage opened got the issue assigned to the Runner app; one
        // linked after this read, or a release that fails, is the next tick's.
        try {
          const fresh = await linear.issue(issue);
          if (fresh !== undefined) await session.release(fresh);
        } catch (error) {
          say(`Couldn't undo the Runner app's assignment of ${issue}: ${errorText(error)}`);
        }
      }
      say(`The Stage ended ${result.outcome}; ${issue} is ${result.nextStatus}`);
      return result.outcome;
    }
    const why =
      end.type === "paused"
        ? "The five-hour limit cut the Stage short, and its log has no session to resume."
        : end.why;
    await session.crashed(record, why, redact);
    say(`The Stage stopped on the Maintainer: ${why}`);
    return end.type === "paused" ? "no-result" : end.outcome;
  });
  deps.records.finish({
    issue,
    kind,
    outcome,
    endedAt: deps.now().toISOString(),
    runs: record.runs,
  });
  return 0;
}

/**
 * Why the issue, as Linear has it now, can't take this Stage, or undefined
 * when it can: it is assigned, or it isn't in the status the Stage starts
 * from (the one its kind runs in, or In Progress for a paused one resuming).
 */
function unfitToStart(
  kind: StageKind,
  found: Pick<LinearIssue, "status" | "assigneeId">,
  resume: boolean,
): string | undefined {
  if (found.assigneeId !== null) return "the issue is assigned now";
  const from = resume ? STATUS.inProgress : RUNS_IN[kind];
  if (found.status !== from) return `the issue is ${found.status} now, not ${from}`;
  return undefined;
}

/** The tip of the issue's branch on origin, or undefined when GitHub can't say. */
async function tipOf(
  session: Awaited<ReturnType<typeof openSession>>,
  issue: LinearIssue,
  say: (line: string) => void,
): Promise<string | undefined> {
  try {
    return await session.github.branchHead(await session.branchOf(issue));
  } catch (error) {
    say(`Couldn't read the tip of ${issue.identifier}'s branch from GitHub: ${errorText(error)}`);
    return undefined;
  }
}

/** The active record the tick wrote just before starting this supervisor. */
async function recordOf(records: Store, issue: string): Promise<ActiveRecord | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = records.activeRecord(issue);
    if (found !== undefined) return found;
    await Bun.sleep(200);
  }
  return undefined;
}

/** Puts a Stage that never started back as it was: gone, or paused again. */
function giveBack(records: Store, record: ActiveRecord, resume: boolean): void {
  if (!resume) {
    records.removeActive(record.issue);
    return;
  }
  record.state = "paused";
  record.pid = null;
  records.saveActive(record);
}

/** Runs `work` with a Linear session of this supervisor's own, revoked at its end. */
async function withLinear<T>(
  deps: SupervisorDeps,
  work: (linear: Linear, session: Awaited<ReturnType<typeof openSession>>) => Promise<T>,
): Promise<T> {
  const session = await openSession(deps);
  try {
    return await work(session.linear, session);
  } finally {
    await session.end();
  }
}
