// `runner <command>`: the Runner's commands, run from the clone of `main`
// through the `runner` wrapper on PATH, so a merged change applies on the next
// tick. Pure, so it is unit-tested. BAN-95 adds the Dispatcher's commands.

export const STAGE_KINDS = ["design", "implement", "review-round", "acceptance-fix"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export type Command =
  | { command: "stage"; kind: StageKind; issue: string }
  | { command: "help" }
  | { command: "error"; message: string };

export const USAGE = `Usage: runner stage <${STAGE_KINDS.join("|")}> BAN-N

  stage   Runs one Stage on the issue, in the foreground, one line per event.
          Its full log goes to /work/logs/BAN-N/. It never changes the issue's
          status or assignee.`;

const isKind = (value: string): value is StageKind =>
  (STAGE_KINDS as readonly string[]).includes(value);

export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (command === undefined || ["help", "-h", "--help"].includes(command)) {
    return { command: "help" };
  }
  if (command !== "stage")
    return { command: "error", message: `No command ${command}.\n\n${USAGE}` };
  const [kind, issue, ...extra] = rest;
  if (kind === undefined || issue === undefined || extra.length > 0) {
    return { command: "error", message: USAGE };
  }
  if (!isKind(kind)) {
    return {
      command: "error",
      message: `No Stage ${kind}: it is one of ${STAGE_KINDS.join(", ")}.`,
    };
  }
  const match = /^BAN-([1-9][0-9]*)$/i.exec(issue);
  if (match === null) {
    return {
      command: "error",
      message: `${JSON.stringify(issue)} isn't an issue, such as BAN-94.`,
    };
  }
  return { command: "stage", kind, issue: `BAN-${match[1]}` };
}
