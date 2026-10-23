import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CircleAlert, Globe } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { DayBar } from "@/components/settings/day-bar";
import { DayStartCombobox } from "@/components/settings/day-start-combobox";
import { OUTLINE_PILL, PILL, SaveState } from "@/components/settings/parts";
import { TimezoneCombobox } from "@/components/settings/timezone-combobox";
import { Button } from "@/components/ui/button";
import { saveSettings, settingsQueryOptions } from "@/lib/settings";
import {
  type Field,
  type SaverState,
  createSettingsSaver,
  shownSettings,
} from "@/lib/settings-saver";
import { dayStartEffect, deviceTimezone, offsetOf, sameTimezone, saveErrorText } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The Timezone and Day start, saved as they change, one at a time and in
 * order (see createSettingsSaver), keeping the settings query in step.
 */
function useStudyDaySettings() {
  const queryClient = useQueryClient();
  const options = settingsQueryOptions();
  const { data } = useSuspenseQuery(options);
  const [saver] = useState(() =>
    createSettingsSaver({
      initial: data,
      save: (patch) => saveSettings(patch),
      onStored: (settings) => queryClient.setQueryData(options.queryKey, settings),
    }),
  );
  useEffect(() => () => saver.dispose(), [saver]);
  // The first fill, or another tab, may store Settings after this page opened.
  useEffect(() => saver.sync(data), [saver, data]);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  return { saver, state, shown: shownSettings(state) };
}

const stateOf = (state: SaverState, field: Field) =>
  state.saving.includes(field) ? "saving" : state.saved.includes(field) ? "saved" : undefined;

/**
 * Your Study day: what the Day start does, the Day bar that shows it, and the
 * Timezone and Day start that move it. First on the Settings page, full width.
 */
export function StudyDayCard() {
  const { saver, state, shown } = useStudyDaySettings();
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
            <SaveState state={stateOf(state, "timezone")} />
          </div>
          <TimezoneCombobox
            value={shown.timezone}
            onChange={(timezone) => saver.change({ field: "timezone", attempted: timezone })}
            labelledBy={timezoneLabel}
            describedBy={timezoneHint}
          />
          <p id={timezoneHint} className="text-sm text-muted-foreground">
            The same on every device, even when you travel.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-3">
            <span id={dayStartId} className="text-sm font-medium">
              Day start
            </span>
            <SaveState state={stateOf(state, "dayStartHour")} />
          </div>
          <DayStartCombobox
            value={shown.dayStartHour}
            onChange={(hour) => saver.change({ field: "dayStartHour", attempted: hour })}
            labelledBy={dayStartId}
          />
        </div>
      </div>

      {state.failures.map((failure) => (
        <div
          key={failure.field}
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
        >
          <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
          <p className="min-w-0 flex-1 text-destructive">{saveErrorText(failure, state.stored)}</p>
          <Button
            variant="outline"
            size="lg"
            className={OUTLINE_PILL}
            onClick={() => saver.retry(failure.field)}
          >
            Try again
          </Button>
        </div>
      ))}

      {mismatch && (
        <div className="flex flex-col gap-3 rounded-xl bg-accent p-4 text-[0.95rem] text-accent-foreground sm:flex-row sm:items-center">
          <Globe aria-hidden className="hidden size-5 shrink-0 text-primary sm:block" />
          <p className="min-w-0 flex-1">
            This device is in <strong className="font-semibold">{device}</strong> (
            {offsetOf(device)}). Banki still counts days in {shown.timezone}.
          </p>
          <Button
            size="lg"
            // A long zone name wraps rather than push the card wider.
            className={cn(
              PILL,
              "h-auto min-h-11 shrink whitespace-normal py-2 text-center [overflow-wrap:anywhere] lg:h-auto lg:min-h-10",
            )}
            onClick={() => saver.change({ field: "timezone", attempted: device })}
          >
            Use {device}
          </Button>
        </div>
      )}
    </section>
  );
}
