import { type StudyDay, addStudyDays, lastDeadline } from "@banki/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { firstDeadline } from "@/lib/plans";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** A day's year and month, the month from 0. */
const monthOf = (day: StudyDay) => ({
  year: Number(day.slice(0, 4)),
  month: Number(day.slice(5, 7)) - 1,
});

const dayOf = (date: Date): StudyDay => date.toISOString().slice(0, 10);

/** The month's weeks, Monday first, null outside the month. */
function monthWeeks(year: number, month: number): (StudyDay | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (StudyDay | null)[] = Array.from({ length: lead }, () => null);
  for (let date = 1; date <= length; date++)
    cells.push(dayOf(new Date(Date.UTC(year, month, date))));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (StudyDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const monthName = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** "Saturday 12 December", a day button's name. */
const dayName = (day: StudyDay) =>
  new Date(`${day}T00:00:00Z`)
    .toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    })
    .replace(",", "");

/**
 * A month of days to pick a Deadline from, Monday first. Days before tomorrow
 * or past 2 years are out of reach; today is ringed and the picked day filled
 * with the accent. Arrow keys move between days, Page Up and Down by a month,
 * Enter or Space picks.
 */
export function PlanCalendar({
  value,
  today,
  onPick,
}: {
  value: StudyDay | undefined;
  /** The User's Study day now. */
  today: StudyDay;
  onPick: (day: StudyDay) => void;
}) {
  const first = firstDeadline(today);
  const last = lastDeadline(today);
  const reachable = (day: StudyDay) => day >= first && day <= last;
  const start = value !== undefined && reachable(value) ? value : first;
  const [focus, setFocus] = useState<StudyDay>(start);
  const [shown, setShown] = useState(() => monthOf(start));
  const grid = useRef<HTMLDivElement>(null);
  const weeks = monthWeeks(shown.year, shown.month);

  const showMonth = (by: number) => {
    const date = new Date(Date.UTC(shown.year, shown.month + by, 1));
    setShown({ year: date.getUTCFullYear(), month: date.getUTCMonth() });
  };
  const moveTo = (day: StudyDay) => {
    setShown(monthOf(day));
    setFocus(day);
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus(),
    );
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const by: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      PageUp: -30,
      PageDown: 30,
    };
    const step = by[event.key];
    if (step === undefined) return;
    event.preventDefault();
    moveTo(addStudyDays(focus, step));
  };
  const firstOfMonth = `${shown.year}-${String(shown.month + 1).padStart(2, "0")}-01`;
  const canBack = firstOfMonth > `${first.slice(0, 7)}-01`;
  const canForward = firstOfMonth < `${last.slice(0, 7)}-01`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 rounded-full lg:size-9"
          aria-label="Previous month"
          disabled={!canBack}
          onClick={() => showMonth(-1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <p aria-live="polite" className="font-medium">
          {monthName(shown.year, shown.month)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 rounded-full lg:size-9"
          aria-label="Next month"
          disabled={!canForward}
          onClick={() => showMonth(1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div
        ref={grid}
        role="grid"
        aria-label={monthName(shown.year, shown.month)}
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-y-1 text-center"
      >
        <div role="row" className="contents">
          {WEEKDAYS.map((day) => (
            <span
              key={day}
              role="columnheader"
              className="pb-1 text-xs font-medium text-muted-foreground"
            >
              {day}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week.find((day) => day !== null)} role="row" className="contents">
            {week.map((day, cell) => {
              // oxlint-disable-next-line react/no-array-index-key -- blank cells have nothing else to key by
              if (day === null) return <span key={cell} role="gridcell" />;
              const picked = day === value;
              const isToday = day === today;
              return (
                <span key={day} role="gridcell" className="flex justify-center">
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === focus ? 0 : -1}
                    disabled={!reachable(day)}
                    aria-pressed={picked}
                    aria-label={dayName(day)}
                    onFocus={() => setFocus(day)}
                    onClick={() => onPick(day)}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full text-[0.95rem] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:size-9 lg:text-sm",
                      reachable(day) && !picked && "hover:bg-muted",
                      !reachable(day) && !isToday && "text-muted-foreground/45",
                      isToday && !picked && "font-semibold ring-1 ring-foreground/60 ring-inset",
                      picked && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
