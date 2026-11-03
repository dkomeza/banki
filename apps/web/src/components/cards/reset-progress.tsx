import { RotateCcw } from "lucide-react";
import { marginIndent } from "@/components/cards/stacked";
import type { Card } from "@/lib/cards";
import { cn } from "@/lib/utils";

/**
 * The Reset progress row under a studied Card's Tags (CONTEXT.md: Progress
 * reset): a bordered box, with a line on what a reset does, that takes the
 * accent when ticked, its arrow turning and its line saying what Save will do.
 * Never ticked by default, and not there at all on a New Card.
 */
export function ResetProgress({
  card,
  checked,
  onChange,
  disabled = false,
  stacked = false,
}: {
  card: Card;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** In a narrow form, lined up with the fields as they are (`STACKED_ROW`). */
  stacked?: boolean;
}) {
  if (!card.studied) return null;
  return (
    <div className={marginIndent(stacked)}>
      <label
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors motion-reduce:transition-none",
          checked ? "border-primary/60 bg-primary/8" : "bg-muted/50 hover:bg-muted",
        )}
      >
        <RotateCcw
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-[rotate,color] duration-500 ease-out motion-reduce:transition-none",
            checked ? "-rotate-360 text-primary" : "text-muted-foreground",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">Reset progress</span>
          <span
            key={String(checked)}
            className="text-[0.8rem] leading-snug text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-300"
          >
            {checked
              ? "On save, this card goes back to New and you rate it again from the start."
              : "Keeps its reviews, and starts it over as New."}
          </span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="size-5 shrink-0 cursor-pointer accent-primary"
        />
      </label>
    </div>
  );
}
