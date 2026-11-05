import { type CardFileProblem, parseCardFile } from "@banki/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileUp, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { ACCEPT, FENCED_PASTE, GOOD_PASTE, PREVIEW, REFUSED_PROBLEMS } from "./fixtures";
import { CopyProblems } from "./parts";
import { Steps } from "./steps";

// Variant c, Timeline: the import is three steps, Source, Preview and Report,
// named over each of its pages. The source is one box: paste the JSON into
// it, or drop a file on it, or choose one under it. A refused source's
// problems sit under the box like a field's error.

export function ImportSource({ deck, state }: { deck: Deck; state: string | undefined }) {
  const library = useLibrary();
  const navigate = useNavigate();
  const [text, setText] = useState(
    state === "paste" ? GOOD_PASTE : state === "refused" ? FENCED_PASTE : "",
  );
  const [refused, setRefused] = useState<readonly CardFileProblem[] | undefined>(
    state === "refused" ? REFUSED_PROBLEMS : undefined,
  );
  const [file, setFile] = useState<string | undefined>(
    state === "uploading" ? PREVIEW.fileName : undefined,
  );
  const [uploading, setUploading] = useState(state === "uploading");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!uploading || state === "uploading") return undefined;
    const timer = setTimeout(
      () =>
        void navigate({
          to: "/imports/$importId",
          params: { importId: PREVIEW.id },
          search: { state: "preview" },
        }),
      1200,
    );
    return () => clearTimeout(timer);
  }, [uploading, state, navigate]);

  const take = (name: string) => {
    setFile(name);
    setRefused(undefined);
    setUploading(true);
  };
  const fenced = text.trimStart().startsWith("```");

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
            const read = parseCardFile(text);
            if ("problems" in read) setRefused(read.problems);
            else take("pasted JSON");
          }}
          className="flex flex-col gap-4"
        >
          {uploading ? (
            <div
              role="status"
              className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border bg-card px-6 text-center shadow-xs"
            >
              <LoaderCircle
                aria-hidden
                className="size-7 animate-spin text-primary motion-reduce:animate-none"
              />
              <p className="font-medium [overflow-wrap:anywhere]">Reading {file}…</p>
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
                if (dropped) take(dropped.name);
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

          {refused !== undefined && (
            <div id="refused" role="alert" className="flex flex-col gap-2">
              <ul className="flex flex-col gap-1 text-sm font-medium text-destructive [overflow-wrap:anywhere]">
                {refused.map((problem) => (
                  <li key={problem.text} className="font-mono text-[0.8rem]">
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
              <CopyProblems problems={refused} className="w-fit" />
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              <button
                type="button"
                disabled={uploading}
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
              accept={ACCEPT}
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) take(chosen.name);
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
                disabled={text.trim() === "" || uploading}
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
