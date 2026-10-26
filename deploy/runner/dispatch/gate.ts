import { asNumber, asObject, isRecord, ParseError } from "../lib/parse";

// The usage gate (ADR-0013). `rate_limit_event` comes once, at the start of
// a `claude -p` run, so the gate reads usage with a one-line Haiku call
// before it starts or resumes a Stage. A Stage starts only if the weekly
// utilization, plus the estimates of the Stages running, plus its own, stays
// within the Ceiling (which `force` and an urgent issue skip), and the
// five-hour window is under 80%. Pure, so it is unit-tested; claude.ts makes
// the call.

/** One of the two usage windows, as a share of it used, and when it starts over. */
export type UsageWindow = { utilization: number; resetsAt: string };
export type Reading = { at: string; fiveHour: UsageWindow; sevenDay: UsageWindow };

/**
 * The one-line Haiku call the gate reads from: no MCP server, no settings or
 * hooks of the clone's, and no session kept.
 */
export const GATE_ARGS = [
  "claude",
  "-p",
  "Reply with OK",
  "--model",
  "haiku",
  "--output-format",
  "stream-json",
  "--verbose",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--no-session-persistence",
];

/** The five-hour window's share above which nothing starts. */
export const FIVE_HOUR_LIMIT = 0.8;

/** The gate's reading in a `claude -p --output-format stream-json --verbose` run's output. */
export function readingFrom(stdout: string, at: Date): Reading {
  for (const line of stdout.split("\n")) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event.type !== "rate_limit_event") continue;
    const windows = asObject(
      asObject(event.rate_limit_info, "rate_limit_event.rate_limit_info").unifiedWindows,
      "rate_limit_event.rate_limit_info.unifiedWindows",
    );
    const read = (name: string): UsageWindow => {
      const found = asObject(windows[name], `unifiedWindows.${name}`);
      return {
        utilization: asNumber(found.utilization, `unifiedWindows.${name}.utilization`),
        resetsAt: new Date(
          asNumber(found.resetsAt, `unifiedWindows.${name}.resetsAt`) * 1000,
        ).toISOString(),
      };
    };
    return { at: at.toISOString(), fiveHour: read("five_hour"), sevenDay: read("seven_day") };
  }
  throw new ParseError("claude printed no rate_limit_event");
}

export type GateCheck = { ok: true } | { ok: false; why: string };

/** Whether a Stage whose estimate is `estimate` may start now. `force` skips the Ceiling, never the five-hour check. */
export function gateCheck(input: {
  reading: Reading;
  ceiling: number;
  /** The estimates of the Stages running. */
  running: readonly number[];
  estimate: number;
  force?: boolean;
}): GateCheck {
  const { reading, ceiling, running, estimate } = input;
  if (reading.fiveHour.utilization >= FIVE_HOUR_LIMIT) {
    return {
      ok: false,
      why: `the five-hour window is at ${percent(reading.fiveHour.utilization)}, ${percent(FIVE_HOUR_LIMIT)} at most, until ${reading.fiveHour.resetsAt}`,
    };
  }
  if (input.force === true) return { ok: true };
  const others = running.reduce((sum, value) => sum + value, 0);
  const total = reading.sevenDay.utilization + others + estimate;
  // A hair of slack, so 0.5 + 0.05 + 0.05 is within 0.6.
  if (total > ceiling + 1e-9) {
    return {
      ok: false,
      why: `the week is at ${percent(reading.sevenDay.utilization)}${others > 0 ? `, the Stages running take ${percent(others)}` : ""} and this one ${percent(estimate)}: ${percent(total)}, over the Ceiling of ${percent(ceiling)}`,
    };
  }
  return { ok: true };
}

export const percent = (share: number) => `${(share * 100).toFixed(1).replace(/\.0$/, "")}%`;
