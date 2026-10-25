import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "../lib/parse";
import { LOG_RETENTION_MS } from "./housekeeping";
import { DISPATCHER } from "./store";

// The tick log (ADR-0014): every line the tick and `run-now` log, as they
// print it, is also appended to /work/dispatcher/ticks.jsonl, one
// `{ at, main, line }` each, so the Dashboard's /ticks can show what
// `docker logs` would. Each tick drops the lines older than 30 days, as it
// does the Stage logs. A line that can't be appended is still printed.

export const TICK_LOG = join(DISPATCHER, "ticks.jsonl");

export type TickLine = { at: string; main: string; line: string };

function isTickLine(value: unknown): value is TickLine {
  return (
    isRecord(value) &&
    typeof value.at === "string" &&
    typeof value.main === "string" &&
    typeof value.line === "string"
  );
}

const parse = (text: string): TickLine | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return isTickLine(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a line logged at `at` is still within the 30 days kept. */
export function withinRetention(at: string, now: Date): boolean {
  return now.getTime() - Date.parse(at) <= LOG_RETENTION_MS;
}

/** The log's lines, oldest first; the ones it can't read are left out. */
export function readTickLines(path = TICK_LOG): TickLine[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    const entry = line.trim() === "" ? undefined : parse(line);
    return entry === undefined ? [] : [entry];
  });
}

/** A logger that prints each line and appends it to the tick log. */
export function tickLogger(options: {
  main: string;
  path?: string;
  print?: (line: string) => void;
  now?: () => Date;
}): (line: string) => void {
  const path = options.path ?? TICK_LOG;
  const print = options.print ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  return (line) => {
    print(line);
    try {
      mkdirSync(dirname(path), { recursive: true });
      const entry: TickLine = { at: now().toISOString(), main: options.main, line };
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // The line is printed: `docker logs` still has it.
    }
  };
}

/**
 * Drops the lines older than 30 days, and those it can't read, rewriting the
 * file whole so a reader never sees half of it. Returns how many it dropped.
 * The tick runs it under the Dispatcher's lock, so no one else appends then.
 */
export function pruneTickLog(path: string, now: Date): number {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return 0;
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const kept = lines.filter((line) => {
    const entry = parse(line);
    return entry !== undefined && withinRetention(entry.at, now);
  });
  const dropped = lines.length - kept.length;
  if (dropped === 0) return 0;
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, kept.length === 0 ? "" : `${kept.join("\n")}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return dropped;
}
