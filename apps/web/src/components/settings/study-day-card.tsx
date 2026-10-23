import type { SettingsResponse } from "@banki/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ChevronDown, CircleAlert, Globe } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DayBar } from "@/components/settings/day-bar";
import { FIELD, OUTLINE_PILL, PILL, SaveState } from "@/components/settings/parts";
import { TimezoneCombobox } from "@/components/settings/timezone-combobox";
import { Button } from "@/components/ui/button";
import { saveSettings, settingsQueryOptions } from "@/lib/settings";
import {
  type FailedSave,
  dayStartEffect,
  deviceTimezone,
  formatHour,
  offsetOf,
  sameTimezone,
  saveErrorText,
} from "@/lib/time";
import { cn } from "@/lib/utils";

type Field = FailedSave["field"];

type SaveStatus =
  | { field: Field; kind: "saving" | "saved" }
  | ({ kind: "error" } & FailedSave)
  | undefined;

/** How long "Saved" stays beside a field. */
const SAVED_MS = 2000;

/**
 * The Timezone and Day start, saved as they change. The new value shows at
 * once; if its save fails, the stored one comes back with an error saying so.
 * Only the latest change's answer counts, so a slow earlier one can't
 * overwrite it.
 */
function useStudyDaySettings() {
  const queryClient = useQueryClient();
  const options = settingsQueryOptions();
  const { data: stored } = useSuspenseQuery(options);
  const [pending, setPending] = useState<Partial<SettingsResponse>>({});
  const [status, setStatus] = useState<SaveStatus>();
  const latest = useRef(0);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const save = async (change: FailedSave) => {
    const attempt = ++latest.current;
    window.clearTimeout(savedTimer.current);
    setPending((before) => ({ ...before, [change.field]: change.attempted }));
    setStatus({ field: change.field, kind: "saving" });
    try {
      const saved = await saveSettings({ [change.field]: change.attempted });
      if (attempt !== latest.current) return;
      queryClient.setQueryData(options.queryKey, saved);
      setPending({});
      setStatus({ field: change.field, kind: "saved" });
      savedTimer.current = window.setTimeout(() => setStatus(undefined), SAVED_MS);
    } catch {
      if (attempt !== latest.current) return;
      setPending({});
      setStatus({ kind: "error", ...change });
      // What is stored now, in case an earlier change did save.
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
    }
  };

  const shown = { ...stored, ...pending };
  return {
    stored,
    shown,
    status,
    setTimezone: (timezone: string) => void save({ field: "timezone", attempted: timezone }),
    setDayStartHour: (hour: number) => void save({ field: "dayStartHour", attempted: hour }),
    retry: () => {
      if (status?.kind === "error") {
        const { kind: _, ...change } = status;
        void save(change);
      }
    },
  };
}

const stateOf = (status: SaveStatus, field: Field) =>
  status !== undefined && status.kind !== "error" && status.field === field
    ? status.kind
    : undefined;

/**
 * Your Study day: what the Day start does, the Day bar that shows it, and the
 * Timezone and Day start that move it. First on the Settings page, full width.
 */
export function StudyDayCard() {
  const settings = useStudyDaySettings();
  const { shown, stored, status } = settings;
  const timezoneLabel = useId();
  const timezoneHint = useId();
  const dayStartId = useId();
  const device = deviceTimezone();
  const mismatch = shown.timezone !== null && !sameTimezone(device, shown.timezone);

  return (
    <section
      id="study-day"
      aria-labelledby="study-day-title"
      className="flex scroll-mt-28 flex-col gap-6 rounded-[1.5rem] border bg-card p-5 text-card-foreground sm:p-7 lg:p-8"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="study-day-title" className="text-xl font-semibold tracking-tight lg:text-2xl">
          Your Study day
        </h2>
        <p className="max-w-prose text-[0.95rem] text-muted-foreground">
          {dayStartEffect(shown.dayStartHour)}
        </p>
      </div>

      <DayBar settings={shown} />

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-3">
            <span id={timezoneLabel} className="text-sm font-medium">
              Timezone
            </span>
            <SaveState state={stateOf(status, "timezone")} />
          </div>
          <TimezoneCombobox
            value={shown.timezone}
            onChange={settings.setTimezone}
            labelledBy={timezoneLabel}
            describedBy={timezoneHint}
          />
          <p id={timezoneHint} className="text-sm text-muted-foreground">
            The same on every device, even when you travel.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-3">
            <label htmlFor={dayStartId} className="text-sm font-medium">
              Day start
            </label>
            <SaveState state={stateOf(status, "dayStartHour")} />
          </div>
          <div className="relative">
            <select
              id={dayStartId}
              value={shown.dayStartHour}
              onChange={(event) => settings.setDayStartHour(Number(event.target.value))}
              className={cn(
                FIELD,
                "w-full appearance-none border border-input pr-10 transition-colors outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid",
              )}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {formatHour(hour)}
                  {hour === 4 ? " (default)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {status?.kind === "error" && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
        >
          <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
          <p className="min-w-0 flex-1 text-destructive">{saveErrorText(status, stored)}</p>
          <Button variant="outline" size="lg" className={OUTLINE_PILL} onClick={settings.retry}>
            Try again
          </Button>
        </div>
      )}

      {mismatch && (
        <div className="flex flex-col gap-3 rounded-xl bg-accent p-4 text-[0.95rem] text-accent-foreground sm:flex-row sm:items-center">
          <Globe aria-hidden className="hidden size-5 shrink-0 text-primary sm:block" />
          <p className="min-w-0 flex-1">
            This device is in <strong className="font-semibold">{device}</strong> (
            {offsetOf(device)}). Banki still counts days in {shown.timezone}.
          </p>
          <Button
            size="lg"
            className={cn(PILL, "shrink-0")}
            onClick={() => settings.setTimezone(device)}
          >
            Use {device}
          </Button>
        </div>
      )}
    </section>
  );
}
