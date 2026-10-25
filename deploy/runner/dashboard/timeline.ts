import { basename } from "node:path";
import type { StageKind } from "../cli/args";
import { type Closing, type Comment, closingsOf, MAINTAINER } from "../dispatch/closing";
import { percent } from "../dispatch/gate";
import { LOG_RETENTION_MS } from "../dispatch/housekeeping";
import { ledger } from "../dispatch/ledger";
import type { ActiveRecord, RunRecord, StageRecord } from "../dispatch/lifecycle";
import type { Move } from "../dispatch/linear";
import type { StageResult, Wait } from "../dispatch/result";
import type { WaitOn } from "../dispatch/select";
import { STATUS } from "../dispatch/statuses";
import { supervisorLog } from "../dispatch/spawn";
import { dollars, duration, type Html, markup, page, time } from "./html";
import { type Label, outcome, WAIT_NAMES, waitDetail } from "./parts";
import { logHref } from "./paths";

// The issue page (`/issues/BAN-N`): one timeline, oldest first, of what the
// issue went through. It merges the Runner's records (every attempt at a
// Stage, with its outcome, a one-line reason, its cost and duration, and its
// runs' logs), the issue's closing comments (a Stage run live shows as one,
// marked live; a stop shows its question), and its moves in Linear (the
// hand-offs, the stops' assignments, the Maintainer's moves). A run whose log
// has no `claude` init event never started, which is told apart from a
// crash. Pure, so it is unit-tested.

/** What the Dashboard read of one run's log. */
export type RunFacts = {
  exists: boolean;
  /** Whether it has a `claude` init event. */
  started: boolean;
  /** `total_cost_usd` of its newest result event, or 0. */
  costUsd: number;
};

export type IssueLinear = {
  title: string;
  status: string;
  assigneeId: string | null;
  runnerId: string;
  comments: Comment[];
  moves: Move[];
};

export type IssueData = {
  issue: string;
  now: Date;
  /** Every Stage record on the volume: an attempt's cost is its share in the ledger of them all. */
  stages: StageRecord[];
  active: ActiveRecord[];
  /** The issue's runs' logs and their supervisors' (`.jsonl` and `.log`), by file name. */
  runs: Record<string, RunFacts>;
  linear: IssueLinear | { error: string };
  /** What the Dispatcher waits on for it, from the last live view, if any. */
  waiting?: { what: string; on?: WaitOn };
};

const REASONS: Record<Label, string> = {
  done: "Done, and no closing comment of it was found.",
  stopped: "Stopped, and no closing comment of it was found.",
  crashed:
    "Its supervisor went while the issue was In Progress: it crashed, or the Runner restarted.",
  "timed-out": "It ran for 3 hours, its limit, and was stopped.",
  "no-result": "It ended without a result the Runner can use.",
  lost: "Its supervisor went after the issue had moved on.",
  abandoned: "It was dropped while paused: the issue left In Progress.",
  "never-started": "Its log has no `claude` init event: `claude` never started.",
  running: "Running now.",
  paused: "Paused by the five-hour limit.",
};

export type ShownClosing = {
  at: string;
  result: StageResult;
  replies: { at: string; text: string }[];
};

export type ShownRun = {
  startedAt: string;
  endedAt?: string;
  /** Its stream-json log's link, and its supervisor's, unless the log is gone. */
  log?: string;
  supervisor?: string;
};

export type Entry =
  | {
      type: "attempt";
      at: string;
      endedAt?: string;
      stage: StageKind;
      label: Label;
      reason: string;
      /** Its share of the week, as the ledger counts it; undefined while it isn't known. */
      share?: number;
      usd: number;
      durationMs: number;
      runs: ShownRun[];
      closing?: ShownClosing;
    }
  | {
      /** A closing comment no record of the Runner's holds: a Stage run live, or the Dispatcher's own stop. */
      type: "closing";
      at: string;
      by: "live" | "dispatcher" | "runner";
      closing: ShownClosing;
    }
  | { type: "move"; at: string; by: string; what: string; tone: "runner" | "maintainer" | "other" };

const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() ?? "";
const minutes = (n: number) => n * 60_000;

/** What a closing comment says it did, in one line. */
function closingReason(result: StageResult): string {
  const summary = firstLine(result.summary);
  if (summary !== "") return summary;
  return result.outcome === "done"
    ? `The issue is ${result.nextStatus}.`
    : (result.question ?? "Stopped.");
}

function shown(closing: Closing): ShownClosing {
  return {
    at: closing.at,
    result: closing.result,
    replies: closing.replies.map((reply) => ({ at: reply.createdAt, text: firstLine(reply.body) })),
  };
}

/** Whether a run's `claude` started: from its log, or, with its log gone, false only while it would still be kept. */
function runStarted(
  run: RunRecord,
  facts: RunFacts | undefined,
  endedAt: string,
  now: Date,
): boolean | undefined {
  if (facts?.exists === true) return facts.started;
  return now.getTime() - Date.parse(endedAt) < LOG_RETENTION_MS ? false : undefined;
}

function runsOf(data: IssueData, runs: readonly RunRecord[]): ShownRun[] {
  return runs.map((run) => {
    const exists = (log: string) => data.runs[basename(log)]?.exists === true;
    const lines = supervisorLog(run.log);
    return {
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      log: exists(run.log) ? logHref(data.issue, run.log) : undefined,
      supervisor: exists(lines) ? logHref(data.issue, lines) : undefined,
    };
  });
}

const runUsd = (data: IssueData, run: RunRecord) =>
  run.costUsd ?? data.runs[basename(run.log)]?.costUsd ?? 0;

const runMs = (run: RunRecord, now: Date) =>
  (run.endedAt === undefined ? now.getTime() : Date.parse(run.endedAt)) - Date.parse(run.startedAt);

export function timeline(data: IssueData): Entry[] {
  const { issue, now } = data;
  const linear = "error" in data.linear ? undefined : data.linear;
  const closings =
    linear === undefined ? [] : closingsOf(linear.comments, { runner: linear.runnerId, issue });
  const authors = new Map(linear?.comments.map((comment) => [comment.id, comment.userId]) ?? []);
  const unmatched = new Set(closings);
  const { costs } = ledger(data.stages, data.active);
  const entries: Entry[] = [];

  data.stages.forEach((record, i) => {
    if (record.issue !== issue) return;
    // Its closing comment: of its kind, posted while it ran or just after,
    // the one closest to its end. A Stage that never ran a run counts from
    // half an hour before its end.
    const from =
      record.runs[0]?.startedAt ?? new Date(Date.parse(record.endedAt) - minutes(30)).toISOString();
    const until = new Date(Date.parse(record.endedAt) + minutes(5)).toISOString();
    const closing = [...unmatched]
      .filter(
        (found) => found.result.stage === record.kind && found.at >= from && found.at <= until,
      )
      .toSorted(
        (a, b) =>
          Math.abs(Date.parse(a.at) - Date.parse(record.endedAt)) -
          Math.abs(Date.parse(b.at) - Date.parse(record.endedAt)),
      )[0];
    if (closing !== undefined) unmatched.delete(closing);
    const neverStarted =
      record.outcome !== "done" &&
      record.outcome !== "stopped" &&
      record.runs.every(
        (run) =>
          runStarted(run, data.runs[basename(run.log)], run.endedAt ?? record.endedAt, now) ===
          false,
      );
    const label: Label = neverStarted ? "never-started" : record.outcome;
    entries.push({
      type: "attempt",
      at: from,
      endedAt: record.endedAt,
      stage: record.kind,
      label,
      reason: closing === undefined ? REASONS[label] : closingReason(closing.result),
      share: costs[i],
      usd: record.runs.reduce((sum, run) => sum + runUsd(data, run), 0),
      durationMs: record.runs.reduce((sum, run) => sum + runMs(run, now), 0),
      runs: runsOf(data, record.runs),
      closing: closing === undefined ? undefined : shown(closing),
    });
  });

  for (const record of data.active) {
    if (record.issue !== issue) continue;
    const label: Label = record.state;
    entries.push({
      type: "attempt",
      at: record.runs[0]?.startedAt ?? record.since ?? now.toISOString(),
      stage: record.kind,
      label,
      reason:
        record.state === "paused"
          ? `Paused by the five-hour limit until ${record.resetsAt ?? "?"}; it resumes in its own session.`
          : record.runs.length === 0
            ? "Starting: its supervisor hasn't begun a run yet."
            : REASONS.running,
      usd: record.runs.reduce(
        (sum, run) =>
          sum +
          (run.endedAt === undefined
            ? (data.runs[basename(run.log)]?.costUsd ?? 0)
            : runUsd(data, run)),
        0,
      ),
      durationMs: record.runs.reduce((sum, run) => sum + runMs(run, now), 0),
      runs: runsOf(data, record.runs),
    });
  }

  for (const closing of unmatched) {
    const author = authors.get(closing.id);
    entries.push({
      type: "closing",
      at: closing.at,
      by:
        author === MAINTAINER.linearId
          ? "live"
          : closing.result.outcome === "stopped"
            ? "dispatcher"
            : "runner",
      closing: shown(closing),
    });
  }

  for (const move of linear?.moves ?? []) {
    const by =
      move.by === linear?.runnerId
        ? "the Runner"
        : move.by === MAINTAINER.linearId
          ? "the Maintainer"
          : move.by === null
            ? "Linear"
            : "someone else";
    const tone = by === "the Runner" ? "runner" : by === "the Maintainer" ? "maintainer" : "other";
    if (move.status !== undefined) {
      const { from, to } = move.status;
      const handOff =
        by === "the Runner" &&
        from !== STATUS.inProgress &&
        (to === STATUS.designReview || to === STATUS.acceptance);
      entries.push({
        type: "move",
        at: move.at,
        by,
        tone,
        what: `${from ?? "(none)"} → ${to}${handOff ? ": the hand-off" : ""}`,
      });
    }
    if (move.assignee !== undefined) {
      const { to } = move.assignee;
      const what =
        to === MAINTAINER.linearId
          ? by === "the Runner"
            ? "assigned the Maintainer: a stop"
            : "assigned the Maintainer"
          : to === null
            ? by === "the Runner"
              ? "unassigned: handed back after a reply"
              : "unassigned"
            : "assigned someone else";
      entries.push({ type: "move", at: move.at, by, tone, what });
    }
  }

  const order: Record<Entry["type"], number> = { move: 0, attempt: 1, closing: 2 };
  return entries.toSorted((a, b) => a.at.localeCompare(b.at) || order[a.type] - order[b.type]);
}

/** The attempt whose runs include this log file, if any. */
export function attemptOf(
  entries: readonly Entry[],
  issue: string,
  file: string,
): Extract<Entry, { type: "attempt" }> | undefined {
  const href = logHref(issue, file);
  return entries.find(
    (entry): entry is Extract<Entry, { type: "attempt" }> =>
      entry.type === "attempt" &&
      entry.runs.some((run) => run.log === href || run.supervisor === href),
  );
}

// The page.

const resultOutcome = (result: StageResult) =>
  outcome(result.outcome === "done" ? "done" : "stopped");

/** A closing comment's result: what it did, a stop's question and options, and the replies to it. */
export function closingDetail(closing: ShownClosing, tz: string | undefined): Html {
  const { result } = closing;
  // Its first line is the entry's reason already: the summary shows only when it says more.
  const summary = result.summary.trim().includes("\n") ? result.summary.trim() : "";
  return markup`<div class="closing">
    ${summary === "" ? "" : markup`<p class="summary">${summary}</p>`}
    <p>
      Next status:
      ${result.nextStatus}.${result.wait === null ? "" : ` From the wait for ${WAIT_NAMES[result.wait]}.`}
    </p>
    ${result.question === null ? "" : markup`<p><strong>Question:</strong> ${result.question}</p>`}
    ${
      result.options.length === 0
        ? ""
        : markup`<ol>
            ${result.options.map((option) => markup`<li>${option}</li>`)}
          </ol>`
    }
    ${
      closing.replies.length === 0
        ? ""
        : markup`<ul class="replies">
            ${closing.replies.map((reply) => markup`<li>The Maintainer replied ${time(reply.at, tz)}: ${reply.text}</li>`)}
          </ul>`
    }
  </div>`;
}

const waitTitle = (wait: Wait | null) =>
  wait === null ? "the Dispatcher stopped it" : `the wait for ${WAIT_NAMES[wait]} stopped`;

function entryHtml(entry: Entry, tz: string | undefined): Html {
  if (entry.type === "move") {
    return markup`<li class="entry move tone-${entry.tone}">
      <span class="at">${time(entry.at, tz)}</span> <span class="what">${entry.what}</span>, by
      ${entry.by}
    </li>`;
  }
  if (entry.type === "closing") {
    const { result } = entry.closing;
    const title =
      entry.by === "live"
        ? markup`${result.stage} Stage, <span class="tag">live</span>: ${resultOutcome(result)}`
        : entry.by === "dispatcher"
          ? markup`${result.stage}: ${waitTitle(result.wait)} ${resultOutcome(result)}`
          : markup`${result.stage} Stage, by the Runner with no record of it: ${resultOutcome(result)}`;
    return markup`<li class="entry closing-entry by-${entry.by}">
      <p class="head"><span class="at">${time(entry.at, tz)}</span> ${title}</p>
      <p class="reason">${closingReason(result)}</p>
      ${entry.by === "live" ? markup`<p class="meta">Run live: no log on the Runner.</p>` : ""}
      ${closingDetail(entry.closing, tz)}
    </li>`;
  }
  const cost = `${entry.share === undefined ? "week's share not known" : `${percent(entry.share)} of the week`}, ${dollars(entry.usd)}`;
  return markup`<li class="entry attempt label-${entry.label}">
    <p class="head">
      <span class="at">${time(entry.at, tz)}</span> ${entry.stage} Stage: ${outcome(entry.label)}
    </p>
    <p class="reason">${entry.reason}</p>
    <p class="meta">
      ${cost} ·
      ${duration(entry.durationMs)}${entry.runs.length > 1 ? ` · ${entry.runs.length} runs` : ""}${entry.endedAt === undefined ? "" : markup` · ended ${time(entry.endedAt, tz)}`}
    </p>
    ${
      entry.runs.length === 0
        ? ""
        : markup`<ul class="runs">
            ${entry.runs.map((run) => markup`<li>Run ${time(run.startedAt, tz)}${run.endedAt === undefined ? ", going on" : markup` to ${time(run.endedAt, tz)}`}: ${run.log === undefined ? "its log is gone" : markup`<a href="${run.log}">log</a>`}${run.supervisor === undefined ? "" : markup` · <a href="${run.supervisor}">supervisor</a>`}</li>`)}
          </ul>`
    }
    ${entry.closing === undefined ? "" : closingDetail(entry.closing, tz)}
  </li>`;
}

export function issuePage(data: IssueData, tz: string | undefined): string {
  const entries = timeline(data);
  const linear = "error" in data.linear ? undefined : data.linear;
  const assignee =
    linear === undefined
      ? ""
      : linear.assigneeId === null
        ? "unassigned"
        : linear.assigneeId === MAINTAINER.linearId
          ? "assigned to the Maintainer"
          : linear.assigneeId === linear.runnerId
            ? "assigned to the Runner"
            : "assigned to someone else";
  return page({
    title: data.issue,
    body: markup`<h1>
        ${data.issue}${linear === undefined || linear.title === "" ? "" : markup`: ${linear.title}`}
      </h1>
      ${linear === undefined ? markup`<p class="error">Linear couldn't be read: ${"error" in data.linear ? data.linear.error : ""}. What follows is the Runner's records alone.</p>` : markup`<p class="meta">${linear.status}, ${assignee}.</p>`}
      ${
        data.waiting === undefined
          ? ""
          : markup`<section class="now">
              <h2>Now</h2>
              <p>${data.waiting.what}</p>
              ${data.waiting.on === undefined ? "" : waitDetail(data.waiting.on, data.now, tz)}
            </section>`
      }
      <section>
        <h2>Timeline, oldest first</h2>
        ${
          entries.length === 0
            ? markup`<p class="empty">Nothing yet.</p>`
            : markup`<ol class="timeline">
                ${entries.map((entry) => entryHtml(entry, tz))}
              </ol>`
        }
      </section>`,
  });
}
