import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type Day,
  addDays,
  daysBetween,
  lastDeadline,
  monthName,
  monthOf,
  monthWeeks,
  today,
} from "@/lib/plan-proto";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * PROTOTYPE (BAN-57): a month of days to pick a Deadline from, Monday first.
 * Days before tomorrow or past 2 years are out of reach; today is ringed, the
 * picked day filled with the accent, and with `span` the Study days before it
 * are shaded, as those are the days the Plan studies on. Arrow keys move
 * between days, Page Up and Down between months, Enter or Space picks.
 */
export function PlanCalendar({
  value,
  onPick,
  span = false,
  className,
}: {
  value: Day | undefined;
  onPick: (day: Day) => void;
  span?: boolean;
  className?: string;
}) {
  const now = today();
  const first = addDays(now, 1);
  const last = lastDeadline(now);
  const [focus, setFocus] = useState<Day>(value ?? first);
  const [shown, setShown] = useState(() => monthOf(value ?? first));
  const grid = useRef<HTMLDivElement>(null);
  const weeks = monthWeeks(shown.year, shown.month);
  const reachable = (day: Day) => day >= first && day <= last;

  const showMonth = (by: number) => {
    const date = new Date(Date.UTC(shown.year, shown.month + by, 1));
    setShown({ year: date.getUTCFullYear(), month: date.getUTCMonth() });
  };
  const moveTo = (day: Day) => {
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
    moveTo(addDays(focus, step));
  };
  const firstOfMonth = `${shown.year}-${String(shown.month + 1).padStart(2, "0")}-01`;
  const canBack = firstOfMonth > now.slice(0, 7) + "-01";
  const canForward = firstOfMonth < last.slice(0, 7) + "-01";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
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
        {weeks.map((week, index) => (
          <div key={index} role="row" className="contents">
            {week.map((day, cell) => {
              if (day === null) return <span key={cell} role="gridcell" />;
              const picked = day === value;
              const studied = span && value !== undefined && day >= now && day < value && !picked;
              const isToday = day === now;
              return (
                <span key={day} role="gridcell" className="flex justify-center">
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === focus ? 0 : -1}
                    disabled={!reachable(day)}
                    aria-pressed={picked}
                    aria-label={new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      timeZone: "UTC",
                    })}
                    onFocus={() => setFocus(day)}
                    onClick={() => onPick(day)}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full text-[0.95rem] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:size-9 lg:text-sm",
                      reachable(day) && !picked && "hover:bg-muted",
                      !reachable(day) && !isToday && "text-muted-foreground/45",
                      studied && "rounded-none bg-accent",
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
      {span && value !== undefined && (
        <p className="text-sm text-muted-foreground">
          {daysBetween(now, value)} study {daysBetween(now, value) === 1 ? "day" : "days"} before
          it, today included.
        </p>
      )}
    </div>
  );
}
