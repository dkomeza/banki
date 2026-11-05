import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ImageOff, LoaderCircle, Lock, Pencil, Sigma, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { CardLine, CardText } from "@/components/cards/card-text";
import { useDiscardGuard } from "@/components/cards/discard-guard";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cardsQueryOptions } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import type { ImportPreview, ImportReport, InvalidCard } from "./fixtures";
import {
  CopyProblems,
  DuplicateLabel,
  EditFields,
  confirmedLabel,
  imageLine,
  macroLine,
  macroReportLine,
} from "./parts";
import { type Row, usePreview } from "./use-preview";

// Variant a, Ledger: the preview is one column, a checklist. A summary line
// and the warnings open it; then every Card is one numbered row, its Front and
// Back on one line each, ticked in its margin, opening in place to edit;
// Duplicates sit in the list, locked; invalid Cards are listed apart under it.
// Confirm rides in a bar stuck to the foot of the screen. The report is the
// same page, settled: a headline count, the figures, and what was skipped.

const KICKER = "text-sm font-medium text-primary";
const TITLE = "text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl";
const H2 = "text-xl font-semibold tracking-tight";

function Header({
  deck,
  crumb,
  kicker,
  title,
  children,
}: {
  deck: Deck;
  crumb: string;
  kicker: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  const library = useLibrary();
  return (
    <>
      <Breadcrumb library={library} at={deck.folderId} deck={deck} last={crumb} onMove={() => {}} />
      <div className="flex flex-col gap-2">
        <p className={KICKER}>{kicker}</p>
        <h1 className={TITLE}>{title}</h1>
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

  const warnings = preview.macros.length + preview.images.length;
  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Header
          deck={deck}
          crumb="Import"
          kicker={`Preview · ${preview.fileName}`}
          title={`Import into ${deck.name}`}
        >
          <p className="text-sm text-muted-foreground tabular-nums">
            {preview.total.toLocaleString("en-GB")} cards in the file ·{" "}
            {p.ticked.toLocaleString("en-GB")} ticked · {p.duplicates} duplicates ·{" "}
            {preview.invalid.length} invalid
            {preview.imageCount > 0 && ` · ${preview.imageCount} images`}
          </p>
        </Header>

        {warnings > 0 && (
          <section
            aria-labelledby="warnings"
            className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-6"
          >
            <h2 id="warnings" className={cn(H2, "flex items-center gap-2")}>
              <TriangleAlert aria-hidden className="size-5 text-primary" />
              {warnings} warnings
            </h2>
            <ul className="flex flex-col divide-y text-[0.95rem]">
              {preview.macros.map((macro) => (
                <li key={macro.name} className="flex gap-3 py-2">
                  <Sigma aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{macroLine(macro)}</span>
                </li>
              ))}
              {preview.images.map((image) => (
                <li key={image.card} className="flex gap-3 py-2">
                  <ImageOff aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-medium">Card {image.card}</span> · {imageLine(image)} It
                    imports with its reference as written.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="cards" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cards" className={H2}>
              Cards to import
            </h2>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium lg:min-h-0">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={p.allTicked}
                onChange={(event) => p.tickAll(event.target.checked)}
                disabled={confirming}
              />
              Tick all
            </label>
          </div>
          <ol className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {p.rows.map((row) => (
              <LedgerRow
                key={row.card.number}
                many={p.rows.length > 100}
                row={row}
                editing={editing === row.card.number}
                disabled={confirming}
                onToggle={() => p.toggle(row.card.number)}
                onEdit={() => setEditing(row.card.number)}
              >
                {editing === row.card.number && (
                  <EditFields
                    card={row.card}
                    deckCards={deckCards}
                    others={p.rows
                      .filter((r) => r.ticked && r.card.number !== row.card.number)
                      .map((r) => r.card)}
                    onCancel={() => setEditing(undefined)}
                    onDone={(edit) => {
                      p.edit(row.card.number, edit);
                      setEditing(undefined);
                    }}
                    className="rounded-xl border bg-background px-4 py-5 sm:px-5"
                  />
                )}
              </LedgerRow>
            ))}
          </ol>
        </section>

        {preview.invalid.length > 0 && (
          <InvalidList
            invalid={preview.invalid}
            intro="They can't be fixed here: fix the file and import it again."
          />
        )}
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-5 -mt-2 border-t bg-background/95 backdrop-blur sm:-mx-8 lg:bottom-0 lg:-mx-10">
          <div className="flex items-center gap-3 px-5 py-3 sm:px-8 lg:px-10">
            <p
              className="min-w-0 flex-1 text-sm text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {p.ticked === 0
                ? "Tick a card to import it."
                : p.changed
                  ? "Your ticks and edits are kept until you confirm."
                  : `${p.rows.length - p.ticked - p.duplicates} left out, ${p.duplicates} duplicates and ${preview.invalid.length} invalid won't be imported.`}
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
              {confirming
                ? `Adding ${p.ticked.toLocaleString("en-GB")} cards…`
                : `Import ${p.ticked.toLocaleString("en-GB")} cards`}
            </Button>
          </div>
        </div>
      </div>
      {guard.dialog}
    </Page>
  );
}

function LedgerRow({
  row,
  many,
  editing,
  disabled,
  onToggle,
  onEdit,
  children,
}: {
  row: Row;
  many: boolean;
  editing: boolean;
  disabled: boolean;
  onToggle: () => void;
  onEdit: () => void;
  children: ReactNode;
}) {
  const { card, duplicateOf } = row;
  const locked = duplicateOf !== undefined;
  return (
    <li
      className={cn(
        "flex flex-col gap-3 px-3 py-2.5 sm:px-4",
        many && "[content-visibility:auto] [contain-intrinsic-size:auto_4.5rem]",
        locked && "bg-muted/50",
        editing && "bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3">
        <label className="flex size-11 shrink-0 items-center justify-center lg:size-8">
          {locked ? (
            <Lock aria-label="Duplicate, not imported" className="size-4 text-muted-foreground" />
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
        <span className="w-8 shrink-0 pt-3 text-right font-mono text-xs text-muted-foreground tabular-nums lg:pt-2">
          {card.number}
        </span>
        <div
          className={cn(
            "grid min-w-0 flex-1 gap-x-6 gap-y-0.5 py-1.5 sm:grid-cols-2 lg:py-1",
            !row.ticked && !locked && "opacity-55",
          )}
        >
          <CardLine text={card.front} className="font-medium" />
          <CardLine text={card.back} className="text-muted-foreground" />
          {(locked || row.edited || row.imageProblem || card.tags.length > 0) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground sm:col-span-2">
              {locked && <DuplicateLabel of={duplicateOf} className="text-xs" />}
              {row.edited && <span className="font-medium text-primary">Edited</span>}
              {row.imageProblem && (
                <span className="flex items-center gap-1">
                  <ImageOff aria-hidden className="size-3" /> Image problem
                </span>
              )}
              {!locked && card.tags.length > 0 && (
                <span>{card.tags.map((t) => `#${t}`).join(" ")}</span>
              )}
            </p>
          )}
        </div>
        {editing ? (
          <span aria-hidden className="size-11 shrink-0 lg:size-8" />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Edit card ${card.number}`}
            disabled={disabled}
            onClick={onEdit}
            className="text-muted-foreground"
          >
            <Pencil aria-hidden />
          </Button>
        )}
      </div>
      {children}
    </li>
  );
}

function InvalidList({ invalid, intro }: { invalid: readonly InvalidCard[]; intro: string }) {
  return (
    <section
      aria-labelledby="invalid"
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="invalid" className={H2}>
            {invalid.length} invalid {invalid.length === 1 ? "card" : "cards"}
          </h2>
          <p className="text-sm text-muted-foreground">{intro}</p>
        </div>
        <CopyProblems problems={invalid.flatMap((card) => card.problems)} />
      </div>
      <ul className="flex flex-col divide-y">
        {invalid.map((card) => (
          <li key={card.number} className="flex gap-3 py-2.5">
            <span className="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
              {card.number}
            </span>
            <ul className="flex min-w-0 flex-col gap-0.5 font-mono text-[0.8rem] leading-relaxed [overflow-wrap:anywhere]">
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

export function ImportReportPage({ deck, report }: { deck: Deck; report: ImportReport }) {
  const clean =
    report.leftOut === 0 &&
    report.duplicates.length === 0 &&
    report.invalid.length === 0 &&
    report.macros.length === 0 &&
    report.images.length === 0;
  const figures: [string, number][] = [
    ["Imported", report.imported],
    ["Left out", report.leftOut],
    ["Duplicates", report.duplicates.length],
    ["Invalid", report.invalid.length],
  ];
  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Header
          deck={deck}
          crumb="Import"
          kicker={`Imported ${confirmedLabel(report.confirmedAt)}`}
          title={`${report.imported} cards imported`}
        >
          <p className="text-[1.05rem] text-muted-foreground">
            Into{" "}
            <Link
              to="/decks/$deckId"
              params={{ deckId: deck.id }}
              className="font-medium text-foreground"
            >
              {deck.name}
            </Link>
            , from {report.fileName}
            {report.imageCount > 0 && `, with ${report.imageCount} image`}.
          </p>
        </Header>

        <div className="flex flex-wrap gap-2">
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

        {clean ? (
          <p className="flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-3 font-medium">
            <Check aria-hidden className="size-4 text-primary" />
            Every card in the file was imported. Nothing was skipped.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 divide-x overflow-hidden rounded-2xl border bg-card sm:grid-cols-4">
              {figures.map(([label, value], i) => (
                <div
                  key={label}
                  className={cn(
                    "flex flex-col gap-1 p-4 sm:p-5",
                    i >= 2 && "border-t sm:border-t-0",
                  )}
                >
                  <dt className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {label}
                  </dt>
                  <dd
                    className={cn("text-3xl font-semibold tabular-nums", i === 0 && "text-primary")}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {report.duplicates.length > 0 && (
              <section
                aria-labelledby="dups"
                className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-6"
              >
                <h2 id="dups" className={H2}>
                  Duplicates skipped
                </h2>
                <ul className="flex flex-col divide-y">
                  {report.duplicates.map((dup) => (
                    <li key={dup.number} className="flex items-baseline gap-3 py-2">
                      <span className="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground">
                        {dup.number}
                      </span>
                      <CardText text={dup.front} className="min-w-0 font-medium" />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {report.invalid.length > 0 && (
              <InvalidList
                invalid={report.invalid}
                intro="Fix them in the file and import it again."
              />
            )}

            {report.macros.length + report.images.length > 0 && (
              <section
                aria-labelledby="warnings"
                className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-6"
              >
                <h2 id="warnings" className={H2}>
                  Warnings
                </h2>
                <ul className="flex flex-col divide-y text-[0.95rem]">
                  {report.macros.map((macro) => (
                    <li key={macro.name} className="flex gap-3 py-2">
                      <Sigma aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {macroReportLine(macro)}
                      </span>
                    </li>
                  ))}
                  {report.images.map((image) => (
                    <li key={image.card} className="flex gap-3 py-2">
                      <ImageOff
                        aria-hidden
                        className="mt-1 size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="font-medium">Card {image.card}</span> · {imageLine(image)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
