import type { AutoClose } from "@banki/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useId, useSyncExternalStore } from "react";
import { Combobox } from "@/components/settings/combobox";
import { OUTLINE_PILL, SaveState, SettingsCard } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { AUTO_CLOSE_OPTIONS, autoCloseSaveErrorText, matchAutoClose } from "@/lib/auto-close";
import { settingsQueryOptions } from "@/lib/settings";
import { shownSettings } from "@/lib/settings-saver";
import { settingsSaverFor } from "@/lib/settings-store";

const isAutoClose = (value: string): value is AutoClose =>
  AUTO_CLOSE_OPTIONS.some((option) => option.value === value);

/** Editor: how the card editor behaves as you type, on every device: auto-close. */
export function EditorCard() {
  const queryClient = useQueryClient();
  // Loads the Settings, which the saver starts from.
  useSuspenseQuery(settingsQueryOptions());
  const saver = settingsSaverFor(queryClient);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const shown = shownSettings(state);
  const failed = state.failures.find((failure) => failure.field === "autoClose");
  const label = useId();
  const hint = useId();
  const saving = state.saving.includes("autoClose");
  const saved = state.saved.includes("autoClose");

  return (
    <SettingsCard id="editor" title="Editor">
      <div className="flex flex-col gap-2">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span id={label} className="text-sm font-medium">
            Auto-close
          </span>
          <SaveState state={saving ? "saving" : saved ? "saved" : undefined} />
        </div>
        <Combobox
          options={AUTO_CLOSE_OPTIONS}
          value={shown.autoClose}
          onPick={(value) => {
            if (isAutoClose(value)) saver.change({ field: "autoClose", attempted: value });
          }}
          search={matchAutoClose}
          labelledBy={label}
          describedBy={hint}
          placeholder="Pick one"
          searchPlaceholder="Search: off, brackets or $"
          noMatch={(query) => `Nothing matches “${query}”.`}
          chevron
        />
        <p id={hint} className="text-sm text-muted-foreground">
          Typing {"{"}, ( or [ adds its closing bracket. With $, typing $ adds a second one for a
          Formula.
        </p>
        {failed?.field === "autoClose" && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
          >
            <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
            <p className="min-w-0 flex-1 text-destructive">
              {autoCloseSaveErrorText(failed.attempted, state.stored.autoClose)}
            </p>
            <Button
              variant="outline"
              size="lg"
              className={OUTLINE_PILL}
              onClick={() => saver.retry("autoClose")}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
