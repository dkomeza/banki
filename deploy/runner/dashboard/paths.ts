import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

// Which files the Dashboard serves (ADR-0014): only a Stage's logs, under
// /work/logs/BAN-N/, by a name with no path in it. A Stage can write to that
// directory, so the directory must be a real one right under the logs, and
// the file a regular file in it once its links are followed: a symlink
// planted in place of either leads nowhere.

const ISSUE = /^BAN-[1-9][0-9]{0,8}$/;
const LOG_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(jsonl|log)$/;

export const isIssue = (issue: string): boolean => ISSUE.test(issue);

/** A Stage log's link, from the path its record holds. */
export const logHref = (issue: string, log: string): string =>
  `/issues/${encodeURIComponent(issue)}/logs/${encodeURIComponent(basename(log))}`;

/** Where a record's log is in the logs directory the Dashboard reads, whatever directory the record names. */
export const localLog = (logs: string, log: string): string =>
  join(logs, basename(dirname(log)), basename(log));

/**
 * The log `file` of `issue` in `logs`, or undefined when the names can't be
 * a Stage log's there. Pure: it doesn't look at the disk.
 */
export function logPathOf(logs: string, issue: string, file: string): string | undefined {
  if (!isIssue(issue) || !LOG_FILE.test(file) || file.includes("..")) return undefined;
  return join(logs, issue, file);
}

/**
 * The same, once the disk says it is a regular file inside the issue's
 * directory after its links are followed; undefined otherwise.
 */
export function servedLogPath(logs: string, issue: string, file: string): string | undefined {
  const path = logPathOf(logs, issue, file);
  if (path === undefined) return undefined;
  try {
    // The issue's directory must be a real one, right under the real logs
    // directory: a link in its place could lead anywhere on the volume.
    const dir = realpathSync(join(logs, issue));
    if (dir !== join(realpathSync(logs), issue)) return undefined;
    const real = realpathSync(path);
    if (!real.startsWith(`${dir}${sep}`) || dirname(real) !== dir) return undefined;
    if (!lstatSync(real).isFile()) return undefined;
    return real;
  } catch {
    return undefined;
  }
}
