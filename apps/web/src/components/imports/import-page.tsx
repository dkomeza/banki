import { Dialog } from "@base-ui/react/dialog";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ImageOff, LoaderCircle, Lock, Pencil, Sigma, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CardLine, CardText } from "@/components/cards/card-text";
import { useDiscardGuard } from "@/components/cards/discard-guard";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type Card, cardsQueryOptions } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import type { ImageProblem, ImportPreview, ImportReport, InvalidCard, MacroPlan } from "./fixtures";
import {
  CopyProblems,
  DuplicateLabel,
  EditFields,
  confirmedLabel,
  imageLine,
  macroLine,
  macroReportLine,
} from "./parts";
import { type Preview, type Row, usePreview } from "./use-preview";

// Variant b, Desk: the preview is a desk of two panes from 1024 px. On the
// left, the file's Cards as a compact numbered list, narrowed by the filter
// chips over it (all, ticked, left out, Duplicates, invalid, warnings); on the
// right, stuck in view, the Card picked in full, with its tick and Edit, which
// turns the pane into the editor. Below 1024 px the list is alone, and a Card
// opens in a sheet. Confirm sits in the bar over the list, stuck to the top.
// The report is a receipt: the figures down one column, what was skipped in
// the other.

const H2 = "text-xl font-semibold tracking-tight";
const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

type Filter = "all" | "ticked" | "out" | "duplicates" | "invalid" | "warnings";

const WIDE = "(min-width: 1024px)";
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
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
  const library = useLibrary();
  const navigate = useNavigate();
  const wide = useWide();
  const deckCards = useSuspenseQuery(cardsQueryOptions(deck.id)).data ?? [];
  const p = usePreview(preview, deckCards);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<number>(
    state === "edit" ? 6 : (preview.cards[0]?.number ?? 1),
  );
  const [sheet, setSheet] = useState(state === "edit");
  const [editing, setEditing] = useState(state === "edit");
  const [confirming, setConfirming] = useState(state === "confirming");
  const guard = useDiscardGuard(p.changed && !confirming);

  useEffect(() => {
    if (!confirming || state === "confirming") return undefined;
    const timer = setTimeout(() => void navigate({ to: ".", search: {} }), 1200);
    return () => clearTimeout(timer);
  }, [confirming, state, navigate]);

  const warnings = preview.macros.length + preview.images.length;
  const shown = p.rows.filter((row) =>
    filter === "ticked"
      ? row.ticked
      : filter === "out"
        ? !row.ticked && row.duplicateOf === undefined
        : filter === "duplicates"
          ? row.duplicateOf !== undefined
          : true,
  );
  const counts: [Filter, string, number][] = [
    ["all", "All", p.rows.length],
    ["ticked", "Ticked", p.ticked],
    ["out", "Left out", p.rows.length - p.ticked - p.duplicates],
    ["duplicates", "Duplicates", p.duplicates],
    ["invalid", "Invalid", preview.invalid.length],
    ["warnings", "Warnings", warnings],
  ];
  const pickedRow = p.rows.find((row) => row.card.number === picked);
  const open = (number: number) => {
    setPicked(number);
    setEditing(false);
    if (!wide) setSheet(true);
  };
  const detail =
    pickedRow === undefined ? null : (
      <Detail
        key={pickedRow.card.number}
        row={pickedRow}
        preview={p}
        deckCards={deckCards}
        images={preview.images}
        editing={editing}
        disabled={confirming}
        onEdit={setEditing}
      />
    );

  return (
    <Page width="cards">
      <div className="flex flex-col gap-5 lg:gap-6">
        <Breadcrumb
          library={library}
          at={deck.folderId}
          deck={deck}
          last="Import"
          onMove={() => {}}
        />
        <div className="flex flex-col gap-1">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Preview
          </h1>
          <p className="text-[1.05rem] text-muted-foreground [overflow-wrap:anywhere]">
            {preview.fileName} into <span className="font-medium text-foreground">{deck.name}</span>
          </p>
        </div>

        <div className="sticky top-0 z-10 -mx-5 flex flex-col gap-3 border-b bg-background/95 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
          <div className="flex items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium lg:min-h-0">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={p.allTicked}
                disabled={confirming}
                onChange={(event) => p.tickAll(event.target.checked)}
              />
              All
            </label>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground tabular-nums">
              <span className="font-medium text-foreground">
                {p.ticked.toLocaleString("en-GB")}
              </span>{" "}
              of {preview.total.toLocaleString("en-GB")} to import
            </p>
            <Button
              className={cn(PILL, "h-11 lg:h-10")}
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
          <div role="tablist" aria-label="Show" className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
            {counts.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium text-muted-foreground lg:h-8",
                  filter === key && "border-foreground bg-foreground text-background",
                  count === 0 && filter !== key && "opacity-60",
                )}
              >
                {label}
                <span className="tabular-nums">{count.toLocaleString("en-GB")}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-w-0">
            {filter === "invalid" ? (
              <InvalidList invalid={preview.invalid} />
            ) : filter === "warnings" ? (
              <WarningList
                macros={preview.macros}
                images={preview.images}
                line={macroLine}
                onCard={(number) => {
                  setFilter("all");
                  open(number);
                }}
              />
            ) : (
              <ol className="flex flex-col overflow-hidden rounded-2xl border bg-card">
                {shown.map((row) => (
                  <ListRow
                    key={row.card.number}
                    row={row}
                    many={p.rows.length > 100}
                    picked={wide && row.card.number === picked}
                    disabled={confirming}
                    onToggle={() => p.toggle(row.card.number)}
                    onOpen={() => open(row.card.number)}
                  />
                ))}
                {shown.length === 0 && (
                  <li className="p-6 text-center text-sm text-muted-foreground">No cards here.</li>
                )}
              </ol>
            )}
          </div>
          {wide && (
            <div className="sticky top-32 self-start rounded-2xl border bg-card p-5 sm:p-6">
              {detail}
            </div>
          )}
        </div>
      </div>

      {!wide && (
        <Dialog.Root open={sheet} onOpenChange={setSheet}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] dark:bg-black/50" />
            <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-4 overflow-y-auto rounded-t-[1.5rem] border bg-card p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl sm:p-6">
              <div className="flex items-center justify-between">
                <Dialog.Title className="text-sm font-medium text-muted-foreground">
                  Card {picked} of {preview.total}
                </Dialog.Title>
                <Dialog.Close render={<Button variant="ghost" size="icon" aria-label="Close" />}>
                  <X aria-hidden />
                </Dialog.Close>
              </div>
              {detail}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {guard.dialog}
    </Page>
  );
}

function ListRow({
  row,
  many,
  picked,
  disabled,
  onToggle,
  onOpen,
}: {
  row: Row;
  many: boolean;
  picked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { card, duplicateOf } = row;
  const locked = duplicateOf !== undefined;
  return (
    <li
      className={cn(
        "flex items-center border-b last:border-b-0",
        many && "[content-visibility:auto] [contain-intrinsic-size:auto_3rem]",
        picked && "bg-primary/8 shadow-[inset_3px_0_0_var(--primary)]",
      )}
    >
      <label className="flex size-11 shrink-0 items-center justify-center lg:size-10">
        {locked ? (
          <Lock aria-label="Duplicate" className="size-3.5 text-muted-foreground" />
        ) : (
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={row.ticked}
            disabled={disabled}
            onChange={onToggle}
            aria-label={`Import card ${card.number}`}
          />
        )}
      </label>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pr-3 text-left lg:min-h-10"
      >
        <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {card.number}
        </span>
        <span className={cn("flex min-w-0 flex-1 flex-col", !row.ticked && "opacity-55")}>
          <CardLine text={card.front} className="font-medium" />
          {locked && (
            <span className="truncate text-xs text-muted-foreground">
              {"deck" in duplicateOf ? "Already in this deck" : `Repeats card ${duplicateOf.file}`}
            </span>
          )}
        </span>
        {row.edited && <Pencil aria-label="Edited" className="size-3.5 shrink-0 text-primary" />}
        {row.imageProblem && (
          <ImageOff
            aria-label="Image problem"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
      </button>
    </li>
  );
}

function Detail({
  row,
  preview,
  deckCards,
  images,
  editing,
  disabled,
  onEdit,
}: {
  row: Row;
  preview: Preview;
  deckCards: readonly Card[];
  images: readonly ImageProblem[];
  editing: boolean;
  disabled: boolean;
  onEdit: (on: boolean) => void;
}) {
  const { card, duplicateOf } = row;
  const image = images.find((i) => i.card === card.number);
  if (editing) {
    return (
      <div className="flex flex-col gap-5">
        <p className={LABEL}>Editing card {card.number}</p>
        <EditFields
          card={card}
          deckCards={deckCards}
          others={preview.rows
            .filter((r) => r.ticked && r.card.number !== card.number)
            .map((r) => r.card)}
          onCancel={() => onEdit(false)}
          onDone={(edit) => {
            preview.edit(card.number, edit);
            onEdit(false);
          }}
        />
      </div>
    );
  }
  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground">#{card.number}</span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            duplicateOf !== undefined
              ? "bg-muted text-muted-foreground"
              : row.ticked
                ? "bg-primary/12 text-primary"
                : "bg-muted text-muted-foreground",
          )}
        >
          {duplicateOf !== undefined
            ? "Duplicate · locked"
            : row.ticked
              ? "Will import"
              : "Left out"}
        </span>
        {row.edited && <span className="text-xs font-medium text-primary">Edited</span>}
        <span className="flex-1" />
        {duplicateOf === undefined && (
          <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={row.ticked}
              disabled={disabled}
              onChange={() => preview.toggle(card.number)}
            />
            Import
          </label>
        )}
        <Button
          variant="outline"
          className={cn(OUTLINE_PILL, "h-11 lg:h-8 lg:px-3")}
          disabled={disabled}
          onClick={() => onEdit(true)}
        >
          <Pencil aria-hidden />
          Edit
        </Button>
      </div>
      {duplicateOf !== undefined && (
        <div className="flex flex-col gap-1 rounded-xl bg-muted px-4 py-3 text-sm">
          <DuplicateLabel of={duplicateOf} />
          <span className="text-muted-foreground">Reword its Front to import it anyway.</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className={LABEL}>Front</p>
        <CardText text={card.front} className="text-xl font-semibold tracking-tight" />
      </div>
      <div className="flex flex-col gap-1.5 border-t pt-4">
        <p className={LABEL}>Back</p>
        <CardText text={card.back} className="text-[1.05rem]" />
      </div>
      {card.gradingNotes !== null && (
        <div className="flex flex-col gap-1.5 border-t pt-4">
          <p className={LABEL}>Grading notes</p>
          <CardText text={card.gradingNotes} className="text-[0.95rem] text-muted-foreground" />
        </div>
      )}
      {card.tags.length > 0 && (
        <p className="text-sm text-muted-foreground">{card.tags.map((t) => `#${t}`).join(" ")}</p>
      )}
      {image !== undefined && (
        <p className="flex gap-2 rounded-xl border border-dashed px-4 py-3 text-sm">
          <ImageOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="[overflow-wrap:anywhere]">
            {imageLine(image)} The card imports with its reference as written.
          </span>
        </p>
      )}
    </article>
  );
}

function InvalidList({ invalid }: { invalid: readonly InvalidCard[] }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Not imported. Fix them in the file, then import it again.
        </p>
        <CopyProblems problems={invalid.flatMap((card) => card.problems)} />
      </div>
      <ul className="flex flex-col gap-3">
        {invalid.map((card) => (
          <li key={card.number} className="flex flex-col gap-1 border-t pt-3">
            <span className="text-sm font-medium">Card {card.number}</span>
            <ul className="font-mono text-[0.78rem] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {card.problems.map((problem) => (
                <li key={problem.text}>{problem.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WarningList({
  macros,
  images,
  line,
  onCard,
}: {
  macros: readonly MacroPlan[];
  images: readonly ImageProblem[];
  line: (macro: MacroPlan) => string;
  onCard?: (number: number) => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      {macros.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className={LABEL}>Macros</p>
          <ul className="flex flex-col gap-2 text-[0.95rem]">
            {macros.map((macro) => (
              <li key={macro.name} className="flex gap-2.5">
                <Sigma aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{line(macro)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {images.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className={LABEL}>Images</p>
          <ul className="flex flex-col gap-2 text-[0.95rem]">
            {images.map((image) => (
              <li key={image.card} className="flex gap-2.5">
                <ImageOff aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {onCard === undefined ? (
                    <span className="font-medium">Card {image.card}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onCard(image.card)}
                      className="min-h-11 font-medium underline underline-offset-4 lg:min-h-0"
                    >
                      Card {image.card}
                    </button>
                  )}
                  : {imageLine(image)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ImportReportPage({ deck, report }: { deck: Deck; report: ImportReport }) {
  const library = useLibrary();
  const rows: [string, number][] = [
    ["Left out", report.leftOut],
    ["Duplicates skipped", report.duplicates.length],
    ["Invalid", report.invalid.length],
    ["Warnings", report.macros.length + report.images.length],
  ];
  const clean = rows.every(([, value]) => value === 0);
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
        <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
          Import report
        </h1>
        <div
          className={cn(
            "grid items-start gap-6",
            !clean && "md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]",
          )}
        >
          <section
            aria-label="Summary"
            className={cn(
              "flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 sm:p-6",
              clean && "max-w-md",
            )}
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">{confirmedLabel(report.confirmedAt)}</p>
              <p className="text-6xl font-semibold tracking-tight text-primary tabular-nums">
                {report.imported}
              </p>
              <p className="font-medium">
                cards imported into{" "}
                <Link to="/decks/$deckId" params={{ deckId: deck.id }}>
                  {deck.name}
                </Link>
              </p>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                from {report.fileName}
                {report.imageCount > 0 && `, with ${report.imageCount} image`}
              </p>
            </div>
            {clean ? (
              <p className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium">
                <Check aria-hidden className="size-4 text-primary" />
                Nothing skipped, nothing to warn of.
              </p>
            ) : (
              <dl className="flex flex-col border-t border-dashed pt-3 text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-2 py-1.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <span
                      aria-hidden
                      className="flex-1 border-b border-dotted border-muted-foreground/40"
                    />
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row md:flex-col lg:flex-row">
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
          </section>

          {!clean && (
            <div className="flex min-w-0 flex-col gap-6">
              {report.duplicates.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h2 className={H2}>Duplicates skipped</h2>
                  <ul className="flex flex-col overflow-hidden rounded-2xl border bg-card">
                    {report.duplicates.map((dup) => (
                      <li
                        key={dup.number}
                        className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                      >
                        <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground">
                          {dup.number}
                        </span>
                        <CardLine text={dup.front} className="font-medium" />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {report.invalid.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h2 className={H2}>Invalid cards</h2>
                  <InvalidList invalid={report.invalid} />
                </section>
              )}
              {report.macros.length + report.images.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h2 className={H2}>Warnings</h2>
                  <WarningList
                    macros={report.macros}
                    images={report.images}
                    line={macroReportLine}
                  />
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
