import { ConfigError } from "../lib/config";
import { parseDays, parseNight, type Window } from "./window";

// The Dispatcher's settings (ADR-0013), from the runner's environment, which
// compose.yaml fills with their defaults: the window, the Ceiling and how
// many Stages may run at once. Server time is TZ, which bootstrap records
// from the host. Pure, so it is unit-tested.

export type DispatcherConfig = {
  window: Window;
  /** The share of the weekly window above which no Stage starts. */
  ceiling: number;
  /** How many Stages may run or wait paused at once. */
  maxStages: number;
  /** The server's timezone, or undefined for the system's. */
  timeZone: string | undefined;
};

export const DEFAULTS = {
  BANKI_RUNNER_NIGHT: "01:00-07:00",
  BANKI_RUNNER_OPEN_DAYS: "sat,sun",
  BANKI_RUNNER_CEILING: "0.60",
  BANKI_RUNNER_MAX_STAGES: "2",
} as const;

export function dispatcherConfig(env: Record<string, string | undefined>): DispatcherConfig {
  const value = (name: keyof typeof DEFAULTS) => env[name]?.trim() || DEFAULTS[name];
  const ceiling = Number(value("BANKI_RUNNER_CEILING"));
  if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 1) {
    throw new ConfigError(
      `BANKI_RUNNER_CEILING is ${JSON.stringify(value("BANKI_RUNNER_CEILING"))}: it is a share of the week, above 0 and at most 1, such as 0.60`,
    );
  }
  const maxStages = Number(value("BANKI_RUNNER_MAX_STAGES"));
  if (!Number.isInteger(maxStages) || maxStages < 1) {
    throw new ConfigError(
      `BANKI_RUNNER_MAX_STAGES is ${JSON.stringify(value("BANKI_RUNNER_MAX_STAGES"))}: it is a whole number, 1 or more`,
    );
  }
  const timeZone = env.TZ?.trim() || undefined;
  if (timeZone !== undefined) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions();
    } catch {
      throw new ConfigError(
        `TZ is ${JSON.stringify(timeZone)}, which isn't a timezone. Run deploy/runner/bootstrap.`,
      );
    }
  }
  return {
    window: {
      night: parseNight(value("BANKI_RUNNER_NIGHT")),
      openDays: parseDays(value("BANKI_RUNNER_OPEN_DAYS")),
    },
    ceiling,
    maxStages,
    timeZone,
  };
}
