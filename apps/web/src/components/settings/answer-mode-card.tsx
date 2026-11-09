import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useId, useMemo, useSyncExternalStore } from "react";
import { Combobox } from "@/components/settings/combobox";
import { SaveState, SettingsCard } from "@/components/settings/parts";
import { RetentionError } from "@/components/settings/retention-picker";
import {
  answerModeErrorText,
  answerModeName,
  answerModeOptions,
  deckAnswerModeSaverFor,
  matchAnswerModes,
  pickedAnswerMode,
} from "@/lib/deck-answer-mode";
import type { Deck } from "@/lib/decks";
import { FOLLOW } from "@/lib/retention";
import { settingsQueryOptions } from "@/lib/settings";
import { shownSettings } from "@/lib/settings-saver";
import { settingsSaverFor } from "@/lib/settings-store";

/**
 * Deck settings' Answer mode: Rate yourself or Write and grade, or Settings'
 * while it follows them, as Desired retention does; saved as it changes. A
 * Session starts in it, and the study screen switches it for that Session.
 * Settings' mode shows as Settings do, a change not saved yet included.
 */
export function AnswerModeCard({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const saver = deckAnswerModeSaverFor(queryClient, deck.id);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  // The change not answered yet, if any, or what is stored.
  const own = state.queue.length === 0 ? deck.answerMode : (state.queue.at(-1) ?? null);
  // Loads the Settings, which their saver starts from.
  useSuspenseQuery(settingsQueryOptions());
  const settingsSaver = settingsSaverFor(queryClient);
  const followed = shownSettings(
    useSyncExternalStore(settingsSaver.subscribe, settingsSaver.getState),
  ).answerMode;
  const options = useMemo(() => answerModeOptions(followed), [followed]);
  const search = useCallback((query: string) => matchAnswerModes(options, query), [options]);
  const label = useId();
  const hint = useId();

  return (
    <SettingsCard id="answer-mode" title="Answer mode">
      <div className="flex flex-col gap-2">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span id={label} className="text-sm font-medium">
            How you answer this deck's cards
          </span>
          <SaveState
            state={state.queue.length > 0 ? "saving" : state.saved ? "saved" : undefined}
          />
        </div>
        <Combobox
          options={options}
          value={own ?? FOLLOW}
          onPick={(value) => {
            const picked = pickedAnswerMode(value);
            if (picked !== undefined) saver.change(picked);
          }}
          search={search}
          labelledBy={label}
          describedBy={hint}
          placeholder="Pick one"
          searchPlaceholder="Search: rate, write or follow"
          noMatch={(query) => `Nothing matches “${query}”.`}
          chevron
        />
        <p id={hint} className="text-sm text-muted-foreground">
          {own === null
            ? `Follows Settings: ${answerModeName(followed)}. `
            : "Its own, whatever Settings say. "}
          Rate yourself shows the answer, then you rate how well you recalled it. Write and grade
          asks you to write your answer first. A session can switch as you study.
        </p>
        {state.failed !== undefined && (
          <RetentionError
            message={answerModeErrorText(state.failed.attempted, deck.answerMode, followed)}
            onRetry={() => saver.retry()}
          />
        )}
      </div>
    </SettingsCard>
  );
}
