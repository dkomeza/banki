import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// The three steps of an Import, named over each of its pages.

const STEPS = ["Source", "Preview", "Report"] as const;

export function Steps({ at }: { at: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Import steps" className="flex items-center gap-2 text-sm">
      {STEPS.map((step, i) => (
        <li
          key={step}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 text-muted-foreground",
            i === at && "font-medium text-foreground",
          )}
        >
          {i > 0 && <span aria-hidden className="h-px w-5 bg-border sm:w-8" />}
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-xs tabular-nums",
              i === at && "border-primary bg-primary text-primary-foreground",
              i < at && "border-primary text-primary",
            )}
          >
            {i < at ? <Check aria-hidden className="size-3.5" /> : i + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}
