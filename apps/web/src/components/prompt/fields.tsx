import { CircleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { FIELD, OUTLINE_PILL, SaveState } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DIFFICULTIES,
  INSTRUCTIONS_MAX,
  type OptionErrors,
  type PromptOptions,
  type SaveStatus,
} from "@/lib/card-prompt-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-35): the Card prompt's four option fields and its save
// state, which each Variant lays out its own way.

function Note({ id, error, hint }: { id: string; error?: string | undefined; hint?: ReactNode }) {
  const note = error ?? hint;
  if (note === undefined) return null;
  return (
    <p
      id={id}
      className={cn(
        "text-sm",
        error === undefined ? "text-muted-foreground" : "font-medium text-destructive",
      )}
    >
      {note}
    </p>
  );
}

export function LanguageField({
  options,
  errors,
  onChange,
  className,
}: {
  options: PromptOptions;
  errors: OptionErrors;
  onChange: (patch: Partial<PromptOptions>) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        Card language
      </label>
      <Input
        id={id}
        value={options.language}
        placeholder="The material's language"
        aria-invalid={errors.language === undefined ? undefined : true}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange({ language: event.target.value })}
        className={FIELD}
      />
      <Note id={`${id}-note`} error={errors.language} />
    </div>
  );
}

export function CountField({
  options,
  errors,
  onChange,
  className,
}: {
  options: PromptOptions;
  errors: OptionErrors;
  onChange: (patch: Partial<PromptOptions>) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        Number of cards
      </label>
      <Input
        id={id}
        inputMode="numeric"
        value={options.count}
        placeholder="As many as it needs"
        aria-invalid={errors.count === undefined ? undefined : true}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange({ count: event.target.value })}
        className={cn(FIELD, "tabular-nums")}
      />
      <Note id={`${id}-note`} error={errors.count} />
    </div>
  );
}

/** Three levels as a segmented row of pills, each with its hint under it when `hints`. */
export function DifficultyField({
  options,
  onChange,
  hints = false,
  className,
}: {
  options: PromptOptions;
  onChange: (patch: Partial<PromptOptions>) => void;
  hints?: boolean;
  className?: string;
}) {
  const label = useId();
  const current = DIFFICULTIES.find((d) => d.value === options.difficulty);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
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
            aria-checked={options.difficulty === d.value}
            onClick={() => onChange({ difficulty: d.value })}
            className="h-10 min-w-0 truncate rounded-full px-2 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-checked:bg-foreground aria-checked:text-background motion-reduce:transition-none lg:h-9"
          >
            {d.label}
          </button>
        ))}
      </div>
      {hints && current !== undefined && (
        <p className="text-sm text-muted-foreground">{current.hint}.</p>
      )}
    </div>
  );
}

export function InstructionsField({
  options,
  errors,
  onChange,
  rows = 4,
  className,
}: {
  options: PromptOptions;
  errors: OptionErrors;
  onChange: (patch: Partial<PromptOptions>) => void;
  rows?: number;
  className?: string;
}) {
  const id = useId();
  const length = options.instructions.length;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          Extra instructions
        </label>
        <span
          className={cn(
            "text-xs tabular-nums",
            length > INSTRUCTIONS_MAX ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {length.toLocaleString("en-GB")} / 2,000
        </span>
      </div>
      <textarea
        id={id}
        rows={rows}
        value={options.instructions}
        placeholder="Anything else the LLM should know: what to focus on, what to skip, how to phrase things."
        aria-invalid={errors.instructions === undefined ? undefined : true}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange({ instructions: event.target.value })}
        className="w-full resize-y rounded-xl border border-input bg-background px-4 py-3 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 lg:text-[0.95rem] dark:bg-input/20"
      />
      <Note id={`${id}-note`} error={errors.instructions} />
    </div>
  );
}

/** "Saving" / "Saved" beside the options. */
export function OptionsSaveState({ status }: { status: SaveStatus }) {
  return <SaveState state={status === "failed" ? undefined : status} />;
}

/** A failed save, with Try again. */
export function SaveFailed({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status !== "failed") return null;
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
