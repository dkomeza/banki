import { type ApiKeyStatus, type ModelId, effectiveModelId, modelById } from "@banki/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useRef, useState, useSyncExternalStore } from "react";
import { FormError } from "@/components/auth-card";
import { ModelCombobox, ModelSummary } from "@/components/settings/model-combobox";
import {
  Done,
  Field,
  OUTLINE_PILL,
  PILL,
  Row,
  SaveState,
  SettingsCard,
} from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type ApiKeyOutcome,
  apiKeyProblem,
  apiKeyValue,
  modelSaveErrorText,
  removeApiKey,
  saveApiKey,
} from "@/lib/grading";
import { type SettingsRead, settingsQueryOptions } from "@/lib/settings";
import { shownSettings } from "@/lib/settings-saver";
import { settingsSaverFor } from "@/lib/settings-store";

/** The form a Change button opens in place, inside the card, on a muted background. */
const FORM = "flex flex-col gap-4 rounded-xl bg-muted p-4";

/**
 * Grading: the OpenRouter API key the Grader runs on, and the Model it runs.
 * First in the Settings page's masonry.
 */
export function GradingCard() {
  const queryClient = useQueryClient();
  // Loads the Settings, which the saver starts from.
  useSuspenseQuery(settingsQueryOptions());
  const saver = settingsSaverFor(queryClient);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const shown = shownSettings(state);

  return (
    <SettingsCard id="grading" title="Grading">
      {/* Through the saver, which keeps it whatever Model saves are under way. */}
      <ApiKeyRow status={shown.apiKey} onStored={(read) => saver.storeApiKey(read)} />
      <hr />
      <ModelField
        model={effectiveModelId(shown.model)}
        saving={state.saving.includes("model")}
        saved={state.saved.includes("model")}
        failed={state.failures.find((failure) => failure.field === "model")?.attempted}
        stored={effectiveModelId(state.stored.model)}
        onChange={(model) => saver.change({ field: "model", attempted: model })}
        onRetry={() => saver.retry("model")}
      />
    </SettingsCard>
  );
}

/**
 * Numbers a form's submits, so a completion can tell whether the row still
 * holds its attempt: not once it was cancelled (or cancelled and opened again).
 */
function useAttempts() {
  const latest = useRef(0);
  return {
    start: () => ++latest.current,
    isCurrent: (attempt: number) => attempt === latest.current,
    forget: () => {
      latest.current += 1;
    },
  };
}

type Mode = "showing" | "editing" | "removing";

function ApiKeyRow({
  status,
  onStored,
}: {
  status: ApiKeyStatus;
  onStored: (read: SettingsRead) => void;
}) {
  const [mode, setMode] = useState<Mode>("showing");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const attempt = useAttempts();
  // An unreadable key is stored too: it can be changed or removed.
  const set = status.state !== "unset";

  const show = () => {
    attempt.forget();
    setMode("showing");
    setTyped("");
    setError(undefined);
  };
  const open = (next: Mode) => {
    setMode(next);
    setDone(undefined);
    setError(undefined);
  };

  /** Runs a save or a removal, keeping its answer even if the row moved on meanwhile. */
  const run = async (request: () => Promise<ApiKeyOutcome>, confirmation: string) => {
    const mine = attempt.start();
    setBusy(true);
    const outcome = await request();
    setBusy(false);
    if (outcome.ok) onStored(outcome.read);
    if (!attempt.isCurrent(mine)) return;
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    show();
    setDone(confirmation);
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    const problem = apiKeyProblem(typed);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    await run(() => saveApiKey(typed), "API key saved. Grading runs on it from now on.");
  };

  return (
    <>
      <Row
        label="API key"
        value={apiKeyValue(status)}
        // A sentence, not a value: it wraps rather than lose "Enter it again."
        wrap={status.state === "unreadable"}
        action={
          mode === "showing" && (
            <div className="ml-auto flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="lg"
                className={OUTLINE_PILL}
                aria-label={set ? "Change API key" : "Add API key"}
                disabled={busy}
                onClick={() => open("editing")}
              >
                {set ? "Change" : "Add"}
              </Button>
              {set && (
                <Button
                  variant="outline"
                  size="lg"
                  className={OUTLINE_PILL}
                  aria-label="Remove API key"
                  disabled={busy}
                  onClick={() => open("removing")}
                >
                  Remove
                </Button>
              )}
            </div>
          )
        }
      />
      {done !== undefined && <Done>{done}</Done>}
      {mode === "editing" && (
        <form className={FORM} noValidate onSubmit={(event) => void onSave(event)}>
          <Field
            label="OpenRouter API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            autoFocus
            value={typed}
            readOnly={busy}
            hint="Banki checks it with OpenRouter, then stores it encrypted. It never shows it again."
            error={error}
            onChange={(event) => {
              setTyped(event.target.value);
              setError(undefined);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" className={PILL} disabled={busy}>
              {busy ? "Checking…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className={PILL}
              disabled={busy}
              onClick={show}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === "removing" && (
        <div className={FORM}>
          <p className="text-[0.95rem]">Remove the API key? Grading stops until you add one.</p>
          {error !== undefined && <FormError>{error}</FormError>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              className={PILL}
              autoFocus
              disabled={busy}
              onClick={() => void run(removeApiKey, "API key removed.")}
            >
              {busy ? "Removing…" : "Remove"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className={PILL}
              disabled={busy}
              onClick={show}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function ModelField({
  model,
  stored,
  saving,
  saved,
  failed,
  onChange,
  onRetry,
}: {
  /** The Model as shown: a change not answered yet on top of the stored one. */
  model: ModelId;
  stored: ModelId;
  saving: boolean;
  saved: boolean;
  /** The Model a change that didn't save tried to pick. */
  failed: string | undefined;
  onChange: (model: ModelId) => void;
  onRetry: () => void;
}) {
  const label = useId();
  const summary = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span id={label} className="text-sm font-medium">
          Model
        </span>
        <SaveState state={saving ? "saving" : saved ? "saved" : undefined} />
      </div>
      <ModelCombobox value={model} onChange={onChange} labelledBy={label} describedBy={summary} />
      <ModelSummary id={summary} model={modelById(model)} />
      {failed !== undefined && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
        >
          <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
          <p className="min-w-0 flex-1 text-destructive">
            {modelSaveErrorText(modelById(effectiveModelId(failed)), modelById(stored))}
          </p>
          <Button variant="outline" size="lg" className={OUTLINE_PILL} onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
