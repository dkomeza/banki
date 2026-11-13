import { CircleAlert, Sparkle } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Combobox } from "@/components/settings/combobox";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FOLLOW,
  PERCENT_OPTIONS,
  deckOptions,
  matchDeckOptions,
  matchPercents,
  recommendedText,
  withRecommended,
} from "@/lib/retention";

/** The Desired retention in Settings: the whole percents 70–97, the Recommended one tagged. */
export function GlobalRetentionPicker({
  value,
  recommended,
  onPick,
  labelledBy,
  describedBy,
}: {
  value: number;
  recommended: number | null;
  onPick: (value: number) => void;
  labelledBy: string;
  describedBy: string;
}) {
  const options = useMemo(() => withRecommended(PERCENT_OPTIONS, recommended), [recommended]);
  const search = useCallback((query: string) => matchPercents(options, query), [options]);
  return (
    <Combobox
      options={options}
      value={String(value)}
      onPick={(picked) => onPick(Number(picked))}
      search={search}
      labelledBy={labelledBy}
      describedBy={describedBy}
      placeholder="Pick a percent"
      searchPlaceholder="Search: 85, 9 or default"
      noMatch={(query) => `No retention matches “${query}”. Pick 70–97%.`}
      chevron
    />
  );
}

/** A Deck's Desired retention: "Follow Settings" (null), then the percents, the Recommended one tagged. */
export function DeckRetentionPicker({
  value,
  global,
  recommended,
  onPick,
  labelledBy,
  describedBy,
}: {
  value: number | null;
  global: number;
  recommended: number | null;
  onPick: (value: number | null) => void;
  labelledBy: string;
  describedBy: string;
}) {
  const options = useMemo(
    () => withRecommended(deckOptions(global), recommended),
    [global, recommended],
  );
  const search = useCallback((query: string) => matchDeckOptions(options, query), [options]);
  return (
    <Combobox
      options={options}
      value={value === null ? FOLLOW : String(value)}
      onPick={(picked) => onPick(picked === FOLLOW ? null : Number(picked))}
      search={search}
      labelledBy={labelledBy}
      describedBy={describedBy}
      placeholder="Pick a percent"
      searchPlaceholder="Search: 85 or follow"
      noMatch={(query) => `Nothing matches “${query}”. Pick 70–97% or Follow Settings.`}
      chevron
    />
  );
}

/**
 * The Recommended retention under a picker: what it is and why, with Use
 * while the value in effect (`current`) differs. Nothing while there is none.
 * Use sits beside the text only where the box itself is wide enough (a
 * container query), so a half-width card keeps it below.
 */
export function RecommendedRetention({
  percent,
  current,
  onUse,
  forDeck = false,
}: {
  percent: number | null;
  current: number;
  onUse: (percent: number) => void;
  /** Whether it is a Deck's own, from its own fit (ADR-0033). */
  forDeck?: boolean;
}) {
  if (percent === null) return null;
  const { title, reason } = recommendedText(percent, forDeck);
  return (
    <div className="@container rounded-xl bg-muted/60 p-4 text-sm">
      <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
        <Sparkle aria-hidden className="hidden size-5 shrink-0 text-primary @md:block" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground"> · {reason}</span>
        </p>
        {current !== percent && (
          <Button
            variant="outline"
            size="lg"
            className={cn(OUTLINE_PILL, "self-start @md:self-auto")}
            onClick={() => onUse(percent)}
          >
            Use {percent}%
          </Button>
        )}
      </div>
    </div>
  );
}

/** A failed save's inline error, with Try again. */
export function RetentionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
    >
      <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
      <p className="min-w-0 flex-1 text-destructive">{message}</p>
      <Button variant="outline" size="lg" className={OUTLINE_PILL} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
