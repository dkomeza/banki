import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { StageKind } from "../cli/args";

// Starts a Stage's supervisor (ADR-0013): `runner supervise`, detached in a
// session of its own, so it outlives the tick that started it, which the
// loop gives 10 minutes, and its output goes to a file beside the Stage's
// log, never to the tick's pipes.

export type Start = { issue: string; kind: StageKind; resume: boolean; log: string };

/** The supervisor's own lines, beside the Stage's stream-json log. */
export const supervisorLog = (log: string) => log.replace(/\.jsonl$/, ".log");

export function startSupervisor(
  start: Start,
  onError: (error: Error) => void,
  runner = "runner",
): number {
  const lines = supervisorLog(start.log);
  mkdirSync(dirname(lines), { recursive: true });
  const fd = openSync(lines, "a", 0o600);
  try {
    const child = spawn(
      runner,
      [
        "supervise",
        start.kind,
        start.issue,
        "--log",
        start.log,
        ...(start.resume ? ["--resume"] : []),
      ],
      { detached: true, stdio: ["ignore", fd, fd] },
    );
    // spawn reports a command it couldn't run as an event, after it returns.
    child.once("error", onError);
    child.unref();
    if (child.pid === undefined)
      throw new Error(`couldn't start ${runner} supervise for ${start.issue}`);
    return child.pid;
  } finally {
    closeSync(fd);
  }
}
