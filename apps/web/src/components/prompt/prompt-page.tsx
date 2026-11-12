import { buildCardPrompt, cardFileSchemaUrl } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown, Copy } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { CopyButton } from "@/components/imports/parts";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL, SaveState } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { CARD_FILE_SCHEMA_TEXT } from "@/lib/card-prompt";
import type { Deck } from "@/lib/decks";
import { useEffectiveMacros } from "@/lib/macros";
import { cn } from "@/lib/utils";
import {
  CountField,
  DifficultyField,
  InstructionsField,
  LanguageField,
  SaveFailed,
} from "./fields";
import { useCardPromptOptions } from "./use-card-prompt-options";

/**
 * The Card prompt's page (CONTEXT.md: Card prompt): one reading column of
 * four numbered steps on a rail, the way the import page counts its steps
 * (set the options, copy the prompt, paste it into an LLM, import the JSON).
 * The JSON Schema is for API callers, so it waits folded at the foot.
 */
export function PromptPage({ deck }: { deck: Deck }) {
  const library = useLibrary();
  const macros = useEffectiveMacros(deck.macros);
  const options = useCardPromptOptions(deck);
  const schemaUrl = cardFileSchemaUrl(window.location.origin);
  const prompt = useMemo(
    () => buildCardPrompt(options.valid, macros, schemaUrl),
    [options.valid, macros, schemaUrl],
  );
  const promptCopy = useCopied();
  const invalid = Object.keys(options.errors).length > 0;
  const length = prompt.length.toLocaleString("en-GB");

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
          <Step
            number={1}
            title="Set the options"
            aside={<SaveState state={options.status === "failed" ? undefined : options.status} />}
          >
            <div className="flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <LanguageField
                  draft={options.draft}
                  errors={options.errors}
                  onChange={options.change}
                />
                <CountField
                  draft={options.draft}
                  errors={options.errors}
                  onChange={options.change}
                />
              </div>
              <DifficultyField draft={options.draft} onPick={options.pick} />
              <InstructionsField
                draft={options.draft}
                errors={options.errors}
                onChange={options.change}
              />
              {options.status === "failed" && <SaveFailed onRetry={options.retry} />}
            </div>
            {options.status !== "failed" && (
              <p className="text-sm text-muted-foreground">Saved for this deck, on every device.</p>
            )}
          </Step>

          <Step number={2} title="Copy the prompt">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                className={cn(PILL, "h-12 px-7 text-base lg:h-11")}
                disabled={invalid}
                onClick={() => void promptCopy.copy(prompt)}
              >
                {promptCopy.copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {promptCopy.copied ? "Copied" : "Copy prompt"}
              </Button>
              <p
                role="status"
                className={cn(
                  "text-sm",
                  invalid || promptCopy.failed
                    ? "font-medium text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {invalid
                  ? "Fix the options first."
                  : promptCopy.failed
                    ? "Couldn't copy it: select the prompt below and copy it yourself."
                    : promptCopy.copied
                      ? `${length} characters on your clipboard.`
                      : `${length} characters, with the schema and an example.`}
              </p>
            </div>
            <div className="rounded-xl border bg-muted/40">
              <p className="border-b px-4 py-2.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                What you copy
              </p>
              <pre
                tabIndex={0}
                aria-label="The Card prompt"
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
                href={schemaUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 min-w-0 flex-1 items-center font-mono text-xs break-all lg:min-h-0"
              >
                {schemaUrl}
              </a>
              <CopyButton text={CARD_FILE_SCHEMA_TEXT} label="Copy schema" className="w-fit" />
            </div>
            <pre
              tabIndex={0}
              aria-label="The JSON Schema"
              className="max-h-[28rem] overflow-auto rounded-xl border bg-muted/40 p-4 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {CARD_FILE_SCHEMA_TEXT}
            </pre>
          </div>
        </details>
      </div>
    </Page>
  );
}

/**
 * Copies text, and says so for a moment once it is on the clipboard; `failed`
 * when it couldn't be, as without a clipboard (a page served over plain HTTP).
 */
function useCopied() {
  const [state, setState] = useState<"copied" | "failed" | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    copied: state === "copied",
    failed: state === "failed",
    copy: async (text: string) => {
      clearTimeout(timer.current);
      try {
        if (navigator.clipboard === undefined) throw new Error("No clipboard");
        await navigator.clipboard.writeText(text);
      } catch {
        setState("failed");
        return;
      }
      setState("copied");
      timer.current = setTimeout(() => setState(undefined), 1600);
    },
  };
}

/** One numbered step on the rail. */
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
