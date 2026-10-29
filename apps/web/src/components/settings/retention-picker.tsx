import { CircleAlert } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Combobox } from "@/components/settings/combobox";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  FOLLOW,
  PERCENT_OPTIONS,
  deckOptions,
  matchDeckOptions,
  matchPercents,
} from "@/lib/retention";

/** The Desired retention in Settings: the whole percents 70–97. */
export function GlobalRetentionPicker({
  value,
  onPick,
  labelledBy,
  describedBy,
}: {
  value: number;
  onPick: (value: number) => void;
  labelledBy: string;
  describedBy: string;
}) {
  const search = useCallback((query: string) => matchPercents(PERCENT_OPTIONS, query), []);
  return (
    <Combobox
      options={PERCENT_OPTIONS}
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

/** A Deck's Desired retention: "Follow Settings" (null), then the percents. */
export function DeckRetentionPicker({
  value,
  global,
  onPick,
  labelledBy,
  describedBy,
}: {
  value: number | null;
  global: number;
  onPick: (value: number | null) => void;
  labelledBy: string;
  describedBy: string;
}) {
  const options = useMemo(() => deckOptions(global), [global]);
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
