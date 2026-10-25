import { logPath } from "../cli/plan";
import { errorText } from "../lib/config";
import type { DispatcherConfig } from "./config";
import type { Reading } from "./gate";
import {
  expiredLogs,
  issueOfSlug,
  issueOfWorktree,
  type Removal,
  slugsToTakeDown,
  type WorktreeFacts,
  worktreesToRemove,
} from "./housekeeping";
import { ledger } from "./ledger";
import { type Closing, MAINTAINER } from "./closing";
import { type ActiveRecord, reconcile, type StageRecord } from "./lifecycle";
import { type LinearIssue, moveTo } from "./linear";
import { plan, type Ready, type Verdict } from "./queue";
import { type Decision, STATUS } from "./select";
import { openSession, type Session, type SessionDeps } from "./session";
import type { Start } from "./spawn";
import { renderStatus, type StatusView } from "./status";
import type { Store } from "./store";
import { inWindow, localTime } from "./window";

// The Dispatcher (ADR-0013), without an LLM: on each tick it reconciles the
// Stages it started (a supervisor that is gone is a crash; a paused Stage
// whose five-hour window has started over is due), decides each issue's next
// move from Linear and GitHub, makes the moves that cost no tokens (handing
// an issue back, the hand-offs, the stops), starts what the window, the cap
// and the gate allow, and tidies up. `runner run-now` and `runner status`
// share it, and the Dashboard shares `runner status`'s view.

const AGENT_STATUSES: readonly string[] = [STATUS.todo, STATUS.inDesign, STATUS.inReview];

export type Housekeeper = {
  logFiles: () => { path: string; modified: Date }[];
  removeLogs: (paths: readonly string[]) => void;
  /** Drops the tick log's lines older than 30 days; returns how many. */
  pruneTickLog: (now: Date) => number;
  listWorktrees: () => Promise<{ path: string; branch: string | undefined }[]>;
  worktreeFacts: (
    entry: { path: string; branch: string | undefined },
    pr: number | undefined,
  ) => Promise<WorktreeFacts>;
  removeWorktree: (removal: Removal) => Promise<void>;
};

/** What `runner status`'s view is made from: it reads, and changes nothing. */
export type StatusDeps = SessionDeps & {
  records: Pick<Store, "activeRecords" | "stageRecords" | "gate">;
  config: DispatcherConfig;
  now: () => Date;
};

export type DispatcherDeps = SessionDeps & {
  records: Store;
  config: DispatcherConfig;
  takeReading: () => Promise<Reading>;
  /** Starts a supervisor; `onError` hears of a failure that comes after it returns. */
  startSupervisor: (start: Start, onError: (error: Error) => void) => number;
  alive: (record: ActiveRecord) => boolean;
  redact: (text: string) => string;
  housekeeper: Housekeeper;
  logs: string;
  now: () => Date;
};

/** One tick. */
export async function tick(deps: DispatcherDeps): Promise<void> {
  const release = deps.records.lock();
  if (release === undefined) {
    deps.log("Another dispatch (a `runner run-now`) holds the lock, so this tick does nothing");
    return;
  }
  try {
    tidyLogs(deps);
    const session = await openSession(deps);
    try {
      await dispatch(session, deps);
      await tidy(session, deps);
    } finally {
      await session.end();
    }
  } finally {
    release();
  }
}

async function dispatch(session: Session, deps: DispatcherDeps): Promise<void> {
  const now = deps.now();
  const issues = await session.linear.openIssues();
  const resumes = await reconcileActive(session, deps, issues, now);
  const { ready } = await survey(session, deps, issues, now, { act: true });

  if (ready.length === 0 && resumes.length === 0) return;
  const closed = closedNow(deps.config, now);
  if (closed !== undefined) {
    deps.log(`${ready.length + resumes.length} ready, and nothing starts: ${closed}`);
    return;
  }
  const active = deps.records.activeRecords();
  if (resumes.length === 0 && active.length >= deps.config.maxStages) {
    deps.log(`${ready.length} ready, and ${active.length} Stages are running or paused already`);
    return;
  }
  for (const verdict of await planWithReading(deps, { resumes, ready })) {
    if (verdict.start) {
      const log = begin(deps, verdict.ready, now);
      if (log !== undefined) {
        deps.log(
          `Started the ${verdict.ready.stage} Stage on ${verdict.ready.issue} (${verdict.why}): ${log}`,
        );
      }
    } else {
      deps.log(`${verdict.ready.issue} ${verdict.ready.stage} waits: ${verdict.why}`);
    }
  }
}

/** Why nothing may start now, outside the window; undefined inside it. */
export function closedNow(config: DispatcherConfig, now: Date): string | undefined {
  return inWindow(localTime(now, config.timeZone), config.window)
    ? undefined
    : "outside the window";
}

/** The gate's reading, saved for `runner status`, and what it lets start. */
async function planWithReading(
  deps: DispatcherDeps,
  candidates: { resumes: Ready[]; ready: Ready[] },
  force = false,
): Promise<Verdict[]> {
  let reading: Reading | undefined;
  let readingError: string | undefined;
  try {
    reading = await deps.takeReading();
    deps.records.saveGate({ reading, at: reading.at });
  } catch (error) {
    readingError = errorText(error);
    deps.records.saveGate({
      ...deps.records.gate(),
      error: readingError,
      at: deps.now().toISOString(),
    });
  }
  const active = deps.records.activeRecords();
  return plan({
    ...candidates,
    reading,
    readingError,
    ceiling: deps.config.ceiling,
    maxStages: deps.config.maxStages,
    active: active.length,
    running: active.filter((record) => record.state === "running").map((record) => record.kind),
    estimates: ledger(deps.records.stageRecords(), active).estimates,
    force,
  });
}

/**
 * Writes the Stage's active record and starts its supervisor, which records
 * its own pid. Returns the Stage's log, or undefined when the supervisor
 * can't be started: then the record is put back as it was, gone or paused.
 */
function begin(deps: DispatcherDeps, ready: Ready, now: Date): string | undefined {
  const log = logPath(ready.issue, ready.stage, now, deps.logs);
  const existing = deps.records.activeRecord(ready.issue);
  const resuming = ready.resume === true && existing !== undefined;
  const since = now.toISOString();
  deps.records.saveActive(
    resuming
      ? { ...existing, state: "running", pid: null, since }
      : { issue: ready.issue, kind: ready.stage, state: "running", pid: null, runs: [], since },
  );
  const giveBack = (error: unknown) => {
    deps.log(`Couldn't start the supervisor of ${ready.issue}: ${errorText(error)}`);
    if (resuming) deps.records.saveActive({ ...existing, state: "paused", pid: null });
    else deps.records.removeActive(ready.issue);
  };
  try {
    deps.startSupervisor(
      { issue: ready.issue, kind: ready.stage, resume: ready.resume === true, log },
      giveBack,
    );
  } catch (error) {
    giveBack(error);
    return undefined;
  }
  return log;
}

/** The issue's newest closing comment, read only when a gone supervisor may have posted one. */
async function newestClosing(session: Session, issue: LinearIssue): Promise<Closing | undefined> {
  return (await session.facts(issue)).closings.at(-1);
}

/**
 * Crashes, gone supervisors and left-behind paused Stages are dealt with; the
 * paused Stages that are due, unassigned and still In Progress come back to
 * be resumed.
 */
async function reconcileActive(
  session: Session,
  deps: DispatcherDeps,
  issues: readonly LinearIssue[],
  now: Date,
): Promise<Ready[]> {
  const resumes: Ready[] = [];
  for (const record of deps.records.activeRecords()) {
    try {
      const issue =
        issues.find((found) => found.identifier === record.issue) ??
        (await session.linear.issue(record.issue));
      const alive = deps.alive(record);
      const closing =
        record.state === "running" && !alive && issue?.status === STATUS.inProgress
          ? await newestClosing(session, issue)
          : undefined;
      const state = reconcile(record, { alive, issue, closing, now });
      if (state.type === "crashed") {
        deps.log(`The ${record.kind} Stage on ${record.issue} crashed: its supervisor is gone`);
        await session.crashed(
          record,
          `The ${record.kind} Stage's supervisor is gone, with the issue still In Progress: it crashed, or the Runner restarted.`,
          deps.redact,
        );
        deps.records.finish(ended(record, "crashed", now));
      } else if (state.type === "closed" && issue !== undefined) {
        const { result } = state.closing;
        deps.log(
          `The ${record.kind} Stage on ${record.issue} posted its closing comment, and its supervisor went before moving the issue on: moving it to ${result.nextStatus}`,
        );
        await moveTo(
          session.linear,
          issue,
          result.nextStatus,
          result.outcome === "stopped" ? MAINTAINER.linearId : undefined,
        );
        deps.records.finish(ended(record, result.outcome, now));
      } else if (state.type === "gone") {
        deps.log(
          `The ${record.kind} Stage on ${record.issue} has no supervisor any more, and ${state.why}: ending its record`,
        );
        deps.records.finish(ended(record, "lost", now));
      } else if (state.type === "abandoned") {
        deps.log(`Dropping the paused ${record.kind} Stage on ${record.issue}: ${state.why}`);
        deps.records.finish(ended(record, "abandoned", now));
      } else if (state.type === "held") {
        deps.log(`The paused ${record.kind} Stage on ${record.issue} waits: ${state.why}`);
      } else if (state.type === "paused" && state.due && issue !== undefined) {
        resumes.push({
          issue: record.issue,
          status: issue.status,
          priority: issue.priority,
          createdAt: issue.createdAt,
          stage: record.kind,
          resume: true,
        });
      }
    } catch (error) {
      deps.log(
        `Couldn't reconcile the ${record.kind} Stage on ${record.issue}: ${errorText(error)}`,
      );
    }
  }
  return resumes;
}

function ended(record: ActiveRecord, outcome: StageRecord["outcome"], now: Date): StageRecord {
  const runs = record.runs.map((run) =>
    run.endedAt === undefined ? { ...run, endedAt: now.toISOString(), after: null } : run,
  );
  return { issue: record.issue, kind: record.kind, outcome, endedAt: now.toISOString(), runs };
}

type Surveyed = { issue: LinearIssue; decision: Decision };

/**
 * Each agent-status issue's decision. With `act`, the moves that cost no
 * tokens are made: a hand-back, the hand-offs and the stops.
 */
async function survey(
  session: Session,
  deps: StatusDeps,
  issues: readonly LinearIssue[],
  now: Date,
  options: { act: boolean },
): Promise<{ ready: Ready[]; surveyed: Surveyed[] }> {
  const active = new Set(deps.records.activeRecords().map((record) => record.issue));
  const ready: Ready[] = [];
  const surveyed: Surveyed[] = [];
  for (const issue of issues) {
    if (active.has(issue.identifier) || !AGENT_STATUSES.includes(issue.status)) continue;
    try {
      const decision = await decideIssue(session, deps, issue, now, options.act);
      surveyed.push({ issue, decision });
      if (decision.type === "stage") {
        ready.push({
          issue: issue.identifier,
          status: issue.status,
          priority: issue.priority,
          createdAt: issue.createdAt,
          stage: decision.stage,
        });
      } else if (options.act) {
        await act(session, deps, issue, decision);
      }
    } catch (error) {
      deps.log(`Couldn't decide on ${issue.identifier}: ${errorText(error)}`);
    }
  }
  return { ready, surveyed };
}

/** The issue's decision; with `act`, a hand-back is made first and the issue decided on again. */
async function decideIssue(
  session: Session,
  deps: Pick<SessionDeps, "log">,
  issue: LinearIssue,
  now: Date,
  handBack: boolean,
): Promise<Decision> {
  const facts = await session.facts(issue);
  const decision = await session.decide(facts, now);
  if (decision.type !== "hand-back" || !handBack) return decision;
  await session.linear.update(issue.id, { assigneeId: null });
  deps.log(`Handed ${issue.identifier} back: ${decision.why}`);
  issue.assigneeId = null;
  return session.decide({ ...facts, assigneeId: null }, now);
}

async function act(
  session: Session,
  deps: Pick<SessionDeps, "log">,
  issue: LinearIssue,
  decision: Decision,
): Promise<void> {
  if (decision.type === "hand-off") {
    await session.linear.comment(issue.id, decision.comment);
    await moveTo(session.linear, issue, decision.to);
    deps.log(`Handed ${issue.identifier} off to ${decision.to}`);
  } else if (decision.type === "stop") {
    await session.stop(issue, decision.stop);
    deps.log(`Stopped ${issue.identifier} on the Maintainer: ${decision.stop.summary}`);
  } else if (decision.type === "wait") {
    deps.log(`${issue.identifier}: ${decision.why}`);
  }
}

function tidyLogs(deps: DispatcherDeps): void {
  deps.housekeeper.pruneTickLog(deps.now());
  const keep = new Set(
    deps.records
      .activeRecords()
      .flatMap((record) =>
        record.runs.flatMap((run) => [run.log, run.log.replace(/\.jsonl$/, ".log")]),
      ),
  );
  const expired = expiredLogs(deps.housekeeper.logFiles(), deps.now(), keep);
  if (expired.length === 0) return;
  deps.housekeeper.removeLogs(expired);
  deps.log(`Deleted ${expired.length} Stage logs older than 30 days`);
}

/** A canceled issue's Slug Previews go down; Done and Canceled issues' worktrees go once clean and pushed. */
async function tidy(session: Session, deps: DispatcherDeps): Promise<void> {
  try {
    const all = await session.slugDeployments();
    const newest = new Map<string, (typeof all)[number]>();
    for (const deployment of all) {
      const known = newest.get(deployment.slug);
      if (
        known === undefined ||
        deployment.createdAt > known.createdAt ||
        (deployment.createdAt === known.createdAt && deployment.id > known.id)
      ) {
        newest.set(deployment.slug, deployment);
      }
    }
    const numbers = [...new Set([...newest.keys()].flatMap((slug) => issueOfSlug(slug) ?? []))];
    const endedIssues = await session.linear.ended(numbers);
    const candidates = [...newest.values()].filter((deployment) => {
      const issue = issueOfSlug(deployment.slug);
      return issue !== undefined && endedIssues.get(issue) === "canceled";
    });
    const states = await Promise.all(
      candidates.map(async (deployment) => ({
        slug: deployment.slug,
        state: (await session.github.newestStatus(deployment.id)).state,
      })),
    );
    for (const slug of slugsToTakeDown(states, endedIssues)) {
      await session.github.takeDown(slug);
      deps.log(`Taking down ${slug}: its issue is canceled`);
    }
  } catch (error) {
    deps.log(`Couldn't tidy the Slug Previews: ${errorText(error)}`);
  }

  try {
    const listed = await deps.housekeeper.listWorktrees();
    const numbers = [...new Set(listed.flatMap((entry) => issueOfWorktree(entry.path) ?? []))];
    const endedIssues = await session.linear.ended(numbers);
    const facts: WorktreeFacts[] = [];
    for (const entry of listed) {
      const issue = issueOfWorktree(entry.path);
      if (issue === undefined || !endedIssues.has(issue)) continue;
      const base = entry.branch?.replace(/-proto-[a-z]+$/, "");
      const pr =
        entry.branch !== undefined && base === entry.branch
          ? await session.github.pullNumber(entry.branch)
          : undefined;
      facts.push(await deps.housekeeper.worktreeFacts(entry, pr));
    }
    const { remove, keep } = worktreesToRemove(facts, endedIssues);
    for (const removal of remove) {
      await deps.housekeeper.removeWorktree(removal);
      deps.log(`Removed the worktree ${removal.path}: its issue is over`);
    }
    for (const kept of keep)
      deps.log(`Keeping the worktree ${kept.path} of an issue that is over: ${kept.why}`);
  } catch (error) {
    deps.log(`Couldn't tidy the worktrees: ${errorText(error)}`);
  }
}

const describe = (decision: Decision): string => {
  switch (decision.type) {
    case "stage":
      return `the ${decision.stage} Stage is next (${decision.why})`;
    case "wait":
      return decision.why;
    case "hand-off":
      return `the hand-off to ${decision.to} is next, which the tick makes`;
    case "stop":
      return `the tick stops it on the Maintainer: ${decision.stop.summary}`;
    case "hand-back":
      return `it is handed back (${decision.why}), which the tick makes`;
    case "skip":
      return decision.why;
    default:
      return "it needs GitHub's facts";
  }
};

/** Waits for the lock, which a tick holds only for as long as it runs. */
async function lockWithin(records: Store, ms: number): Promise<(() => void) | undefined> {
  const until = Date.now() + ms;
  for (;;) {
    const release = records.lock();
    if (release !== undefined || Date.now() > until) return release;
    await Bun.sleep(2_000);
  }
}

/**
 * `runner run-now BAN-N [--force]`: starts the issue's next Stage, or
 * resumes its paused one, outside the window, still behind the cap, the
 * five-hour check and, unless forced, the Ceiling. Returns the log's path,
 * or why nothing starts.
 */
export async function runNow(
  identifier: string,
  force: boolean,
  deps: DispatcherDeps,
): Promise<{ log?: string; why?: string }> {
  const release = await lockWithin(deps.records, 120_000);
  if (release === undefined)
    return { why: "a tick holds the Dispatcher's lock; try again in a minute" };
  try {
    const now = deps.now();
    const record = deps.records.activeRecord(identifier);
    if (record?.state === "running") return { why: `its ${record.kind} Stage is running already` };
    const session = await openSession(deps);
    try {
      const resumes: Ready[] = [];
      const ready: Ready[] = [];
      const issue = (await session.linear.openIssues()).find(
        (found) => found.identifier === identifier,
      );
      if (issue === undefined) return { why: `${identifier} isn't an open issue of project Banki` };
      if (record?.state === "paused") {
        // The same rules as a fresh start: never on an assigned issue, and
        // only while it is In Progress.
        const state = reconcile(record, { alive: false, issue, now });
        if (state.type === "abandoned") {
          deps.records.finish(ended(record, "abandoned", now));
          return { why: `its paused Stage is dropped: ${state.why}` };
        }
        if (state.type === "held") return { why: `its paused Stage waits: ${state.why}` };
        resumes.push({
          issue: identifier,
          status: issue.status,
          priority: issue.priority,
          createdAt: issue.createdAt,
          stage: record.kind,
          resume: true,
        });
      } else {
        if (issue.status === STATUS.inProgress)
          return { why: "it is In Progress, and no supervisor of the Runner started it" };
        if (!AGENT_STATUSES.includes(issue.status))
          return { why: `${issue.status} isn't an agent's status` };
        const decision = await decideIssue(session, deps, issue, now, true);
        if (decision.type !== "stage") return { why: describe(decision) };
        ready.push({
          issue: identifier,
          status: issue.status,
          priority: issue.priority,
          createdAt: issue.createdAt,
          stage: decision.stage,
        });
      }
      const [verdict] = await planWithReading(deps, { resumes, ready }, force);
      if (verdict === undefined || !verdict.start)
        return { why: verdict?.why ?? "nothing is ready" };
      const log = begin(deps, verdict.ready, now);
      return log === undefined ? { why: "its supervisor couldn't be started" } : { log };
    } finally {
      await session.end();
    }
  } finally {
    release();
  }
}

/** `runner status`, read-only: it takes no reading, and makes no move. */
export async function status(deps: StatusDeps): Promise<string> {
  return renderStatus(await statusView(deps));
}

/**
 * What `runner status` shows, as a structure the Dashboard renders too: one
 * Linear token for it, revoked at its end.
 */
export async function statusView(deps: StatusDeps): Promise<StatusView> {
  const now = deps.now();
  const active = deps.records.activeRecords();
  const stages = deps.records.stageRecords();
  const { costs, estimates } = ledger(stages, active);
  const session = await openSession(deps);
  try {
    const issues = await session.linear.openIssues();
    const { ready, surveyed } = await survey(session, deps, issues, now, { act: false });
    const resumes: Ready[] = active
      .filter(
        (record) =>
          record.state === "paused" &&
          (record.resetsAt === undefined || Date.parse(record.resetsAt) <= now.getTime()),
      )
      .flatMap((record) => {
        const issue = issues.find((found) => found.identifier === record.issue);
        return issue === undefined
          ? []
          : [
              {
                issue: record.issue,
                status: issue.status,
                priority: issue.priority,
                createdAt: issue.createdAt,
                stage: record.kind,
                resume: true,
              },
            ];
      });
    const gate = deps.records.gate();
    const queue = plan({
      resumes,
      ready,
      reading: gate?.reading,
      readingError: gate?.reading === undefined ? "none taken yet" : undefined,
      ceiling: deps.config.ceiling,
      maxStages: deps.config.maxStages,
      active: active.length,
      running: active.filter((record) => record.state === "running").map((record) => record.kind),
      estimates,
    });
    const supervised = new Set(active.map((record) => record.issue));
    return {
      now,
      closed: closedNow(deps.config, now),
      running: active.filter((record) => record.state === "running"),
      paused: active.filter((record) => record.state === "paused"),
      queue,
      waiting: surveyed
        .filter(
          ({ decision }) =>
            decision.type !== "stage" &&
            !(decision.type === "skip" && decision.why === "it is assigned"),
        )
        .map(({ issue, decision }) => ({
          issue: issue.identifier,
          status: issue.status,
          what: describe(decision),
          ...(decision.type === "wait" && decision.on !== undefined ? { on: decision.on } : {}),
        })),
      gate,
      estimates,
      recent: stages
        .map((record, i) => ({ record, cost: costs[i] }))
        .slice(-10)
        .toReversed(),
      orphans: issues
        .filter((issue) => issue.status === STATUS.inProgress && !supervised.has(issue.identifier))
        .map((issue) => issue.identifier),
    };
  } finally {
    await session.end();
  }
}
