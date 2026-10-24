import type { StageKind } from "../cli/args";
import { percent } from "./gate";
import type { ActiveRecord, StageRecord } from "./lifecycle";
import type { Verdict } from "./queue";
import type { GateFile } from "./store";

// What `runner status` prints: the Stages running and paused, the ready
// queue in order with why each one would or wouldn't start now, what else
// the Dispatcher is waiting on, the gate's last reading, the recent Stages
// with their costs, and the In Progress issues no supervisor started. Pure,
// so it is unit-tested.

export type StatusView = {
  now: Date;
  /** Why nothing starts now whatever the gate says, such as being outside the window. */
  closed: string | undefined;
  running: ActiveRecord[];
  paused: ActiveRecord[];
  queue: Verdict[];
  waiting: { issue: string; status: string; what: string }[];
  gate: GateFile | undefined;
  estimates: Record<StageKind, number>;
  recent: { record: StageRecord; cost: number | undefined }[];
  orphans: string[];
};

const since = (from: string, now: Date) => {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(from)) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export function renderStatus(view: StatusView): string {
  const out: string[] = [];
  const section = (title: string, lines: string[], empty: string) => {
    out.push(
      `${title}:`,
      ...(lines.length === 0 ? [`  ${empty}`] : lines.map((line) => `  ${line}`)),
      "",
    );
  };

  section(
    "Running",
    view.running.map((record) => {
      const run = record.runs.at(-1);
      return `${record.issue} ${record.kind}, for ${run === undefined ? "a moment" : since(run.startedAt, view.now)}${run === undefined ? "" : `, log ${run.log}`}`;
    }),
    "none",
  );
  section(
    "Paused",
    view.paused.map(
      (record) =>
        `${record.issue} ${record.kind}, by the five-hour limit until ${record.resetsAt ?? "?"}, in session ${record.sessionId ?? "?"}`,
    ),
    "none",
  );
  section(
    `Ready, in order${view.closed === undefined ? "" : ` (${view.closed})`}`,
    view.queue.map(
      (verdict) =>
        `${verdict.ready.issue} ${verdict.ready.stage}${verdict.ready.resume === true ? " (resume)" : ""}: ${view.closed === undefined ? (verdict.start ? "would start now" : `waits: ${verdict.why}`) : verdict.start ? "would fit the gate" : `waits: ${verdict.why}`}`,
    ),
    "nothing",
  );
  section(
    "Waiting",
    view.waiting.map((wait) => `${wait.issue} (${wait.status}): ${wait.what}`),
    "nothing",
  );

  const reading = view.gate?.reading;
  const gateLines: string[] = [];
  if (reading !== undefined) {
    gateLines.push(
      `at ${reading.at}: the week ${percent(reading.sevenDay.utilization)} (starts over ${reading.sevenDay.resetsAt}), the five hours ${percent(reading.fiveHour.utilization)} (starts over ${reading.fiveHour.resetsAt})`,
    );
  }
  if (view.gate?.error !== undefined)
    gateLines.push(`the last reading failed at ${view.gate.at}: ${view.gate.error}`);
  gateLines.push(
    `estimates: ${Object.entries(view.estimates)
      .map(([kind, value]) => `${kind} ${percent(value)}`)
      .join(", ")}`,
  );
  section("Gate", gateLines, "");

  section(
    "Recent Stages",
    view.recent.map(
      ({ record, cost }) =>
        `${record.endedAt} ${record.issue} ${record.kind}: ${record.outcome}, ${cost === undefined ? "cost not known" : percent(cost)}${record.runs.length > 1 ? ` over ${record.runs.length} runs` : ""}`,
    ),
    "none yet",
  );
  section("In Progress, not started by a supervisor of the Runner", view.orphans, "none");
  return out.join("\n").trimEnd();
}
