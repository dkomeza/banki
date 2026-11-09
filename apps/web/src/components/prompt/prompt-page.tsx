import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown, Copy } from "lucide-react";
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

// PROTOTYPE (BAN-35), Variant b, "Recipe": one reading column of four
// numbered steps on a rail (set the options, copy the prompt, paste it into
// an LLM, import the JSON), the way the import page counts its steps. The
// JSON Schema is for API callers, so it waits folded at the foot.

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
    <Page width="reading">
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
            Cards from an LLM
          </h1>
          <p className="max-w-prose text-[1.05rem] text-muted-foreground">
            Four steps to a Card file for{" "}
            <span className="font-medium text-foreground">{deck.name}</span>, from any notes, slides
            or chapter you have.
          </p>
        </div>

        <ol className="flex flex-col">
          <Step number={1} title="Set the options" aside={<OptionsSaveState status={o.status} />}>
            <div className="flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <LanguageField options={o.options} errors={o.errors} onChange={o.change} />
                <CountField options={o.options} errors={o.errors} onChange={o.change} />
              </div>
              <DifficultyField options={o.options} onChange={o.change} hints />
              <InstructionsField options={o.options} errors={o.errors} onChange={o.change} />
              <SaveFailed status={o.status} onRetry={o.retry} />
            </div>
            <p className="text-sm text-muted-foreground">Saved for this deck, on every device.</p>
          </Step>

          <Step number={2} title="Copy the prompt">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                className={cn(PILL, "h-12 px-7 text-base lg:h-11")}
                disabled={invalid}
                onClick={() => promptCopy.copy(prompt)}
              >
                {promptCopy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {promptCopy.copied ? "Copied" : "Copy prompt"}
              </Button>
              <p
                role="status"
                className={cn(
                  "text-sm",
                  invalid ? "font-medium text-destructive" : "text-muted-foreground",
                )}
              >
                {invalid
                  ? "Fix the options first."
                  : promptCopy.copied
                    ? `${prompt.length.toLocaleString("en-GB")} characters on your clipboard.`
                    : `${prompt.length.toLocaleString("en-GB")} characters, with the schema and an example.`}
              </p>
            </div>
            <div className="rounded-xl border bg-muted/40">
              <p className="border-b px-4 py-2.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                What you copy
              </p>
              <pre
                tabIndex={0}
                className={cn(
                  "max-h-[26rem] overflow-auto px-4 py-3 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]",
                  invalid && "opacity-50",
                )}
              >
                {prompt}
              </pre>
            </div>
          </Step>

          <Step number={3} title="Paste it into an LLM">
            <p className="max-w-prose text-[0.95rem] text-muted-foreground">
              Start a new chat in any LLM, paste the prompt, then paste or attach your material
              after it. It answers with one <code className="font-mono text-foreground">json</code>{" "}
              code block: copy it with the block&apos;s own copy button.
            </p>
          </Step>

          <Step number={4} title="Import the JSON" last>
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 w-fit text-foreground no-underline")}
              render={<Link to="/decks/$deckId/import" params={{ deckId: deck.id }} />}
              nativeButton={false}
            >
              Import the JSON
              <ArrowRight aria-hidden />
            </Button>
          </Step>
        </ol>

        <details className="group rounded-[1.25rem] border border-dashed p-5 sm:p-6">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span className="flex flex-col">
              <span className="text-lg font-semibold tracking-tight">The JSON Schema</span>
              <span className="text-sm text-muted-foreground">
                For calling an LLM&apos;s API with structured outputs
              </span>
            </span>
            <ChevronDown
              aria-hidden
              className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-mono text-xs"
              >
                {url}
              </a>
              <Button
                variant="outline"
                className={cn(OUTLINE_PILL, "h-11 w-fit")}
                onClick={() => schemaCopy.copy(SCHEMA_TEXT)}
              >
                {schemaCopy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {schemaCopy.copied ? "Copied" : "Copy schema"}
              </Button>
            </div>
            <pre
              tabIndex={0}
              className="max-h-[28rem] overflow-auto rounded-xl border bg-muted/40 p-4 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {SCHEMA_TEXT}
            </pre>
          </div>
        </details>
      </div>
    </Page>
  );
}

function Step({
  number,
  title,
  aside,
  last = false,
  children,
}: {
  number: number;
  title: string;
  aside?: ReactNode;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 sm:gap-5">
      {!last && (
        <span aria-hidden className="absolute top-10 bottom-1 left-[1.1rem] w-px bg-border" />
      )}
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background text-sm font-semibold text-primary tabular-nums">
        {number}
      </span>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-4 pt-1", !last && "pb-10")}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {aside}
        </div>
        {children}
      </div>
    </li>
  );
}
