import { CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH } from "@banki/shared";
import { CircleAlert } from "lucide-react";
import { useId } from "react";
import { FIELD, OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type CardPromptDraft, type CardPromptErrors, DIFFICULTIES } from "@/lib/card-prompt";
import { cn } from "@/lib/utils";

// The Card prompt's four option fields, and what a failed save says.

type FieldProps = {
  draft: CardPromptDraft;
  errors: CardPromptErrors;
  onChange: (patch: Partial<CardPromptDraft>) => void;
};

/** An error under a field, if it has one. */
function Problem({ id, error }: { id: string; error: string | undefined }) {
  if (error === undefined) return null;
  return (
    <p id={id} className="text-sm font-medium text-destructive">
      {error}
    </p>
  );
}

export function LanguageField({ draft, errors, onChange }: FieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Card language
      </label>
      <OptionInput
        id={id}
        value={draft.language}
        placeholder="The material's language"
        error={errors.language}
        onChange={(language) => onChange({ language })}
      />
    </div>
  );
}

export function CountField({ draft, errors, onChange }: FieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Number of cards
      </label>
      <OptionInput
        id={id}
        value={draft.count}
        placeholder="As many as it needs"
        numeric
        error={errors.count}
        onChange={(count) => onChange({ count })}
      />
    </div>
  );
}

/** A one-line option, with its problem under it. */
function OptionInput({
  id,
  value,
  placeholder,
  numeric = false,
  error,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  numeric?: boolean;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        inputMode={numeric ? "numeric" : undefined}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-problem`}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD, numeric && "tabular-nums")}
      />
      <Problem id={`${id}-problem`} error={error} />
    </>
  );
}

/** The three difficulties as a segmented row of pills, with what the one picked asks for under it. */
export function DifficultyField({
  draft,
  onPick,
}: {
  draft: CardPromptDraft;
  onPick: (patch: Partial<CardPromptDraft>) => void;
}) {
  const label = useId();
  const current = DIFFICULTIES.find((d) => d.value === draft.difficulty);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={label} className="text-sm font-medium">
        Difficulty
      </span>
      <div
        role="radiogroup"
        aria-labelledby={label}
        className="grid grid-cols-3 rounded-full border bg-background p-1 dark:bg-input/20"
      >
        {DIFFICULTIES.map((d) => (
          <button
            key={d.value}
            type="button"
            role="radio"
            aria-checked={draft.difficulty === d.value}
            onClick={() => onPick({ difficulty: d.value })}
            className="h-11 min-w-0 truncate rounded-full px-2 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-checked:bg-foreground aria-checked:text-background motion-reduce:transition-none lg:h-9"
          >
            {d.label}
          </button>
        ))}
      </div>
      {current !== undefined && <p className="text-sm text-muted-foreground">{current.hint}</p>}
    </div>
  );
}

export function InstructionsField({ draft, errors, onChange }: FieldProps) {
  const id = useId();
  const length = draft.instructions.length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          Extra instructions
        </label>
        <span
          className={cn(
            "text-xs tabular-nums",
            length > CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH
              ? "font-medium text-destructive"
              : "text-muted-foreground",
          )}
        >
          {length.toLocaleString("en-GB")} /{" "}
          {CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-GB")}
        </span>
      </div>
      <textarea
        id={id}
        rows={4}
        value={draft.instructions}
        placeholder="Anything else the LLM should know: what to focus on, what to skip, how to phrase things."
        aria-invalid={errors.instructions === undefined ? undefined : true}
        aria-describedby={errors.instructions === undefined ? undefined : `${id}-problem`}
        onChange={(event) => onChange({ instructions: event.target.value })}
        className="w-full resize-y rounded-xl border border-input bg-background px-4 py-3 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 lg:text-[0.95rem] dark:bg-input/20"
      />
      <Problem id={`${id}-problem`} error={errors.instructions} />
    </div>
  );
}

/** A failed save, with Try again. */
export function SaveFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
    >
      <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
      <p className="min-w-0 flex-1 text-destructive">
        Couldn&apos;t save these options. The prompt below uses them anyway.
      </p>
      <Button variant="outline" size="lg" className={OUTLINE_PILL} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
