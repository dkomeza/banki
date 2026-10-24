import { summarize } from "../cli/events";
import { isRecord } from "../lib/parse";

// What the Dispatcher reads from a Stage's log (`/work/logs/BAN-N/…jsonl`):
// its `claude` session, what it cost in dollars, whether the five-hour limit
// cut it short, and its last events as one line each, for a stop comment.
// Never the raw JSON. Pure, so it is unit-tested.

export type LogFacts = {
  /** From the init event. */
  sessionId: string | undefined;
  /** `total_cost_usd` from its result event, or 0 when it has none. */
  costUsd: number;
  /** Set when the five-hour limit stopped it: when that window starts over, if the log says. */
  fiveHourLimit: { resetsAt: string | undefined } | undefined;
};

const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    const event: unknown = JSON.parse(line);
    return isRecord(event) ? event : undefined;
  } catch {
    return undefined;
  }
};

export function logFacts(lines: readonly string[]): LogFacts {
  let sessionId: string | undefined;
  let costUsd = 0;
  let fiveHourResetsAt: string | undefined;
  let fiveHourRejected = false;
  let sevenDayRejected = false;
  let limitedResult = false;
  for (const event of lines.map(parse)) {
    if (event === undefined) continue;
    if (
      event.type === "system" &&
      event.subtype === "init" &&
      typeof event.session_id === "string"
    ) {
      sessionId ??= event.session_id;
    }
    if (event.type === "rate_limit_event" && isRecord(event.rate_limit_info)) {
      const info = event.rate_limit_info;
      const windows = isRecord(info.unifiedWindows) ? info.unifiedWindows : {};
      const fiveHour = isRecord(windows.five_hour) ? windows.five_hour : {};
      const sevenDay = isRecord(windows.seven_day) ? windows.seven_day : {};
      const resetsAt =
        typeof fiveHour.resetsAt === "number"
          ? fiveHour.resetsAt
          : info.rateLimitType === "five_hour" && typeof info.resetsAt === "number"
            ? info.resetsAt
            : undefined;
      if (resetsAt !== undefined) fiveHourResetsAt = new Date(resetsAt * 1000).toISOString();
      if (
        fiveHour.status === "rejected" ||
        (info.status === "rejected" && info.rateLimitType === "five_hour")
      ) {
        fiveHourRejected = true;
      }
      if (
        sevenDay.status === "rejected" ||
        (info.status === "rejected" && info.rateLimitType === "seven_day")
      ) {
        sevenDayRejected = true;
      }
    }
    if (event.type === "result") {
      if (typeof event.total_cost_usd === "number") costUsd = event.total_cost_usd;
      limitedResult =
        event.is_error === true &&
        (event.api_error_status === 429 ||
          (typeof event.result === "string" &&
            /usage limit|limit reached|rate limit/i.test(event.result)));
    }
  }
  const limited = fiveHourRejected || (limitedResult && !sevenDayRejected);
  return {
    sessionId,
    costUsd,
    fiveHourLimit: limited ? { resetsAt: fiveHourResetsAt } : undefined,
  };
}

/** The log's last `count` events, one line each as `runner stage` prints them. */
export function logTail(lines: readonly string[], count = 30): string[] {
  const summaries = lines.flatMap((line) => {
    if (line.trim() === "") return [];
    const event = parse(line);
    if (event?.type === "runner") {
      if (event.event === "stderr") return [`[stderr] ${String(event.line)}`];
      if (event.event === "exit") return [`claude exited ${String(event.exitCode)}`];
      return [];
    }
    return [summarize(line)];
  });
  return summaries.slice(-count);
}
