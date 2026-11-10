import { Flag } from "lucide-react";
import { type Plan, daysBetween, longDate, today } from "@/lib/plan-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-57): Variant b's Countdown, taken into a's Rows. The count of
// Study days left, in large type, over a strip of them ending in the
// Deadline's flag.

/** The count of Study days left, in large type, and what it counts to. */
export function Countdown({ plan, passed }: { plan: Plan; passed: boolean }) {
  const days = daysBetween(today(), plan.deadline);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <p className="flex items-baseline gap-2">
        <span className="text-5xl leading-none font-semibold tracking-[-0.04em] tabular-nums">
          {passed ? "0" : days}
        </span>
        <span className="text-lg text-muted-foreground">
          {!passed && days === 1 ? "day left" : "days left"}
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
 * The Study days up to the Deadline, today first, one segment each, and the
 * Deadline's flag at the end. More than 70 days run together into one bar.
 * With no days yet, or past the Deadline, it is an outline.
 */
export function DayStrip({ days, passed = false }: { days: number | undefined; passed?: boolean }) {
  if (days === undefined || passed)
    return (
      <div className="flex items-center gap-2" aria-hidden>
        <div
          className={cn(
            "h-3 flex-1 rounded-full border border-dashed border-muted-foreground/40",
            passed && "border-solid bg-muted",
          )}
        />
        <Flag className="size-4 text-muted-foreground" />
      </div>
    );
  const many = days > 70;
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
