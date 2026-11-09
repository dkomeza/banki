import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Copy } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  DIFFICULTIES,
  type PromptOptions,
  SCHEMA_TEXT,
  buildPrompt,
  hasErrors,
  schemaUrl,
  useCopy,
  usePromptOptions,
} from "@/lib/card-prompt-proto";
import type { Deck } from "@/lib/decks";
import { NO_MACROS } from "@/lib/formula";
import { useEffectiveMacros } from "@/lib/macros";
import { cn } from "@/lib/utils";
import {
  CountField,
  InstructionsField,
  LanguageField,
  OptionsSaveState,
  SaveFailed,
} from "./fields";

// PROTOTYPE (BAN-35), Variant c, "Workbench": a wide page with the options
// in a panel on the left, sticky from 1024 px, and one tall viewer on the
// right that switches between the prompt and the JSON Schema, its Copy in
// the viewer's own bar. On phones the panel comes first.

type Tab = "prompt" | "schema";

export function PromptPage({ deck, state }: { deck: Deck; state: string | undefined }) {
  const library = useLibrary();
  const effective = useEffectiveMacros(deck.macros);
  const macros = state === "no-macros" ? NO_MACROS : effective;
  const o = usePromptOptions(state);
  const url = schemaUrl();
  const prompt = useMemo(() => buildPrompt(o.valid, macros, url), [o.valid, macros, url]);
  const promptCopy = useCopy(state === "copied");
  const schemaCopy = useCopy(false);
  const invalid = hasErrors(o.errors);
  const [tab, setTab] = useState<Tab>("prompt");
  const copy = tab === "prompt" ? promptCopy : schemaCopy;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <div className="flex flex-col gap-6 lg:gap-8">
        <div className="flex flex-col gap-4">
          <Breadcrumb
            library={library}
            at={deck.folderId}
            deck={deck}
            last="Card prompt"
            onMove={() => {}}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
              Card prompt
            </h1>
            <Link
              to="/decks/$deckId/import"
              params={{ deckId: deck.id }}
              className="inline-flex h-11 items-center gap-2 font-medium lg:h-auto"
            >
              Import the JSON
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-8">
          <section
            aria-labelledby="options-title"
            className="flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6 lg:sticky lg:top-8"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="options-title" className="text-xl font-semibold tracking-tight">
                Options
              </h2>
              <OptionsSaveState status={o.status} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
              <LanguageField options={o.options} errors={o.errors} onChange={o.change} />
              <CountField options={o.options} errors={o.errors} onChange={o.change} />
            </div>
            <DifficultyList options={o.options} onChange={o.change} />
            <InstructionsField options={o.options} errors={o.errors} onChange={o.change} rows={5} />
            <SaveFailed status={o.status} onRetry={o.retry} />
          </section>

          <section
            aria-label="Prompt and schema"
            className="flex min-w-0 flex-col overflow-hidden rounded-[1.25rem] border bg-card text-card-foreground"
          >
            <div className="flex flex-wrap items-center gap-3 border-b p-3 sm:p-4">
              <div
                role="tablist"
                aria-label="Show"
                className="flex rounded-full border bg-background p-1 dark:bg-input/20"
              >
                {(["prompt", "schema"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className="h-10 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-selected:bg-foreground aria-selected:text-background motion-reduce:transition-none lg:h-8"
                  >
                    {t === "prompt" ? "Prompt" : "JSON Schema"}
                  </button>
                ))}
              </div>
              <div className="ml-auto">
                {tab === "prompt" ? (
                  <Button
                    className={cn(PILL, "h-11")}
                    disabled={invalid}
                    onClick={() => promptCopy.copy(prompt)}
                  >
                    {copy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copy.copied ? "Copied" : "Copy prompt"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className={cn(OUTLINE_PILL, "h-11")}
                    onClick={() => schemaCopy.copy(SCHEMA_TEXT)}
                  >
                    {copy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copy.copied ? "Copied" : "Copy schema"}
                  </Button>
                )}
              </div>
            </div>
            <div
              className={cn(
                "border-b px-4 py-2.5 text-sm sm:px-5",
                tab === "prompt" && promptCopy.copied ? "bg-accent" : "bg-muted/40",
              )}
            >
              {tab === "prompt" ? (
                invalid ? (
                  <p className="font-medium text-destructive">
                    Fix the options and the prompt follows them.
                  </p>
                ) : promptCopy.copied ? (
                  <p role="status" className="flex items-center gap-2">
                    <Check aria-hidden className="size-4 shrink-0 text-primary" />
                    Copied. Paste it into an LLM, with your material after it.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {prompt.length.toLocaleString("en-GB")} characters · paste your material after
                    it
                  </p>
                )
              ) : (
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-muted-foreground">
                  <span>For structured outputs, at</span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 font-mono text-xs [overflow-wrap:anywhere] text-foreground"
                  >
                    {url}
                  </a>
                </p>
              )}
            </div>
            <pre
              role="tabpanel"
              tabIndex={0}
              className={cn(
                "max-h-[32rem] overflow-auto px-4 py-4 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] sm:px-5 lg:h-[calc(100svh-12rem)] lg:max-h-none",
                tab === "prompt" && invalid && "opacity-50",
              )}
            >
              {tab === "prompt" ? prompt : SCHEMA_TEXT}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The three levels as a list of choices, each with what it asks for. */
function DifficultyList({
  options,
  onChange,
}: {
  options: PromptOptions;
  onChange: (patch: Partial<PromptOptions>) => void;
}) {
  const label = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={label} className="text-sm font-medium">
        Difficulty
      </span>
      <div role="radiogroup" aria-labelledby={label} className="flex flex-col gap-1.5">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.value}
            type="button"
            role="radio"
            aria-checked={options.difficulty === d.value}
            onClick={() => onChange({ difficulty: d.value })}
            className="group flex min-h-11 items-center gap-3 rounded-xl border bg-background px-3.5 py-2 text-left outline-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-checked:border-primary aria-checked:bg-accent dark:bg-input/20"
          >
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-input group-aria-checked:border-primary">
              <span className="size-2 rounded-full bg-primary opacity-0 group-aria-checked:opacity-100" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{d.label}</span>
              <span className="text-xs text-muted-foreground">{d.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
