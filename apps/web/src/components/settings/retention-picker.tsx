import { CircleAlert } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/settings/combobox";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  PERCENT_OPTIONS,
  type Scope,
  changeRetention,
  matchPercents,
  retentionErrorText,
  retryRetention,
  useRetention,
} from "@/lib/proto-retention";

// PROTOTYPE ONLY (BAN-23): the Desired retention pickers and their save error.

const FOLLOW = "follow";

/** The global Desired retention: the whole percents 70–97. */
export function GlobalRetentionPicker({
  labelledBy,
  describedBy,
  autoFocus,
}: {
  labelledBy: string;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const { global } = useRetention();
  const search = useCallback((query: string) => matchPercents(PERCENT_OPTIONS, query), []);
  return (
    <Combobox
      options={PERCENT_OPTIONS}
      value={String(global)}
      onPick={(value) => changeRetention("global", Number(value))}
      search={search}
      labelledBy={labelledBy}
      {...(describedBy === undefined ? {} : { describedBy })}
      placeholder="Pick a percent"
      searchPlaceholder="Search: 85, 9 or default"
      noMatch={(query) => `No retention matches “${query}”. Pick 70–97%.`}
      chevron
      autoFocus={autoFocus ?? false}
    />
  );
}

/** A Deck's Desired retention: "Follow Settings", then the percents. */
export function DeckRetentionPicker({
  deckId,
  labelledBy,
  describedBy,
  autoFocus,
}: {
  deckId: string;
  labelledBy: string;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const { global, own } = useRetention();
  const options = useMemo<readonly ComboboxOption[]>(
    () => [
      {
        value: FOLLOW,
        label: "Follow Settings",
        display: `Follow Settings (${global}%)`,
        detail: `${global}%`,
      },
      ...PERCENT_OPTIONS.map((option) =>
        option.detail === "default" ? { value: option.value, label: option.label } : option,
      ),
    ],
    [global],
  );
  const search = useCallback(
    (query: string) => {
      const wanted = query.trim().toLowerCase();
      const follow = options.slice(0, 1).filter(
        (option) =>
          wanted === "" || "follow settings".includes(wanted) || "global".includes(wanted),
      );
      return [...follow, ...matchPercents(options.slice(1), query)];
    },
    [options],
  );
  const value = own(deckId);
  return (
    <Combobox
      options={options}
      value={value === null ? FOLLOW : String(value)}
      onPick={(picked) =>
        changeRetention({ deck: deckId }, picked === FOLLOW ? null : Number(picked))
      }
      search={search}
      labelledBy={labelledBy}
      {...(describedBy === undefined ? {} : { describedBy })}
      placeholder="Pick a percent"
      searchPlaceholder="Search: 85 or follow"
      noMatch={(query) => `Nothing matches “${query}”. Pick 70–97% or Follow Settings.`}
      chevron
      autoFocus={autoFocus ?? false}
    />
  );
}

/** A failed save's inline error, with Try again. */
export function RetentionError({ scope }: { scope: Scope }) {
  const { failure, global } = useRetention();
  const failed = failure(scope);
  if (failed === undefined) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
    >
      <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
      <p className="min-w-0 flex-1 text-destructive">{retentionErrorText(failed, global)}</p>
      <Button
        variant="outline"
        size="lg"
        className={OUTLINE_PILL}
        onClick={() => retryRetention(scope)}
      >
        Try again
      </Button>
    </div>
  );
}
