// `runner <command>`: the Runner's commands, run from the clone of `main`
// through the `runner` wrapper on PATH, so a merged change applies on the next
// tick. Pure, so it is unit-tested.

export const STAGE_KINDS = ["design", "implement", "review-round", "acceptance-fix"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export type Command =
  | { command: "stage"; kind: StageKind; issue: string }
  | { command: "run-now"; issue: string; force: boolean }
  | { command: "status" }
  | { command: "supervise"; kind: StageKind; issue: string; log: string; resume: boolean }
  | { command: "help" }
  | { command: "error"; message: string };

export const USAGE = `Usage: runner <command>

  status                 What the Dispatcher sees: the Stages running and paused,
                         the ready queue and why each one would or wouldn't start
                         now, what it waits on, the gate's last reading, the
                         recent Stages with their costs, and the In Progress
                         issues no supervisor of the Runner started.
  run-now BAN-N [--force]
                         Starts the issue's next Stage, or resumes its paused
                         one, now, even outside the window, still behind the cap
                         and the five-hour check. --force skips the Ceiling, and
                         only that. Prints the Stage's log, or why nothing starts.
  stage <${STAGE_KINDS.join("|")}> BAN-N
                         Runs one Stage on the issue, in the foreground, one line
                         per event. Its full log goes to /work/logs/BAN-N/. It
                         never changes the issue's status or assignee.`;

const isKind = (value: string): value is StageKind =>
  (STAGE_KINDS as readonly string[]).includes(value);

/** BAN-N, any case, as BAN-N; or undefined. */
function issueOf(value: string | undefined): string | undefined {
  const match = /^BAN-([1-9][0-9]*)$/i.exec(value ?? "");
  return match === null ? undefined : `BAN-${match[1]}`;
}

const notAnIssue = (value: string): Command => ({
  command: "error",
  message: `${JSON.stringify(value)} isn't an issue, such as BAN-94.`,
});
const noKind = (kind: string): Command => ({
  command: "error",
  message: `No Stage ${kind}: it is one of ${STAGE_KINDS.join(", ")}.`,
});

export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (command === undefined || ["help", "-h", "--help"].includes(command)) {
    return { command: "help" };
  }
  switch (command) {
    case "status":
      return rest.length === 0 ? { command: "status" } : { command: "error", message: USAGE };
    case "run-now": {
      const flags = rest.filter((arg) => arg.startsWith("--"));
      const [issue, ...extra] = rest.filter((arg) => !arg.startsWith("--"));
      if (issue === undefined || extra.length > 0 || flags.some((flag) => flag !== "--force")) {
        return { command: "error", message: USAGE };
      }
      const found = issueOf(issue);
      return found === undefined
        ? notAnIssue(issue)
        : { command: "run-now", issue: found, force: flags.includes("--force") };
    }
    case "stage": {
      const [kind, issue, ...extra] = rest;
      if (kind === undefined || issue === undefined || extra.length > 0) {
        return { command: "error", message: USAGE };
      }
      if (!isKind(kind)) return noKind(kind);
      const found = issueOf(issue);
      return found === undefined ? notAnIssue(issue) : { command: "stage", kind, issue: found };
    }
    case "supervise": {
      // Started by the Dispatcher, never by hand: `supervise <kind> BAN-N --log <path> [--resume]`.
      const [kind, issue, logFlag, log, ...extra] = rest;
      const resume = extra.length === 1 && extra[0] === "--resume";
      if (
        kind === undefined ||
        issue === undefined ||
        logFlag !== "--log" ||
        log === undefined ||
        (extra.length > 0 && !resume)
      ) {
        return {
          command: "error",
          message: "Usage: runner supervise <kind> BAN-N --log <path> [--resume]",
        };
      }
      if (!isKind(kind)) return noKind(kind);
      const found = issueOf(issue);
      return found === undefined
        ? notAnIssue(issue)
        : { command: "supervise", kind, issue: found, log, resume };
    }
    default:
      return { command: "error", message: `No command ${command}.\n\n${USAGE}` };
  }
}
