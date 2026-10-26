// PROTOTYPE (BAN-12), Variant i, "Journal": a Deck is written over days, so
// its Cards read as a journal. The deck page's Cards hang on a timeline,
// grouped under the day they were written ("Today", "Yesterday", "Tue 20
// Oct"), each with its time in the margin, the Front in ink and the Back under
// it, Delete in its ⋯ menu; the newest Card's dot is the accent. New card is
// the timeline's first entry. New and edit are a dated page: the two sides
// written on ruled lines with their labels in the margin, and on new, the
// Cards written this visit gathering under the form as a small timeline.
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Plus, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { TileMenu } from "@/components/tile-menu";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { useCardForm } from "./card-form";
import {
  type Card,
  type SideErrors,
  UNSAVED,
  createCard,
  sideErrors,
  updateCard,
  useProtoState,
} from "./cards";
import { CardCrumbs } from "./crumbs";
import { useDiscardGuard } from "./discard";
import { deleteWithUndo } from "./toaster";

const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** "Today", "Yesterday", "Tue 20 Oct": the day a Card was written. */
function dayLabel(at: number): string {
  const days = Math.round((midnight(Date.now()) - midnight(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(at).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The Cards in runs of one day each, newest first. */
function byDay(cards: readonly Card[]): { day: string; cards: Card[] }[] {
  const days: { day: string; cards: Card[] }[] = [];
  for (const card of cards) {
    const day = dayLabel(card.createdAt);
    const last = days.at(-1);
    if (last?.day === day) last.cards.push(card);
    else days.push({ day, cards: [card] });
  }
  return days;
}

// The timeline's geometry: the time column, then the rail with its dots.
const TIME_COL = "w-12 shrink-0 sm:w-14";
const RAIL = "relative border-l border-border pl-6 sm:pl-8";
const DOT = "absolute top-[0.55rem] -left-[0.3rem] size-2.5 rounded-full ring-4 ring-background";

/** One Card on the timeline. */
function Entry({ card, newest }: { card: Card; newest: boolean }) {
  return (
    <li className="group/tile relative flex gap-3 sm:gap-4">
      <p className={cn(TIME_COL, "pt-1 text-right text-sm text-muted-foreground tabular-nums")}>
        {time(card.createdAt)}
      </p>
      <div className={cn(RAIL, "min-w-0 flex-1 pb-7")}>
        <span aria-hidden className={cn(DOT, newest ? "bg-primary" : "bg-input")} />
        <Link
          to="/cards/$cardId"
          params={{ cardId: card.id }}
          aria-label={`Edit card: ${card.front}`}
          className="-mx-3 -my-1.5 flex flex-col gap-1 rounded-xl px-3 py-1.5 pr-12 no-underline outline-none hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <p className="text-[1.1rem] leading-snug font-semibold tracking-tight whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
            {card.front}
          </p>
          <p className="line-clamp-6 leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {card.back}
          </p>
        </Link>
        <TileMenu
          label="Card actions"
          className="absolute -top-1.5 right-0"
          actions={[
            {
              label: "Delete",
              icon: <Trash2 aria-hidden />,
              danger: true,
              onClick: () => deleteWithUndo(card),
            },
          ]}
        />
      </div>
    </li>
  );
}

/** The timeline's first entry: New card, on today. */
function NewEntry({ deckId, empty }: { deckId: string; empty: boolean }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <span aria-hidden className={TIME_COL} />
      <div className={cn(RAIL, "flex-1 pb-8", empty && "border-dashed")}>
        <span
          aria-hidden
          className="absolute top-2.5 -left-[0.7rem] flex size-[1.35rem] items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background"
        >
          <Plus className="size-3.5" strokeWidth={2.75} />
        </span>
        <Link
          to="/decks/$deckId/cards/new"
          params={{ deckId }}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed border-input px-5 text-sm font-medium text-foreground no-underline hover:border-solid hover:border-primary hover:bg-accent lg:h-10"
        >
          New card
        </Link>
        {empty && (
          <div className="flex flex-col gap-1 pt-6">
            <p className="text-lg font-medium">Nothing written yet</p>
            <p className="max-w-xs text-sm text-balance text-muted-foreground">
              Each Card you write goes on this line under the day you wrote it, newest at the top.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The Deck's Cards on a timeline by day, newest first; or the empty state. */
export function CardsSection({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-6 border-t pt-6 lg:pt-8">
      <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
        Cards{" "}
        {cards.length > 0 && (
          <span className="font-normal text-muted-foreground tabular-nums">{cards.length}</span>
        )}
      </h2>
      <div className="max-w-3xl">
        <NewEntry deckId={deckId} empty={cards.length === 0} />
        {byDay(cards).map(({ day, cards: ofDay }, i) => (
          <section key={day} aria-label={day}>
            <div className="flex gap-3 sm:gap-4">
              <span aria-hidden className={TIME_COL} />
              <h3
                className={cn(
                  RAIL,
                  "pb-4 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase",
                )}
              >
                {day}
              </h3>
            </div>
            <ol>
              {ofDay.map((card, j) => (
                <Entry key={card.id} card={card} newest={i === 0 && j === 0} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One side on ruled lines, its label in the margin from 640 px. */
function Side({
  label,
  value,
  error,
  rows,
  inputRef,
  autoFocus,
  onChange,
  onKeyDown,
}: {
  label: string;
  value: string;
  error: string | undefined;
  rows: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const id = useId();
  const front = label === "Front";
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
      <label
        htmlFor={id}
        className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-2.5 sm:text-right"
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <textarea
          id={id}
          ref={inputRef}
          rows={rows}
          value={value}
          autoFocus={autoFocus}
          spellCheck
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={front ? "What to be asked" : "What to recall"}
          // Ruled lines, one per line of text, so it writes like a page.
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0, transparent calc(2rem - 1px), var(--border) calc(2rem - 1px), var(--border) 2rem)",
            backgroundAttachment: "local",
          }}
          className={cn(
            "field-sizing-content w-full resize-none rounded-md bg-transparent px-1 py-0 leading-[2rem] outline-none placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-4 aria-invalid:outline-destructive aria-invalid:outline-solid",
            front ? "min-h-16 text-xl font-semibold tracking-tight" : "min-h-32 text-[1.05rem]",
          )}
        />
        {error !== undefined && (
          <p id={`${id}-error`} className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** A dated writing page: crumbs, the day as an overline, the title, the form. */
function JournalPage({
  deck,
  last,
  dateline,
  form,
  save,
  autoFocus = false,
  foot,
  after,
}: {
  deck: Deck;
  last: string;
  dateline: ReactNode;
  form: ReturnType<typeof useCardForm>;
  save: () => void;
  autoFocus?: boolean;
  foot: ReactNode;
  after?: ReactNode;
}) {
  const library = useLibrary();
  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <CardCrumbs library={library} deck={deck} last={last} />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">{dateline}</p>
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            {last}
          </h1>
        </div>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="flex flex-col gap-7 border-t pt-7"
        >
          <Side
            label="Front"
            rows={2}
            value={form.front}
            error={form.errors.front}
            inputRef={form.frontRef}
            autoFocus={autoFocus}
            onChange={form.setFront}
            onKeyDown={form.onKeyDown(save)}
          />
          <Side
            label="Back"
            rows={5}
            value={form.back}
            error={form.errors.back}
            onChange={form.setBack}
            onKeyDown={form.onKeyDown(save)}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:pl-22">{foot}</div>
        </form>
        {after}
      </div>
    </Page>
  );
}

const BLANK = { front: "", back: "" };
const today = () =>
  new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** The sample Card the `added` state shows as written this visit. */
const ADDED_SAMPLE = { front: "el mercado", back: "the market", at: Date.now() };

export function NewCardScreen({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const state = useProtoState();
  const form = useCardForm(
    state === "discard" ? UNSAVED : BLANK,
    BLANK,
    state === "invalid" ? sideErrors("", "") : {},
  );
  const [written, setWritten] = useState<{ front: string; back: string; at: number }[]>(
    state === "added" ? [ADDED_SAMPLE] : [],
  );
  const [added, setAdded] = useState(state === "added");
  const toDeck = () => navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });
  const guard = useDiscardGuard(form.dirty, state === "discard", () => void toDeck());

  const save = () => {
    const outcome = createCard(deck.id, form.front, form.back);
    if ("id" in outcome) {
      setWritten((w) => [
        { front: outcome.front, back: outcome.back, at: outcome.createdAt },
        ...w,
      ]);
      form.markSaved(BLANK);
      setAdded(true);
      form.frontRef.current?.focus();
    } else {
      form.setErrors(outcome satisfies SideErrors);
      setAdded(false);
    }
  };

  return (
    <>
      <JournalPage
        deck={deck}
        last="New card"
        dateline={today()}
        form={{
          ...form,
          setFront: (v) => {
            setAdded(false);
            form.setFront(v);
          },
        }}
        save={save}
        autoFocus
        foot={
          <>
            <div className="min-w-0 flex-1" aria-live="polite">
              {added ? (
                <p role="status" className="flex items-center gap-2 text-[0.95rem] font-medium">
                  <Check aria-hidden className="size-4 text-primary" />
                  Card added. Write the next one.
                </p>
              ) : (
                <p className="hidden text-sm text-muted-foreground lg:block">{MOD}+Enter to save</p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Link
                to="/decks/$deckId"
                params={{ deckId: deck.id }}
                className={cn(
                  OUTLINE_PILL,
                  "inline-flex h-11 items-center justify-center border text-sm font-medium text-foreground no-underline hover:bg-muted lg:h-10",
                )}
              >
                Done
              </Link>
              <Button type="submit" className={cn(PILL, "h-11 lg:h-10")}>
                Save card
              </Button>
            </div>
          </>
        }
        after={
          written.length > 0 && (
            <section aria-label="Written this visit" className="flex flex-col gap-4 border-t pt-6">
              <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Written this visit
              </h2>
              <ol className="flex flex-col">
                {written.map((w, i) => (
                  <li key={`${w.at}-${i}`} className="flex gap-3 sm:gap-4">
                    <p
                      className={cn(
                        TIME_COL,
                        "text-right text-sm text-muted-foreground tabular-nums",
                      )}
                    >
                      {time(w.at)}
                    </p>
                    <div className={cn(RAIL, "min-w-0 flex-1 pb-4")}>
                      <span
                        aria-hidden
                        className={cn(DOT, "top-1.5", i === 0 ? "bg-primary" : "bg-input")}
                      />
                      <p className="truncate font-medium">{w.front.split("\n")[0]}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {w.back.split("\n")[0]}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )
        }
      />
      {guard.dialog}
    </>
  );
}

export function EditCardScreen({ deck, card }: { deck: Deck; card: Card }) {
  const navigate = useNavigate();
  const state = useProtoState();
  const form = useCardForm(
    state === "discard"
      ? { front: card.front, back: `${card.back}\n\nA line not saved yet.` }
      : card,
    card,
  );
  const toDeck = () => navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });
  const guard = useDiscardGuard(form.dirty, state === "discard", () => void toDeck());

  const save = () => {
    const errors = updateCard(card.id, form.front, form.back);
    if (errors !== undefined) return form.setErrors(errors);
    guard.release();
    void toDeck();
  };

  const written = `Written ${dayLabel(card.createdAt).replace(/^(Today|Yesterday)$/, (d) => d.toLowerCase())}, ${time(card.createdAt)}`;

  return (
    <>
      <JournalPage
        deck={deck}
        last="Edit card"
        dateline={written}
        form={form}
        save={save}
        foot={
          <>
            <div className="min-w-0 flex-1">
              <Button
                type="button"
                variant="ghost"
                className={cn(PILL, "-ml-3 h-11 text-destructive hover:text-destructive lg:h-10")}
                onClick={() => {
                  guard.release();
                  void toDeck().then(() => deleteWithUndo(card));
                }}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
                onClick={() => void toDeck()}
              >
                Cancel
              </Button>
              <Button type="submit" className={cn(PILL, "h-11 lg:h-10")}>
                Save
              </Button>
            </div>
          </>
        }
      />
      {guard.dialog}
    </>
  );
}
