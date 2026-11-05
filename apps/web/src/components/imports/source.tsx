import { parseCardFile } from "@banki/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileJson, FileUp, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { CardFileProblem } from "@banki/shared";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { ACCEPT, FENCED_PASTE, GOOD_PASTE, PREVIEW, REFUSED_PROBLEMS } from "./fixtures";
import { CopyProblems } from "./parts";

// Variant a, Ledger: the source is one card with a File / Paste switch at its
// top, a drop zone or a text box under it, and one primary Preview pill. A
// refused file's problems take the card's foot, in mono, one line each.

type Mode = "file" | "paste";

export function ImportSource({ deck, state }: { deck: Deck; state: string | undefined }) {
  const library = useLibrary();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(
    state === "paste" || state === "refused" ? "paste" : "file",
  );
  const [text, setText] = useState(
    state === "paste" ? GOOD_PASTE : state === "refused" ? FENCED_PASTE : "",
  );
  const [file, setFile] = useState<{ name: string; size: number } | undefined>(
    state === "uploading" ? { name: PREVIEW.fileName, size: 3_240_000 } : undefined,
  );
  const [refused, setRefused] = useState<readonly CardFileProblem[] | undefined>(
    state === "refused" ? REFUSED_PROBLEMS : undefined,
  );
  const [uploading, setUploading] = useState(state === "uploading");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // Prototype: an upload takes a moment, then opens the mixed preview.
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

  const submit = () => {
    if (mode === "paste") {
      const read = parseCardFile(text);
      if ("problems" in read) {
        setRefused(read.problems);
        return;
      }
    }
    setRefused(undefined);
    setUploading(true);
  };
  const fenced = mode === "paste" && text.trimStart().startsWith("```");
  const ready = mode === "file" ? file !== undefined : text.trim() !== "";

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
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Into {deck.name}</p>
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Import cards
          </h1>
          <p className="max-w-prose text-[1.05rem] leading-relaxed text-muted-foreground">
            From a Card file: a <code className="font-mono text-[0.95em]">.json</code>, a{" "}
            <code className="font-mono text-[0.95em]">.zip</code> with its images, or JSON pasted
            from an LLM. You'll see every card before anything is added.
          </p>
        </div>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-5 rounded-2xl border bg-card p-4 shadow-xs sm:p-6"
        >
          <div
            role="tablist"
            aria-label="Source"
            className="flex w-fit rounded-full border bg-muted p-1"
          >
            {(["file", "paste"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                disabled={uploading}
                onClick={() => {
                  setMode(m);
                  setRefused(undefined);
                }}
                className={cn(
                  "h-11 rounded-full px-4 text-sm font-medium text-muted-foreground lg:h-8",
                  mode === m && "bg-background text-foreground shadow-xs",
                )}
              >
                {m === "file" ? "File" : "Paste JSON"}
              </button>
            ))}
          </div>

          {mode === "file" ? (
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
                if (dropped) setFile({ name: dropped.name, size: dropped.size });
              }}
              className={cn(
                "flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-input px-4 py-8 text-center",
                dragging && "border-primary bg-primary/5",
              )}
            >
              {file === undefined ? (
                <>
                  <FileUp aria-hidden className="size-8 text-muted-foreground" />
                  <p className="font-medium">Drop a .json or .zip here</p>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(OUTLINE_PILL, "h-11")}
                    onClick={() => picker.current?.click()}
                  >
                    Choose file
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Up to 1,000 cards. A zip holds one .json and an images/ folder beside it.
                  </p>
                </>
              ) : (
                <div className="flex w-full max-w-sm flex-col items-center gap-3">
                  <FileJson aria-hidden className="size-8 text-primary" />
                  <p className="max-w-full truncate font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {(file.size / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}{" "}
                    MB
                  </p>
                  {uploading ? (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full w-2/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => picker.current?.click()}
                      className="min-h-11 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground lg:min-h-0"
                    >
                      Choose another file
                    </button>
                  )}
                </div>
              )}
              <input
                ref={picker}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) setFile({ name: chosen.name, size: chosen.size });
                }}
              />
            </div>
          ) : (
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Card file JSON
              </span>
              <textarea
                value={text}
                readOnly={uploading}
                onChange={(event) => {
                  setText(event.target.value);
                  setRefused(undefined);
                }}
                spellCheck={false}
                placeholder='{ "format": "banki-cards", "version": 1, "macros": [], "cards": [ … ] }'
                className={cn(
                  "min-h-64 w-full resize-y rounded-xl border border-input bg-background/60 p-3 font-mono text-[0.85rem] leading-relaxed focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid",
                  refused !== undefined && "border-destructive",
                )}
              />
            </label>
          )}

          {refused !== undefined && (
            <div role="alert" className="flex flex-col gap-3 rounded-xl bg-destructive/8 p-4">
              <p className="flex items-center gap-2 font-medium text-destructive">
                <TriangleAlert aria-hidden className="size-4" />
                This can't be imported
              </p>
              <ul className="flex flex-col gap-1 font-mono text-[0.8rem] leading-relaxed [overflow-wrap:anywhere]">
                {refused.map((problem) => (
                  <li key={problem.text}>{problem.text}</li>
                ))}
              </ul>
              {fenced && (
                <p className="text-sm">
                  It starts with <code className="font-mono">```</code>: paste only the JSON,
                  without the code fence around it.
                </p>
              )}
              <CopyProblems problems={refused} className="w-fit" />
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
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
              disabled={!ready || uploading}
            >
              {uploading && (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              )}
              {uploading ? "Reading the file…" : "Preview import"}
            </Button>
          </div>
        </form>
      </div>
    </Page>
  );
}
