import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Copy, Link2 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
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
  DifficultyField,
  InstructionsField,
  LanguageField,
  OptionsSaveState,
  SaveFailed,
} from "./fields";

// PROTOTYPE (BAN-35), Variant a, "Side by side": the options in one card
// across the top, then the prompt and the schema as two documents side by
// side from 1024 px, each with its own Copy, stacked on phones.

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

  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        <div className="flex flex-col gap-4">
          <Breadcrumb
            library={library}
            at={deck.folderId}
            deck={deck}
            last="Card prompt"
            onMove={() => {}}
          />
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Card prompt
          </h1>
          <p className="max-w-prose text-[1.05rem] text-muted-foreground">
            Copy it into any LLM and paste your notes after it. It writes a Card file for{" "}
            <span className="font-medium text-foreground">{deck.name}</span>, which you then{" "}
            <Link
              to="/decks/$deckId/import"
              params={{ deckId: deck.id }}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Import the JSON
            </Link>
            .
          </p>
        </div>

        <section
          aria-labelledby="options-title"
          className="flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="options-title" className="text-xl font-semibold tracking-tight">
              Options
            </h2>
            <OptionsSaveState status={o.status} />
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
            <LanguageField options={o.options} errors={o.errors} onChange={o.change} />
            <CountField options={o.options} errors={o.errors} onChange={o.change} />
            <DifficultyField
              options={o.options}
              onChange={o.change}
              hints
              className="md:col-span-2 lg:col-span-1"
            />
            <InstructionsField
              options={o.options}
              errors={o.errors}
              onChange={o.change}
              rows={3}
              className="md:col-span-2 lg:col-span-3"
            />
          </div>
          <SaveFailed status={o.status} onRetry={o.retry} />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Document
            title="Prompt"
            meta={`${prompt.length.toLocaleString("en-GB")} characters`}
            text={prompt}
            dimmed={invalid}
            note={invalid ? "Fix the options above and the prompt follows them." : undefined}
            action={
              <Button
                className={cn(PILL, "h-11")}
                disabled={invalid}
                onClick={() => promptCopy.copy(prompt)}
              >
                {promptCopy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {promptCopy.copied ? "Copied" : "Copy prompt"}
              </Button>
            }
            done={
              promptCopy.copied ? (
                <p role="status" className="flex items-center gap-2 text-sm">
                  <Check aria-hidden className="size-4 shrink-0 text-primary" />
                  <span>
                    Paste it into an LLM with your material, then{" "}
                    <Link
                      to="/decks/$deckId/import"
                      params={{ deckId: deck.id }}
                      className="font-medium underline underline-offset-4"
                    >
                      import the JSON
                    </Link>
                    .
                  </span>
                </p>
              ) : undefined
            }
          />
          <Document
            title="JSON Schema"
            meta={
              <span className="flex min-w-0 items-center gap-1.5">
                <Link2 aria-hidden className="size-3.5 shrink-0" />
                <a
                  href={url}
                  className="truncate font-mono text-xs"
                  target="_blank"
                  rel="noreferrer"
                >
                  {url}
                </a>
              </span>
            }
            text={SCHEMA_TEXT}
            action={
              <Button
                variant="outline"
                className={cn(OUTLINE_PILL, "h-11")}
                onClick={() => schemaCopy.copy(SCHEMA_TEXT)}
              >
                {schemaCopy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {schemaCopy.copied ? "Copied" : "Copy schema"}
              </Button>
            }
            foot="For calling an LLM's API with structured outputs. The prompt holds it too."
          />
        </div>

        <Link
          to="/decks/$deckId/import"
          params={{ deckId: deck.id }}
          className="inline-flex h-11 items-center gap-2 self-start font-medium"
        >
          Import the JSON
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </Page>
  );
}

function Document({
  title,
  meta,
  text,
  action,
  done,
  note,
  foot,
  dimmed = false,
}: {
  title: string;
  meta: ReactNode;
  text: string;
  action: ReactNode;
  done?: ReactNode;
  note?: string | undefined;
  foot?: string;
  dimmed?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-4 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <div className="min-w-0 text-sm text-muted-foreground">{meta}</div>
        </div>
        {action}
      </div>
      {done}
      {note !== undefined && <p className="text-sm font-medium text-destructive">{note}</p>}
      <pre
        tabIndex={0}
        className={cn(
          "max-h-[28rem] overflow-auto rounded-xl border bg-muted/50 p-4 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] lg:max-h-[40rem]",
          dimmed && "opacity-50",
        )}
      >
        {text}
      </pre>
      {foot !== undefined && <p className="text-sm text-muted-foreground">{foot}</p>}
    </section>
  );
}
