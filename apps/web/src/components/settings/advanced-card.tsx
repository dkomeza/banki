import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useId, useSyncExternalStore } from "react";
import { SaveState, SettingsCard } from "@/components/settings/parts";
import { RetentionError } from "@/components/settings/retention-picker";
import { Stepper } from "@/components/settings/stepper";
import {
  LEARNING_LIMIT_RANGE,
  NEW_CARD_BATCH_RANGE,
  type StepperRange,
  pacingErrorText,
} from "@/lib/new-cards";
import { settingsQueryOptions } from "@/lib/settings";
import { type SettingsSaver, shownSettings } from "@/lib/settings-saver";
import { settingsSaverFor } from "@/lib/settings-store";

type PacingSetting = "newCardBatch" | "learningLimit";

/** Advanced: how a Session paces New cards, the New-card batch and the Learning limit. */
export function AdvancedCard() {
  const queryClient = useQueryClient();
  // Loads the Settings, which the saver starts from.
  useSuspenseQuery(settingsQueryOptions());
  const saver = settingsSaverFor(queryClient);

  return (
    <SettingsCard id="advanced" title="Advanced">
      <PacingField
        saver={saver}
        field="newCardBatch"
        range={NEW_CARD_BATCH_RANGE}
        label="New cards per batch"
        hint="A session introduces this many new cards, then offers you more."
        name={{ fewer: "Fewer new cards per batch", more: "More new cards per batch" }}
      />
      <PacingField
        saver={saver}
        field="learningLimit"
        range={LEARNING_LIMIT_RANGE}
        label="Learning limit"
        hint="New cards pause while this many cards are still in their learning steps."
        name={{ fewer: "Lower learning limit", more: "Higher learning limit" }}
      />
    </SettingsCard>
  );
}

/** One of the pacing Settings: its stepper, autosaving, with save state and error. */
function PacingField({
  saver,
  field,
  range,
  label,
  hint,
  name,
}: {
  saver: SettingsSaver;
  field: PacingSetting;
  range: StepperRange;
  label: string;
  hint: string;
  name: { fewer: string; more: string };
}) {
  // The same snapshot on the server, where the tests render it.
  const state = useSyncExternalStore(saver.subscribe, saver.getState, saver.getState);
  const value = shownSettings(state)[field];
  const failed = state.failures.find((failure) => failure.field === field);
  const labelId = useId();
  const hintId = useId();
  const saving = state.saving.includes(field);
  const saved = state.saved.includes(field);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span id={labelId} className="text-sm font-medium">
          {label}
        </span>
        <SaveState state={saving ? "saving" : saved ? "saved" : undefined} />
      </div>
      <Stepper
        value={value}
        range={range}
        onStep={(attempted) => saver.change({ field, attempted })}
        name={name}
        labelledBy={labelId}
        describedBy={hintId}
      />
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </p>
      {failed?.field === field && (
        <RetentionError
          message={pacingErrorText(failed.attempted, state.stored[field])}
          onRetry={() => saver.retry(field)}
        />
      )}
    </div>
  );
}
