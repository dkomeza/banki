import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useId, useSyncExternalStore } from "react";
import { RetentionError, GlobalRetentionPicker } from "@/components/settings/retention-picker";
import { RetentionPicture } from "@/components/settings/retention-picture";
import { SaveState, SettingsCard } from "@/components/settings/parts";
import { decksQueryOptions } from "@/lib/decks";
import { globalRetentionErrorText } from "@/lib/retention";
import { settingsQueryOptions } from "@/lib/settings";
import { shownSettings } from "@/lib/settings-saver";
import { settingsSaverFor } from "@/lib/settings-store";

/** Study: the Desired retention every Deck follows until it has its own, and what it means. */
export function StudyCard() {
  const queryClient = useQueryClient();
  // Loads the Settings, which the saver starts from.
  useSuspenseQuery(settingsQueryOptions());
  const { data: decks } = useSuspenseQuery(decksQueryOptions());
  const saver = settingsSaverFor(queryClient);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const value = shownSettings(state).desiredRetention;
  const failed = state.failures.find((failure) => failure.field === "desiredRetention");
  const label = useId();
  const hint = useId();
  const saving = state.saving.includes("desiredRetention");
  const saved = state.saved.includes("desiredRetention");
  const ownCount = decks.filter((deck) => deck.desiredRetention !== null).length;

  return (
    <SettingsCard id="study" title="Study">
      <div className="flex flex-col gap-3">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span id={label} className="text-sm font-medium">
            Desired retention
          </span>
          <SaveState state={saving ? "saving" : saved ? "saved" : undefined} />
        </div>
        <GlobalRetentionPicker
          value={value}
          onPick={(picked) => saver.change({ field: "desiredRetention", attempted: picked })}
          labelledBy={label}
          describedBy={hint}
        />
        <RetentionPicture percent={value} />
        <p id={hint} className="text-sm text-muted-foreground">
          Of every 100 cards that come due, you'll remember about {value}. Higher means more
          reviews.{" "}
          {ownCount === 0
            ? "Every deck follows it unless you give it its own, in its Deck settings."
            : `Every deck follows it but ${ownCount === 1 ? "one" : ownCount}, which ${ownCount === 1 ? "has its" : "have their"} own.`}
        </p>
        {failed?.field === "desiredRetention" && (
          <RetentionError
            message={globalRetentionErrorText(failed.attempted, state.stored.desiredRetention)}
            onRetry={() => saver.retry("desiredRetention")}
          />
        )}
      </div>
    </SettingsCard>
  );
}
