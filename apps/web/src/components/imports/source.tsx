import { type CardFileProblem, formatProblems } from "@banki/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileUp, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { IMPORT_ACCEPT, uploadImport } from "@/lib/imports";
import { cn } from "@/lib/utils";
import { CopyButton } from "./parts";
import { Steps } from "./steps";

// The import page's first step, Source: one box to paste a Card file's JSON
// into or drop a file on, or a file chosen under it. The file goes to the
// API as it is, which reads it into an Import and the preview opens; a
// refused file's problems sit under the box like a field's error, one line
// each, with Copy problems for pasting back to an LLM.

export function ImportSource({ deck }: { deck: Deck }) {
  const library = useLibrary();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [refused, setRefused] = useState<readonly CardFileProblem[] | undefined>();
  /** Whether the refused source was the pasted text, which the fence hint is about. */
  const [refusedPaste, setRefusedPaste] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  /** What is being read: the file's name, or "pasted JSON". */
  const [reading, setReading] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const send = async (source: { kind: "paste"; text: string } | { kind: "file"; file: File }) => {
    setRefused(undefined);
    setFailure(undefined);
    setReading(source.kind === "paste" ? "pasted JSON" : source.file.name);
    const outcome = await uploadImport(deck.id, source);
    if (outcome.ok) {
      await navigate({ to: "/imports/$importId", params: { importId: outcome.id } });
      return;
    }
    setReading(undefined);
    if ("problems" in outcome) {
      setRefused(outcome.problems);
      setRefusedPaste(source.kind === "paste");
    } else {
      setFailure(outcome.message);
    }
  };
  const fenced = refusedPaste && text.trimStart().startsWith("```");

  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Breadcrumb
          library={library}
          at={deck.folderId}
          deck={deck}
          last="Import"
          onMove={() => {}}
        />
        <div className="flex flex-col gap-4">
          <Steps at={0} />
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Import cards
          </h1>
        </div>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void send({ kind: "paste", text });
          }}
          className="flex flex-col gap-4"
        >
          {reading !== undefined ? (
            <div
              role="status"
              className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border bg-card px-6 text-center shadow-xs"
            >
              <LoaderCircle
                aria-hidden
                className="size-7 animate-spin text-primary motion-reduce:animate-none"
              />
              <p className="font-medium [overflow-wrap:anywhere]">Reading {reading}…</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Every card is checked against {deck.name} before you see it.
              </p>
            </div>
          ) : (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped = event.dataTransfer.files[0];
                if (dropped) void send({ kind: "file", file: dropped });
              }}
              className={cn(
                "relative rounded-2xl border bg-card shadow-xs focus-within:border-ring",
                dragging && "border-primary ring-4 ring-primary/15",
                refused !== undefined && "border-destructive",
              )}
            >
              <textarea
                aria-label="Card file"
                aria-invalid={refused !== undefined}
                aria-describedby={refused !== undefined ? "refused" : undefined}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setRefused(undefined);
                  setFailure(undefined);
                }}
                spellCheck={false}
                className="block min-h-72 w-full resize-y rounded-2xl bg-transparent p-4 font-mono text-[0.85rem] leading-relaxed outline-none sm:p-5"
              />
              {text === "" && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                  <FileUp aria-hidden className="size-7 text-muted-foreground" />
                  <p className="font-medium">Paste a Card file&apos;s JSON here</p>
                  <p className="text-sm text-muted-foreground">
                    or drop a .json or .zip on this box
                  </p>
                </div>
              )}
            </div>
          )}

          {/* PROTOTYPE (BAN-35): the way to the Card prompt, under the source box. */}
          <p className="text-sm text-muted-foreground">
            No Card file yet?{" "}
            <Link
              to="/decks/$deckId/prompt"
              params={{ deckId: deck.id }}
              className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4 lg:min-h-0"
            >
              Get one from an LLM
            </Link>
          </p>

          {refused !== undefined && (
            <div id="refused" role="alert" className="flex flex-col gap-2">
              <ul className="flex flex-col gap-1 text-sm font-medium text-destructive [overflow-wrap:anywhere]">
                {refused.map((problem, i) => (
                  <li key={i} className="font-mono text-[0.8rem]">
                    {problem.text}
                  </li>
                ))}
              </ul>
              {fenced && (
                <p className="text-sm text-muted-foreground">
                  The text starts with <code className="font-mono text-foreground">```</code>, a
                  code fence: copy only what&apos;s inside it.
                </p>
              )}
              <CopyButton text={formatProblems(refused)} label="Copy problems" className="w-fit" />
            </div>
          )}
          {failure !== undefined && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {failure}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              <button
                type="button"
                disabled={reading !== undefined}
                onClick={() => picker.current?.click()}
                className="min-h-11 font-medium text-foreground underline underline-offset-4 lg:min-h-0"
              >
                Choose a file
              </button>{" "}
              instead: a .json, or a .zip with its images.
            </p>
            <input
              ref={picker}
              type="file"
              accept={IMPORT_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                // Cleared, so choosing the same file again still sends it.
                event.target.value = "";
                if (chosen) void send({ kind: "file", file: chosen });
              }}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Link
                to="/decks/$deckId"
                params={{ deckId: deck.id }}
                className={cn(
                  OUTLINE_PILL,
                  "inline-flex h-11 items-center justify-center border text-sm font-medium text-foreground no-underline hover:bg-muted lg:h-10",
                )}
              >
                Cancel
              </Link>
              <Button
                type="submit"
                className={cn(PILL, "h-11 lg:h-10")}
                disabled={text.trim() === "" || reading !== undefined}
              >
                Preview
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Page>
  );
}
