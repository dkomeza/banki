import { Minus, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { type StepperRange, paged, stepped } from "@/lib/new-cards";
import { cn } from "@/lib/utils";

/**
 * A whole number with − and + beside it, inside a field's outline. The value
 * is a spinbutton: the arrow keys (and Page Up, Page Down, Home and End) move
 * it as − and + do. Each move calls `onStep` with the new value.
 */
export function Stepper({
  value,
  range,
  onStep,
  name,
  labelledBy,
  describedBy,
}: {
  value: number;
  range: StepperRange;
  onStep: (value: number) => void;
  /** What the buttons say they change, as in "Fewer new cards per batch". */
  name: { fewer: string; more: string };
  labelledBy: string;
  describedBy: string;
}) {
  const move = (next: number) => {
    if (next !== value) onStep(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, () => number> = {
      ArrowUp: () => stepped(value, 1, range),
      ArrowRight: () => stepped(value, 1, range),
      ArrowDown: () => stepped(value, -1, range),
      ArrowLeft: () => stepped(value, -1, range),
      PageUp: () => paged(value, 1, range),
      PageDown: () => paged(value, -1, range),
      Home: () => range.min,
      End: () => range.max,
    };
    const to = keys[event.key];
    if (to === undefined) return;
    event.preventDefault();
    move(to());
  };
  const side = "size-11 shrink-0 rounded-full text-foreground lg:size-9";

  return (
    <div className="flex h-14 items-center justify-between gap-2 rounded-xl border border-input bg-background px-1.5 lg:h-12 dark:bg-input/20">
      <Button
        variant="ghost"
        size="icon"
        className={side}
        aria-label={name.fewer}
        disabled={value <= range.min}
        // The spinbutton holds the focus, so the buttons stay out of the Tab order.
        tabIndex={-1}
        onClick={() => move(stepped(value, -1, range))}
      >
        <Minus aria-hidden className="size-5 lg:size-4" />
      </Button>
      <div
        role="spinbutton"
        tabIndex={0}
        aria-valuenow={value}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        className={cn(
          "min-w-16 flex-1 rounded-lg py-1 text-center text-[1.35rem] font-semibold tracking-tight tabular-nums outline-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        )}
      >
        {value}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={side}
        aria-label={name.more}
        disabled={value >= range.max}
        tabIndex={-1}
        onClick={() => move(stepped(value, 1, range))}
      >
        <Plus aria-hidden className="size-5 lg:size-4" />
      </Button>
    </div>
  );
}
