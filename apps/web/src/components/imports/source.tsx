import { type CardFileProblem, parseCardFile } from "@banki/shared";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardPaste, FileArchive, LoaderCircle, TriangleAlert, Upload } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { ACCEPT, FENCED_PASTE, GOOD_PASTE, PREVIEW, REFUSED_PROBLEMS } from "./fixtures";
import { CopyProblems } from "./parts";

// Variant b, Desk: both sources side by side from 768 px, a card each, so
// neither hides behind a switch: a file to drop or choose, and a box to paste
// into, each with its own Preview pill. A refused source's problems show in
// its own card.

export function ImportSource({ deck, state }: { deck: Deck; state: string | undefined }) {
  const library = useLibrary();
  const navigate = useNavigate();
  const [text, setText] = useState(
    state === "paste" ? GOOD_PASTE : state === "refused" ? FENCED_PASTE : "",
  );
  const [refused, setRefused] = useState<readonly CardFileProblem[] | undefined>(
    state === "refused" ? REFUSED_PROBLEMS : undefined,
  );
  const [uploading, setUploading] = useState<"file" | "paste" | undefined>(
    state === "uploading" ? "file" : undefined,
  );
  const [file, setFile] = useState<string | undefined>(
    state === "uploading" ? PREVIEW.fileName : undefined,
  );
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (uploading === undefined || state === "uploading") return undefined;
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

  const choose = (name: string) => {
    setFile(name);
    setUploading("file");
  };
  const fenced = text.trimStart().startsWith("```");

  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Breadcrumb
          library={library}
          at={deck.folderId}
          deck={deck}
          last="Import"
          onMove={() => {}}
        />
        <div className="flex flex-col gap-3">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Import into {deck.name}
          </h1>
          <p className="max-w-prose text-[1.05rem] leading-relaxed text-muted-foreground">
            Bring in Cards from a Card file. Every card is shown first, to tick, untick or edit, and
            nothing is added until you confirm.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 md:items-start lg:gap-6">
          <SourceCard icon={<FileArchive aria-hidden className="size-5" />} title="A file">
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
                if (dropped) choose(dropped.name);
              }}
              className={cn(
                "flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl bg-muted/60 px-5 py-8 text-center",
                dragging && "bg-primary/10 outline-2 outline-primary outline-dashed",
              )}
            >
              {uploading === "file" ? (
                <>
                  <LoaderCircle
                    aria-hidden
                    className="size-8 animate-spin text-primary motion-reduce:animate-none"
                  />
                  <div className="flex flex-col gap-1" role="status">
                    <p className="font-medium [overflow-wrap:anywhere]">Reading {file}…</p>
                    <p className="text-sm text-muted-foreground">
                      Unpacking the zip and checking every card.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Upload aria-hidden className="size-8 text-muted-foreground" />
                  <div className="flex flex-col gap-1">
                    <p className="font-medium">Drop a .json or .zip</p>
                    <p className="text-sm text-muted-foreground">
                      A zip holds one .json, with its images in an images/ folder beside it.
                    </p>
                  </div>
                  <Button
                    type="button"
                    className={cn(PILL, "h-11")}
                    disabled={uploading !== undefined}
                    onClick={() => picker.current?.click()}
                  >
                    Choose file
                  </Button>
                </>
              )}
              <input
                ref={picker}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) choose(chosen.name);
                }}
              />
            </div>
          </SourceCard>

          <SourceCard icon={<ClipboardPaste aria-hidden className="size-5" />} title="Pasted JSON">
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const read = parseCardFile(text);
                if ("problems" in read) setRefused(read.problems);
                else {
                  setRefused(undefined);
                  setUploading("paste");
                }
              }}
            >
              <textarea
                aria-label="Card file JSON"
                value={text}
                readOnly={uploading !== undefined}
                onChange={(event) => {
                  setText(event.target.value);
                  setRefused(undefined);
                }}
                spellCheck={false}
                placeholder="Paste the Card file an LLM wrote for you."
                className={cn(
                  "min-h-64 w-full resize-y rounded-xl border border-input bg-background/60 p-3 font-mono text-[0.8rem] leading-relaxed focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid",
                  refused !== undefined && "border-destructive",
                )}
              />
              {refused !== undefined && (
                <div
                  role="alert"
                  className="flex flex-col gap-2 border-l-2 border-destructive pl-3"
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <TriangleAlert aria-hidden className="size-4" />
                    Refused: nothing was read
                  </p>
                  <ul className="font-mono text-[0.78rem] leading-relaxed [overflow-wrap:anywhere]">
                    {refused.map((problem) => (
                      <li key={problem.text}>{problem.text}</li>
                    ))}
                  </ul>
                  {fenced && (
                    <p className="text-sm text-muted-foreground">
                      Remove the <code className="font-mono text-foreground">```json</code> fence at
                      the start and the <code className="font-mono text-foreground">```</code> at
                      the end.
                    </p>
                  )}
                  <CopyProblems problems={refused} className="mt-1 w-fit" />
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11")}
                  disabled={text.trim() === "" || uploading !== undefined}
                >
                  {uploading === "paste" && (
                    <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                  )}
                  {uploading === "paste" ? "Reading…" : "Preview pasted JSON"}
                </Button>
              </div>
            </form>
          </SourceCard>
        </div>
        <p className="text-sm text-muted-foreground">
          Up to 1,000 cards and 20 MB of JSON; a zip up to 500 MB.
        </p>
      </div>
    </Page>
  );
}

function SourceCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-[1.25rem] border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
