import type { StudyDay } from "@banki/shared";
import { Flag } from "lucide-react";
import { type Plan, daysBetween, longDate } from "@/lib/plans";
import { cn } from "@/lib/utils";

/** Past this many Study days, the strip's days run together into one bar. */
const DAYS_SHOWN_MAX = 70;

/**
 * The Study days left to a Plan's Deadline, in large type, and the day it
 * counts to: none once the Deadline has come.
 */
export function Countdown({ plan, today }: { plan: Plan; today: StudyDay }) {
  const days = Math.max(0, daysBetween(today, plan.deadline));
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <p className="flex items-baseline gap-2">
        <span className="text-5xl leading-none font-semibold tracking-[-0.04em] tabular-nums">
          {days}
        </span>
        <span className="text-lg text-muted-foreground">
          {days === 1 ? "day left" : "days left"}
        </span>
      </p>
      <p className="text-[0.95rem]">
        <span className="text-muted-foreground">to </span>
        <span className="font-medium">{longDate(plan.deadline)}</span>
      </p>
    </div>
  );
}

/**
 * The Study days up to the Deadline, today first, a segment each, and the
 * Deadline's flag at the end. More than 70 run together into one bar. Once
 * the Deadline has come, it is an empty bar.
 */
export function DayStrip({ days }: { days: number }) {
  if (days <= 0)
    return (
      <div className="flex items-center gap-2" aria-hidden>
        <div className="h-3 flex-1 rounded-full border bg-muted" />
        <Flag className="size-4 text-muted-foreground" />
      </div>
    );
  const many = days > DAYS_SHOWN_MAX;
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className={cn("flex h-3 flex-1", many ? "gap-0" : "gap-[2px]")}>
        {many ? (
          <div className="flex-1 rounded-full bg-primary/25">
            <div className="h-full w-1 rounded-full bg-primary" />
          </div>
        ) : (
          Array.from({ length: days }, (_, index) => (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- the days are only ever counted
              key={index}
              className={cn(
                "flex-1 first:rounded-l-full last:rounded-r-full",
                index === 0 ? "bg-primary" : "bg-primary/25",
              )}
            />
          ))
        )}
      </div>
      <Flag className="size-4 text-primary" />
    </div>
  );
}
