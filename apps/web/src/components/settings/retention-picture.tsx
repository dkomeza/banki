import { cn } from "@/lib/utils";

/**
 * What a Desired retention means, as a picture: ten cards coming due, each a
 * tenth of them, with what you'll remember filled in the accent, so 85% is
 * eight and a half cards.
 */
export function RetentionPicture({ percent, className }: { percent: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex items-center gap-1.5", className)}>
      {Array.from({ length: 10 }, (_, index) => {
        const filled = Math.min(Math.max(percent / 10 - index, 0), 1);
        return (
          <span
            key={index}
            className={cn(
              "relative h-7 flex-1 overflow-hidden rounded-md border sm:h-8",
              filled === 1 ? "border-primary" : "border-dashed border-input bg-background",
            )}
          >
            <span
              className="absolute inset-y-0 left-0 bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${filled * 100}%` }}
            />
          </span>
        );
      })}
    </div>
  );
}
