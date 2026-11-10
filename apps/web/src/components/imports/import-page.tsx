import {
  DELETION_KEPT_MS,
  type ImageProblem,
  type ImportInvalidCard,
  type ImportPreviewResponse,
  type ImportReportResponse,
  type MacroPlanEntry,
  formatProblems,
  formatProblemsWithWarnings,
  macroPlanLine,
} from "@banki/shared";
import { Dialog } from "@base-ui/react/dialog";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCheck,
  Check,
  ImageOff,
  LoaderCircle,
  Lock,
  Pencil,
  Sigma,
  Undo2,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { CardLine, FadingCardText } from "@/components/cards/card-text";
import { DOT, RAIL, TIME_COL } from "@/components/cards/card-timeline";
import { useDiscardGuard } from "@/components/cards/discard-guard";
import { showImportUndoneToast } from "@/components/deleted/toasts";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cardsQueryOptions } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { ImageFilesContext, imageUrl } from "@/lib/images";
import { canUndo, cardCount, confirmImport, undoImport, whenLabel } from "@/lib/imports";
import { cn } from "@/lib/utils";
import { CopyButton, DuplicateLabel, EditFields, confirmedLabel } from "./parts";
import { Steps } from "./steps";
import { UndoDialog } from "./undo";
import { type Row, usePreview } from "./use-preview";

// An Import's page. Unconfirmed, it is the preview, in the deck page's own
// language: the file's Cards hang on a rail in file order, each a bordered
// card with its number in the margin, and the dot on the rail is its tick:
// filled in the accent with a check while ticked, hollow when not, a lock on
// a Duplicate, which hangs dashed and faded. What the file brings besides
// Cards (Macros, image problems) opens the page as "Before you import"; the
// invalid Cards close the rail. Edit opens the card editor's fields in a
// dialog. A paper dock floats at the foot with the count, Tick all and
// Import. Confirmed, it is the report, for good: the Import's own timeline
// of what happened, step by step.

const H2 = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

/** More Cards than this, and rows below the fold skip rendering until scrolled to. */
const MANY = 100;

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

const cardsLabel = (count: number) =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? "card" : "cards"}`;

/** "Copy problems", and beside it "Copy with warnings" when there are warnings too. */
function CopyProblems({
  invalid,
  macros,
  images,
  done = false,
}: {
  invalid: readonly ImportInvalidCard[];
  macros: readonly MacroPlanEntry[];
  images: readonly ImageProblem[];
  done?: boolean;
}) {
  const problems = invalid.flatMap((card) => card.problems);
  const warned = macros.length + images.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {problems.length > 0 && <CopyButton text={formatProblems(problems)} label="Copy problems" />}
      {warned && (
        <CopyButton
          text={formatProblemsWithWarnings(problems, macros, images, done)}
          label={problems.length > 0 ? "Copy with warnings" : "Copy warnings"}
        />
      )}
    </div>
  );
}

export function ImportPreviewPage({
  deck,
  preview,
}: {
  deck: Deck;
  preview: ImportPreviewResponse;
}) {
  const queryClient = useQueryClient();
  const deckCards = useSuspenseQuery(cardsQueryOptions(deck.id)).data ?? [];
  const p = usePreview(preview, deckCards);
  const [editing, setEditing] = useState<number | undefined>();
  const [confirming, setConfirming] = useState(false);
  const guard = useDiscardGuard(
    p.changed && !confirming,
    confirming,
    "Your ticks and edits in this preview haven't been imported.",
  );
  const staged = useMemo(() => new Set(preview.stagedImages), [preview]);
  const files = useMemo(
    () => (file: string) =>
      staged.has(file)
        ? `/api/imports/${encodeURIComponent(preview.id)}/images/${encodeURIComponent(file)}`
        : imageUrl(file),
    [staged, preview.id],
  );
  const imagesOf = useMemo(() => {
    const byCard = new Map<number, ImageProblem[]>();
    for (const image of preview.images) {
      byCard.set(image.card, [...(byCard.get(image.card) ?? []), image]);
    }
    return byCard;
  }, [preview]);

  const confirm = async () => {
    setConfirming(true);
    const outcome = await confirmImport(queryClient, preview.id, deck.id, p.ticked);
    if (!outcome.ok) {
      setConfirming(false);
      toast.error(outcome.message);
    }
    // Done, the cache holds the report, and the page shows it.
  };

  const many = p.rows.length > MANY;
  const editRow = p.rows.find((row) => row.card.number === editing);
  const tickedCount = p.ticked.length;
  return (
    <ImageFilesContext value={files}>
      <Page width="reading">
        <div className="flex flex-col gap-6 lg:gap-8">
          <Head deck={deck} at={1} title={`${cardsLabel(preview.total)} read`}>
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
                    <span className="min-w-0 [overflow-wrap:anywhere]">{macroPlanLine(macro)}</span>
                  </li>
                ))}
                {preview.images.map((image) => (
                  <li key={`${image.card}-${image.reference}`} className="flex gap-2.5">
                    <ImageOff aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <a href={`#card-${image.card}`} className="font-medium">
                        Card {image.card}
                      </a>
                      : {image.reference}: {image.message} It still imports.
                    </span>
                  </li>
                ))}
              </ul>
              {preview.invalid.length === 0 && (
                <CopyProblems invalid={[]} macros={preview.macros} images={preview.images} />
              )}
            </section>
          )}

          <ol className="flex flex-col" aria-label="Cards in the file">
            {p.rows.map((row) => (
              <Entry
                key={row.card.number}
                row={row}
                many={many}
                disabled={confirming}
                images={imagesOf.get(row.card.number)}
                onToggle={() => p.toggle(row.card.number)}
                onEdit={() => setEditing(row.card.number)}
              />
            ))}
            {preview.invalid.length > 0 && (
              <InvalidEntry
                invalid={preview.invalid}
                macros={preview.macros}
                images={preview.images}
              />
            )}
          </ol>

          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mx-auto flex w-full max-w-xl items-center gap-2 rounded-full border bg-card/95 p-1.5 pl-4 shadow-lg backdrop-blur lg:bottom-6">
            <p className="min-w-0 flex-1 truncate text-sm tabular-nums" aria-live="polite">
              <span className="font-semibold">{tickedCount.toLocaleString("en-GB")}</span>{" "}
              <span className="text-muted-foreground">
                of {p.rows.length.toLocaleString("en-GB")} ticked
              </span>
            </p>
            <Button
              variant="ghost"
              className={cn(PILL, "h-11 px-3 lg:h-9")}
              disabled={confirming || p.rows.length === 0}
              onClick={() => p.tickAll(!p.allTicked)}
            >
              <CheckCheck aria-hidden />
              {/* Only the icon on a phone, so the count has room. */}
              <span className="sr-only sm:not-sr-only">
                {p.allTicked ? "Untick all" : "Tick all"}
              </span>
            </Button>
            <Button
              className={cn(PILL, "h-11 lg:h-9")}
              disabled={tickedCount === 0 || confirming}
              onClick={() => void confirm()}
            >
              {confirming && (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              )}
              {confirming ? "Importing…" : `Import ${tickedCount.toLocaleString("en-GB")}`}
            </Button>
          </div>
        </div>

        <Dialog.Root
          open={editRow !== undefined}
          onOpenChange={(open) => !open && setEditing(undefined)}
        >
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] dark:bg-black/50" />
            <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94svh] flex-col gap-5 overflow-y-auto rounded-t-[1.5rem] border bg-card px-4 py-5 pb-[calc(8rem+env(safe-area-inset-bottom))] text-card-foreground shadow-xl sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(46rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:px-6 sm:pb-6">
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
    </ImageFilesContext>
  );
}

function Entry({
  row,
  many,
  disabled,
  images,
  onToggle,
  onEdit,
}: {
  row: Row;
  many: boolean;
  disabled: boolean;
  images: readonly ImageProblem[] | undefined;
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
            role="img"
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
          )}
        >
          <div className="flex items-start gap-2">
            {/* Not ticked, its Front fades to the Back's ink: still readable, never washed out. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <FadingCardText
                text={card.front}
                lines={2}
                className={cn("font-medium", !row.ticked && "text-muted-foreground")}
              />
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
          {(locked || row.edited || images !== undefined || card.tags.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {locked && <DuplicateLabel of={duplicateOf} />}
              {row.edited && <span className="font-medium text-primary">Edited</span>}
              {images?.map((image) => (
                <span key={image.reference} className="flex items-center gap-1">
                  <ImageOff aria-hidden className="size-3" />
                  {image.reference}
                </span>
              ))}
              {!locked && card.tags.length > 0 && (
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {card.tags.map((t) => `#${t}`).join(" ")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function InvalidEntry({
  invalid,
  macros,
  images,
}: {
  invalid: readonly ImportInvalidCard[];
  macros: readonly MacroPlanEntry[];
  images: readonly ImageProblem[];
}) {
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
              card.problems.map((problem, i) => (
                <li key={`${card.number}-${i}`}>{problem.text}</li>
              )),
            )}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <CopyProblems invalid={invalid} macros={macros} images={images} />
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
  open = false,
  struck = false,
}: {
  mark: string;
  accent?: boolean;
  title: ReactNode;
  children?: ReactNode;
  /** The rail's last step, still to come or undone: a hollow dot and a dashed rail. */
  open?: boolean;
  /** A muted, struck title: a step an Undo took back. */
  struck?: boolean;
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
      <div className={cn(RAIL, "flex min-w-0 flex-1 flex-col gap-2 pb-7", open && "border-dashed")}>
        <span
          aria-hidden
          className={cn(
            DOT,
            open ? "border-2 border-input bg-background" : accent ? "bg-primary" : "bg-input",
          )}
        />
        <p
          className={cn(
            "leading-snug",
            accent && "font-semibold",
            struck && "text-muted-foreground line-through decoration-1",
          )}
        >
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}

export function ImportReportPage({ deck, report }: { deck: Deck; report: ImportReportResponse }) {
  const added = report.macros.filter((macro) => macro.outcome === "added");
  const other = report.macros.filter((macro) => macro.outcome !== "added");
  const warned = report.macros.length + report.images.length > 0;
  const lastWarning = report.images.length > 0 ? "images" : "macros";
  // With no invalid Cards, the warnings' own step copies them.
  const copyHere = (step: "images" | "macros") =>
    report.invalid.length === 0 && warned && lastWarning === step ? (
      <CopyProblems invalid={[]} macros={report.macros} images={report.images} done />
    ) : null;
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  // The time the page was opened: what it says stays put while it is open.
  const [now] = useState(() => Date.now());
  const { undoneAt } = report;
  // Removal leaves the Import undone: past its 30 days, the Cards are gone for good.
  const removed = undoneAt !== null && Date.parse(undoneAt) + DELETION_KEPT_MS <= now;
  const undo = async () => {
    setUndoing(true);
    const outcome = await undoImport(queryClient, report.id);
    setUndoing(false);
    setAsking(false);
    if (outcome.ok) showImportUndoneToast(queryClient, outcome);
    else toast.error(outcome.message);
  };
  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Head deck={deck} at={2} title={`${cardsLabel(report.imported)} imported`}>
          <p
            className={cn(
              "text-sm font-medium",
              undoneAt === null ? "text-primary" : "text-muted-foreground",
            )}
          >
            {confirmedLabel(report.confirmedAt)}
            {undoneAt !== null && (
              <span className="text-foreground"> · undone {whenLabel(undoneAt)}</span>
            )}
          </p>
        </Head>
        <ol className="flex flex-col">
          <Step mark={String(report.total)} title={<>Read from {report.fileName}</>} />
          {report.leftOut > 0 && (
            <Step mark={String(report.leftOut)} title="Left out: you unticked them" />
          )}
          {report.duplicates.length > 0 && (
            <Step mark={String(report.duplicates.length)} title="Duplicates skipped">
              <ul className="flex flex-col gap-1 text-sm">
                {report.duplicates.map((dup) => (
                  <li key={dup.number} className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{dup.number}</span>
                    <CardLine text={dup.front} className="min-w-0 font-medium" />
                  </li>
                ))}
              </ul>
            </Step>
          )}
          {report.invalid.length > 0 && (
            <Step mark={String(report.invalid.length)} title="Invalid, not read">
              <ul className="flex flex-col gap-1 font-mono text-[0.78rem] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {report.invalid.flatMap((card) =>
                  card.problems.map((problem, i) => (
                    <li key={`${card.number}-${i}`}>{problem.text}</li>
                  )),
                )}
              </ul>
              <CopyProblems
                invalid={report.invalid}
                macros={report.macros}
                images={report.images}
                done
              />
            </Step>
          )}
          {report.macros.length > 0 && (
            <Step
              mark={String(added.length)}
              title={
                added.length > 0 ? `Macros added: ${added.map((m) => m.name).join(", ")}` : "Macros"
              }
            >
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {other.map((macro) => (
                  <li key={macro.name} className="[overflow-wrap:anywhere]">
                    {macroPlanLine(macro, true)}
                  </li>
                ))}
              </ul>
              {copyHere("macros")}
            </Step>
          )}
          {report.images.length > 0 && (
            <Step
              mark={String(report.images.length)}
              title="Image problems: imported with the reference as written"
            >
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {report.images.map((image) => (
                  <li key={`${image.card}-${image.reference}`} className="[overflow-wrap:anywhere]">
                    Card {image.card}: {image.reference}: {image.message}
                  </li>
                ))}
              </ul>
              {copyHere("images")}
            </Step>
          )}
          <Step
            mark={String(report.imported)}
            accent={undoneAt === null}
            struck={undoneAt !== null}
            title={
              <>
                Added to{" "}
                <Link to="/decks/$deckId" params={{ deckId: deck.id }}>
                  {deck.name}
                </Link>
                {report.imageCount > 0 &&
                  `, with ${report.imageCount} ${report.imageCount === 1 ? "image" : "images"}`}
              </>
            }
          >
            {report.total === report.imported && (
              <p className="text-sm text-muted-foreground">
                Every card in the file. Nothing was skipped.
              </p>
            )}
          </Step>
          {undoneAt !== null ? (
            <Step mark="" accent open title={<>Undone {whenLabel(undoneAt)}</>}>
              <p className="text-sm text-muted-foreground">
                {removed ? (
                  <>Its cards were removed for good from Recently deleted after 30 days.</>
                ) : (
                  <>
                    Its cards wait in{" "}
                    <Link to="/deleted" className="font-medium text-foreground">
                      Recently deleted
                    </Link>{" "}
                    for 30 days. Restore them there, all at once.
                  </>
                )}
              </p>
            </Step>
          ) : (
            canUndo(report) && (
              <Step mark="" open title="Changed your mind?">
                <p className="text-sm text-muted-foreground">
                  Undo takes the {cardCount(report.live)} this import added back out of every deck
                  they are in now, into Recently deleted.
                </p>
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11 w-fit text-foreground")}
                  onClick={() => setAsking(true)}
                >
                  <Undo2 aria-hidden />
                  Undo this import
                </Button>
              </Step>
            )
          )}
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
        <UndoDialog
          open={asking}
          report={report}
          busy={undoing}
          onCancel={() => setAsking(false)}
          onConfirm={() => void undo()}
        />
      </div>
    </Page>
  );
}
