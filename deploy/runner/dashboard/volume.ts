import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, join } from "node:path";
import type { StatusDeps } from "../dispatch/dispatcher";
import { redactTokens } from "../dispatch/secrets";
import { openSession } from "../dispatch/session";
import { supervisorLog } from "../dispatch/spawn";
import { claudeStarted, logFacts } from "../dispatch/stage-log";
import { errorText } from "../lib/config";
import { localLog } from "./paths";
import type { IssueData, RunFacts } from "./timeline";

// What the Dashboard reads for an issue's page (ADR-0014): the Runner's
// records and the issue's logs from the volume, mounted read-only, and the
// issue's comments and moves from Linear, with a token of its own revoked
// at the end. Nothing here writes anywhere.

/** How much of a log is read to tell whether `claude` started: its init event comes first. */
const HEAD_BYTES = 1 << 20;

/** A file's lines, only its first `maxBytes` when given; none when it can't be read. */
export function readLines(path: string, maxBytes?: number): string[] {
  try {
    if (maxBytes === undefined) return readFileSync(path, "utf8").split("\n");
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const read = readSync(fd, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, read).toString("utf8").split("\n");
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
}

/** What the logs of an issue's runs say, by file name: the `.jsonl` and the supervisor's `.log`. */
export function runFacts(logs: string, runLogs: readonly string[]): Record<string, RunFacts> {
  const facts: Record<string, RunFacts> = {};
  for (const log of runLogs) {
    const path = localLog(logs, log);
    const exists = existsSync(path);
    facts[basename(log)] = {
      exists,
      started: exists && claudeStarted(readLines(path, HEAD_BYTES)),
      costUsd: exists ? logFacts(readLines(path)).costUsd : 0,
    };
    const lines = supervisorLog(log);
    facts[basename(lines)] = {
      exists: existsSync(localLog(logs, lines)),
      started: false,
      costUsd: 0,
    };
  }
  return facts;
}

/** An issue's page data: the volume's records and logs, and Linear's comments and moves. */
export async function issueData(
  deps: StatusDeps & { logs: string },
  issue: string,
): Promise<IssueData> {
  const stages = deps.records.stageRecords();
  const active = deps.records.activeRecords();
  const runLogs = [...stages, ...active]
    .filter((record) => record.issue === issue)
    .flatMap((record) => record.runs.map((run) => run.log));
  const data: IssueData = {
    issue,
    now: deps.now(),
    stages,
    active,
    runs: runFacts(deps.logs, runLogs),
    linear: { error: "not read" },
  };
  try {
    const session = await openSession(deps);
    try {
      const found = await session.linear.issue(issue);
      if (found === undefined) {
        data.linear = { error: `Linear has no issue ${issue}` };
      } else {
        const [comments, moves] = await Promise.all([
          session.linear.comments(found.id),
          session.linear.moves(found.id),
        ]);
        data.linear = {
          title: found.title,
          status: found.status,
          assigneeId: found.assigneeId,
          runnerId: session.runnerId,
          comments,
          moves,
        };
      }
    } finally {
      await session.end();
    }
  } catch (error) {
    data.linear = { error: redactTokens(errorText(error)) };
  }
  return data;
}

/** The files the Dashboard reads, under a volume shaped like /work. */
export const volumePaths = (work: string) => ({
  dispatcher: join(work, "dispatcher"),
  logs: join(work, "logs"),
  ticks: join(work, "dispatcher", "ticks.jsonl"),
});
