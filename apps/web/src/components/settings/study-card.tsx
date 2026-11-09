import { ANSWER_MODES, type AnswerMode } from "@banki/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useId, useSyncExternalStore } from "react";
import { Combobox } from "@/components/settings/combobox";
import { RetentionError, GlobalRetentionPicker } from "@/components/settings/retention-picker";
import { RetentionPicture } from "@/components/settings/retention-picture";
import { SaveState, SettingsCard } from "@/components/settings/parts";
import {
  SETTINGS_ANSWER_MODE_OPTIONS,
  matchAnswerModes,
  settingsAnswerModeErrorText,
} from "@/lib/deck-answer-mode";
import { type Deck, decksQueryOptions } from "@/lib/decks";
import { globalRetentionErrorText } from "@/lib/retention";
import { settingsQueryOptions } from "@/lib/settings";
import { type SettingsSaver, shownSettings } from "@/lib/settings-saver";
import { settingsSaverFor } from "@/lib/settings-store";

/**
 * Study: what every Deck follows until it has its own, the Desired retention
 * (and what it means) and the Answer mode.
 */
export function StudyCard() {
  const queryClient = useQueryClient();
  // Loads the Settings, which the saver starts from.
  useSuspenseQuery(settingsQueryOptions());
  const { data: decks } = useSuspenseQuery(decksQueryOptions());
  const saver = settingsSaverFor(queryClient);

  return (
    <SettingsCard id="study" title="Study">
      <RetentionField saver={saver} decks={decks} />
      <AnswerModeField saver={saver} decks={decks} />
    </SettingsCard>
  );
}

/** "Every deck follows it…": how many of `decks` have their own, by `hasOwn`. */
function followersText(decks: readonly Deck[], hasOwn: (deck: Deck) => boolean): string {
  const ownCount = decks.filter(hasOwn).length;
  return ownCount === 0
    ? "Every deck follows it unless you give it its own, in its Deck settings."
    : `Every deck follows it but ${ownCount === 1 ? "one" : ownCount}, which ${ownCount === 1 ? "has its" : "have their"} own.`;
}

/** Desired retention: its picker and picture, autosaving, with save state and error. */
function RetentionField({ saver, decks }: { saver: SettingsSaver; decks: readonly Deck[] }) {
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const value = shownSettings(state).desiredRetention;
  const failed = state.failures.find((failure) => failure.field === "desiredRetention");
  const label = useId();
  const hint = useId();
  const saving = state.saving.includes("desiredRetention");
  const saved = state.saved.includes("desiredRetention");

  return (
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
        Of every 100 cards that come due, you'll remember about {value}. Higher means more reviews.{" "}
        {followersText(decks, (deck) => deck.desiredRetention !== null)}
      </p>
      {failed?.field === "desiredRetention" && (
        <RetentionError
          message={globalRetentionErrorText(failed.attempted, state.stored.desiredRetention)}
          onRetry={() => saver.retry("desiredRetention")}
        />
      )}
    </div>
  );
}

const isAnswerMode = (value: string): value is AnswerMode =>
  ANSWER_MODES.some((mode) => mode === value);

const searchAnswerModes = (query: string) => matchAnswerModes(SETTINGS_ANSWER_MODE_OPTIONS, query);

/** Answer mode: Rate yourself or Write and grade, autosaving, with save state and error. */
function AnswerModeField({ saver, decks }: { saver: SettingsSaver; decks: readonly Deck[] }) {
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const value = shownSettings(state).answerMode;
  const failed = state.failures.find((failure) => failure.field === "answerMode");
  const label = useId();
  const hint = useId();
  const saving = state.saving.includes("answerMode");
  const saved = state.saved.includes("answerMode");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span id={label} className="text-sm font-medium">
          Answer mode
        </span>
        <SaveState state={saving ? "saving" : saved ? "saved" : undefined} />
      </div>
      <Combobox
        options={SETTINGS_ANSWER_MODE_OPTIONS}
        value={value}
        onPick={(picked) => {
          if (isAnswerMode(picked)) saver.change({ field: "answerMode", attempted: picked });
        }}
        search={searchAnswerModes}
        labelledBy={label}
        describedBy={hint}
        placeholder="Pick one"
        searchPlaceholder="Search: rate or write"
        noMatch={(query) => `Nothing matches “${query}”.`}
        chevron
      />
      <p id={hint} className="text-sm text-muted-foreground">
        Rate yourself shows the answer, then you rate how well you recalled it. Write and grade asks
        you to write your answer first. A new session starts in it.{" "}
        {followersText(decks, (deck) => deck.answerMode !== null)}
      </p>
      {failed?.field === "answerMode" && (
        <RetentionError
          message={settingsAnswerModeErrorText(failed.attempted, state.stored.answerMode)}
          onRetry={() => saver.retry("answerMode")}
        />
      )}
    </div>
  );
}
