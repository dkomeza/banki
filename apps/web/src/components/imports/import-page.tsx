import { Dialog } from "@base-ui/react/dialog";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, CheckCheck, ImageOff, LoaderCircle, Lock, Pencil, Sigma, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { CardLine, FadingCardText } from "@/components/cards/card-text";
import { DOT, RAIL, TIME_COL } from "@/components/cards/card-timeline";
import { useDiscardGuard } from "@/components/cards/discard-guard";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cardsQueryOptions } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import type { ImageProblem, ImportPreview, ImportReport, InvalidCard } from "./fixtures";
import {
  CopyProblems,
  DuplicateLabel,
  EditFields,
  confirmedLabel,
  imageLine,
  macroLine,
  macroReportLine,
} from "./parts";
import { Steps } from "./steps";
import { type Row, usePreview } from "./use-preview";

// Variant c, Timeline: the preview speaks the deck page's language. The
// file's Cards hang on a rail in file order, each a bordered card with its
// number in the margin, and the dot on the rail is its tick: filled in the
// accent with a check while ticked, hollow when not, a lock on a Duplicate,
// which hangs dashed and faded. What the file brings besides Cards (Macros,
// image problems) opens the page as "Before you import"; the invalid Cards
// close the rail, unread. Edit opens the card editor's fields in a dialog. A
// paper dock floats at the foot with the count, Tick all and Import. The
// report is the Import's own timeline: what happened, step by step.

const H2 = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

function Head({
  deck,
  at,
  title,
  children,
}: {
  deck: Deck;
  at: 0 | 1 | 2;
  title: ReactNode;
  children?: ReactNode;
}) {
  const library = useLibrary();
  return (
    <>
      <Breadcrumb
        library={library}
        at={deck.folderId}
        deck={deck}
        last="Import"
        onMove={() => {}}
      />
      <div className="flex flex-col gap-4">
        <Steps at={at} />
        <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
          {title}
        </h1>
        {children}
      </div>
    </>
  );
}

export function ImportPreviewPage({
  deck,
  preview,
  state,
}: {
  deck: Deck;
  preview: ImportPreview;
  state: string | undefined;
}) {
  const navigate = useNavigate();
  const deckCards = useSuspenseQuery(cardsQueryOptions(deck.id)).data ?? [];
  const p = usePreview(preview, deckCards);
  const [editing, setEditing] = useState<number | undefined>(state === "edit" ? 6 : undefined);
  const [confirming, setConfirming] = useState(state === "confirming");
  const guard = useDiscardGuard(p.changed && !confirming);

  useEffect(() => {
    if (!confirming || state === "confirming") return undefined;
    const timer = setTimeout(() => void navigate({ to: ".", search: {} }), 1200);
    return () => clearTimeout(timer);
  }, [confirming, state, navigate]);

  const many = p.rows.length > 100;
  const editRow = p.rows.find((row) => row.card.number === editing);
  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Head deck={deck} at={1} title={`${preview.total.toLocaleString("en-GB")} cards read`}>
          <p className="text-[1.05rem] text-muted-foreground [overflow-wrap:anywhere]">
            From {preview.fileName}, for{" "}
            <span className="font-medium text-foreground">{deck.name}</span>. Untick what you
            don&apos;t want, edit what needs it, then import.
          </p>
        </Head>

        {preview.macros.length + preview.images.length > 0 && (
          <section
            aria-labelledby="before"
            className="flex flex-col gap-3 rounded-2xl border bg-muted/60 p-4 sm:p-5"
          >
            <h2 id="before" className={H2}>
              Before you import
            </h2>
            <ul className="flex flex-col gap-2 text-[0.95rem]">
              {preview.macros.map((macro) => (
                <li key={macro.name} className="flex gap-2.5">
                  <Sigma aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{macroLine(macro)}</span>
                </li>
              ))}
              {preview.images.map((image) => (
                <li key={image.card} className="flex gap-2.5">
                  <ImageOff aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <a href={`#card-${image.card}`} className="font-medium">
                      Card {image.card}
                    </a>
                    : {imageLine(image)} It still imports.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ol className="flex flex-col" aria-label="Cards in the file">
          {p.rows.map((row) => (
            <Entry
              key={row.card.number}
              row={row}
              many={many}
              disabled={confirming}
              image={preview.images.find((image) => image.card === row.card.number)}
              onToggle={() => p.toggle(row.card.number)}
              onEdit={() => setEditing(row.card.number)}
            />
          ))}
          {preview.invalid.length > 0 && <InvalidEntry invalid={preview.invalid} />}
        </ol>

        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mx-auto flex w-full max-w-xl items-center gap-2 rounded-full border bg-card/95 p-1.5 pl-4 shadow-lg backdrop-blur lg:bottom-6">
          <p className="min-w-0 flex-1 truncate text-sm tabular-nums" aria-live="polite">
            <span className="font-semibold">{p.ticked.toLocaleString("en-GB")}</span>{" "}
            <span className="text-muted-foreground">
              of {p.rows.length.toLocaleString("en-GB")} ticked
            </span>
          </p>
          <Button
            variant="ghost"
            className={cn(PILL, "h-11 px-3 lg:h-9")}
            disabled={confirming}
            onClick={() => p.tickAll(!p.allTicked)}
          >
            <CheckCheck aria-hidden />
            {p.allTicked ? "Untick all" : "Tick all"}
          </Button>
          <Button
            className={cn(PILL, "h-11 lg:h-9")}
            disabled={p.ticked === 0 || confirming}
            onClick={() => {
              guard.release();
              setConfirming(true);
            }}
          >
            {confirming && (
              <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
            )}
            {confirming ? "Importing…" : `Import ${p.ticked.toLocaleString("en-GB")}`}
          </Button>
        </div>
      </div>

      <Dialog.Root
        open={editRow !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] dark:bg-black/50" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94svh] flex-col gap-5 overflow-y-auto rounded-t-[1.5rem] border bg-card px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(46rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:px-6 sm:pb-6">
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-2xl font-semibold tracking-tight">
                Edit card {editing}
              </Dialog.Title>
              <Dialog.Close render={<Button variant="ghost" size="icon" aria-label="Close" />}>
                <X aria-hidden />
              </Dialog.Close>
            </div>
            {editRow !== undefined && (
              <EditFields
                card={editRow.card}
                deckCards={deckCards}
                others={p.rows
                  .filter((r) => r.ticked && r.card.number !== editRow.card.number)
                  .map((r) => r.card)}
                onCancel={() => setEditing(undefined)}
                onDone={(edit) => {
                  p.edit(editRow.card.number, edit);
                  setEditing(undefined);
                }}
                foot="Kept in this preview until you import."
                className="pt-8"
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {guard.dialog}
    </Page>
  );
}

function Entry({
  row,
  many,
  disabled,
  image,
  onToggle,
  onEdit,
}: {
  row: Row;
  many: boolean;
  disabled: boolean;
  image: ImageProblem | undefined;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { card, duplicateOf } = row;
  const locked = duplicateOf !== undefined;
  return (
    <li
      id={`card-${card.number}`}
      className={cn(
        "flex scroll-mt-8 gap-3 sm:gap-4",
        many && "[content-visibility:auto] [contain-intrinsic-size:auto_7rem]",
      )}
    >
      <p
        className={cn(
          TIME_COL,
          "pt-3.5 text-right font-mono text-xs text-muted-foreground tabular-nums",
        )}
      >
        {card.number}
      </p>
      <div className={cn(RAIL, "min-w-0 flex-1 pb-3")}>
        {locked ? (
          <span
            aria-label="Duplicate, not imported"
            className="absolute top-3 -left-[0.7rem] flex size-5 items-center justify-center rounded-full bg-muted ring-4 ring-background"
          >
            <Lock aria-hidden className="size-3 text-muted-foreground" />
          </span>
        ) : (
          <button
            type="button"
            role="checkbox"
            aria-checked={row.ticked}
            aria-label={`Import card ${card.number}`}
            disabled={disabled}
            onClick={onToggle}
            // A 44 px target around the 20 px dot.
            className="absolute top-0.5 -left-[1.4rem] flex size-11 items-center justify-center rounded-full lg:top-1.5 lg:-left-[1rem] lg:size-8"
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border-2 ring-4 ring-background",
                row.ticked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background",
              )}
            >
              {row.ticked && <Check aria-hidden className="size-3" strokeWidth={3} />}
            </span>
          </button>
        )}
        <div
          className={cn(
            "flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3 shadow-xs",
            locked && "border-dashed bg-transparent shadow-none",
            !row.ticked && "opacity-60",
          )}
        >
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <FadingCardText text={card.front} lines={2} className="font-medium" />
              <FadingCardText
                text={card.back}
                lines={6}
                className="text-sm text-muted-foreground"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit card ${card.number}`}
              disabled={disabled}
              onClick={onEdit}
              className="-my-1 -mr-2 text-muted-foreground"
            >
              <Pencil aria-hidden />
            </Button>
          </div>
          {(locked || row.edited || image !== undefined || card.tags.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {locked && <DuplicateLabel of={duplicateOf} />}
              {row.edited && <span className="font-medium text-primary">Edited</span>}
              {image !== undefined && (
                <span className="flex items-center gap-1">
                  <ImageOff aria-hidden className="size-3" />
                  {image.file}
                </span>
              )}
              {!locked && card.tags.length > 0 && (
                <span>{card.tags.map((t) => `#${t}`).join(" ")}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function InvalidEntry({ invalid }: { invalid: readonly InvalidCard[] }) {
  return (
    <li className="flex gap-3 sm:gap-4">
      <p className={cn(TIME_COL, "pt-3.5 text-right text-xs text-destructive")}>Not read</p>
      <div className={cn(RAIL, "min-w-0 flex-1 pb-3")}>
        <span aria-hidden className={cn(DOT, "top-4 bg-destructive")} />
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/40 px-4 py-3">
          <p className="font-medium">
            {invalid.length} invalid {invalid.length === 1 ? "card" : "cards"}, not imported
          </p>
          <ul className="flex flex-col gap-2 font-mono text-[0.78rem] leading-relaxed [overflow-wrap:anywhere]">
            {invalid.flatMap((card) =>
              card.problems.map((problem) => <li key={problem.text}>{problem.text}</li>),
            )}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <CopyProblems problems={invalid.flatMap((card) => card.problems)} />
            <span className="text-sm text-muted-foreground">
              Fix them in the file, then import it again.
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

/** One step of the report's timeline. */
function Step({
  mark,
  accent,
  title,
  children,
}: {
  mark: string;
  accent?: boolean;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3 sm:gap-4">
      <p
        className={cn(
          TIME_COL,
          "pt-0.5 text-right text-sm font-semibold tabular-nums",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        {mark}
      </p>
      <div className={cn(RAIL, "flex min-w-0 flex-1 flex-col gap-2 pb-7")}>
        <span aria-hidden className={cn(DOT, accent ? "bg-primary" : "bg-input")} />
        <p className={cn("leading-snug", accent && "font-semibold")}>{title}</p>
        {children}
      </div>
    </li>
  );
}

export function ImportReportPage({ deck, report }: { deck: Deck; report: ImportReport }) {
  const read = report.imported + report.leftOut + report.duplicates.length + report.invalid.length;
  const added = report.macros.filter((macro) => macro.outcome === "added");
  const other = report.macros.filter((macro) => macro.outcome !== "added");
  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Head deck={deck} at={2} title={`${report.imported} cards imported`}>
          <p className="text-sm font-medium text-primary">{confirmedLabel(report.confirmedAt)}</p>
        </Head>
        <ol className="flex flex-col">
          <Step mark={String(read)} title={<>Read from {report.fileName}</>} />
          {report.leftOut > 0 && (
            <Step mark={String(report.leftOut)} title="Left out: you unticked them" />
          )}
          {report.duplicates.length > 0 && (
            <Step mark={String(report.duplicates.length)} title="Duplicates skipped">
              <ul className="flex flex-col gap-1 text-sm">
                {report.duplicates.map((dup) => (
                  <li key={dup.number} className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{dup.number}</span>
                    <CardLine text={dup.front} className="font-medium" />
                  </li>
                ))}
              </ul>
            </Step>
          )}
          {report.invalid.length > 0 && (
            <Step mark={String(report.invalid.length)} title="Invalid, not read">
              <ul className="flex flex-col gap-1 font-mono text-[0.78rem] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {report.invalid.flatMap((card) =>
                  card.problems.map((problem) => <li key={problem.text}>{problem.text}</li>),
                )}
              </ul>
              <CopyProblems
                problems={report.invalid.flatMap((card) => card.problems)}
                className="w-fit"
              />
            </Step>
          )}
          {report.macros.length > 0 && (
            <Step
              mark={String(added.length)}
              title={`Macros added: ${added.map((m) => m.name).join(", ")}`}
            >
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {other.map((macro) => (
                  <li key={macro.name} className="[overflow-wrap:anywhere]">
                    {macroReportLine(macro)}
                  </li>
                ))}
              </ul>
            </Step>
          )}
          {report.images.length > 0 && (
            <Step
              mark={String(report.images.length)}
              title="Image problems: imported with the reference as written"
            >
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {report.images.map((image) => (
                  <li key={image.card} className="[overflow-wrap:anywhere]">
                    Card {image.card}: {imageLine(image)}
                  </li>
                ))}
              </ul>
            </Step>
          )}
          <Step
            mark={String(report.imported)}
            accent
            title={
              <>
                Added to{" "}
                <Link to="/decks/$deckId" params={{ deckId: deck.id }}>
                  {deck.name}
                </Link>
                {report.imageCount > 0 && `, with ${report.imageCount} image`}
              </>
            }
          >
            {read === report.imported && (
              <p className="text-sm text-muted-foreground">
                Every card in the file. Nothing was skipped.
              </p>
            )}
          </Step>
        </ol>
        <div className="flex flex-wrap gap-2 sm:pl-18">
          <Button
            className={cn(PILL, "h-11")}
            render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
            nativeButton={false}
          >
            Open deck
          </Button>
          <Button
            variant="outline"
            className={cn(OUTLINE_PILL, "h-11 text-foreground no-underline")}
            render={<Link to="/decks/$deckId/import" params={{ deckId: deck.id }} />}
            nativeButton={false}
          >
            Import more
          </Button>
        </div>
      </div>
    </Page>
  );
}
