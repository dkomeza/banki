// PROTOTYPE (BAN-12), Variant g, "Workbench": the Deck stays in view while you
// read and write, like a mail or notes app. The deck page's Cards are a list
// pane of rows beside a reading pane showing the selected Card whole, with
// Edit and Delete on it. New and edit keep the same list pane on the left, the
// Card being written highlighted in it, and the editor in the right pane, so
// you hop from Card to Card without going back. Below 1024 px the panes stack:
// the list alone on the deck page, the editor alone on its pages.
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Layers, PenLine, Plus, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { useLibrary } from "@/components/folders/use-library";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { useCardForm } from "./card-form";
import {
  type Card,
  type SideErrors,
  UNSAVED,
  cardCount,
  createCard,
  sideErrors,
  updateCard,
  useCards,
  useProtoState,
} from "./cards";
import { CardCrumbs } from "./crumbs";
import { useDiscardGuard } from "./discard";
import { deleteWithUndo } from "./toaster";

const WIDE = "(min-width: 1024px)";

/** "26 Oct", "5 h ago", "just now": when a Card was written. */
function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const NEW_PILL = cn(
  PILL,
  "inline-flex h-11 items-center gap-1.5 bg-primary text-sm font-medium text-primary-foreground no-underline hover:bg-primary/85 lg:h-9 lg:px-4",
);

/** One row of the list pane: Front, then the start of the Back. */
function Row({
  card,
  current,
  onSelect,
}: {
  card: Card;
  current: boolean;
  onSelect?: (card: Card) => void;
}) {
  return (
    <li className="group/row relative">
      <Link
        to="/cards/$cardId"
        params={{ cardId: card.id }}
        aria-current={current ? "true" : undefined}
        onClick={(event) => {
          // From 1024 px the deck page selects into its reading pane instead.
          if (onSelect === undefined || !window.matchMedia(WIDE).matches) return;
          event.preventDefault();
          onSelect(card);
        }}
        className={cn(
          "relative flex flex-col gap-0.5 py-3 pr-14 pl-5 text-left no-underline outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid lg:pr-12",
          current
            ? onSelect === undefined
              ? "bg-accent"
              : "hover:bg-muted/70 lg:bg-accent lg:hover:bg-accent"
            : "hover:bg-muted/70",
        )}
      >
        {current && (
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-2 left-1.5 w-[3px] rounded-full bg-primary",
              onSelect !== undefined && "hidden lg:block",
            )}
          />
        )}
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {card.front.split("\n")[0]}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {ago(card.createdAt)}
          </span>
        </span>
        <span className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
          {card.back}
        </span>
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Delete card: ${card.front.split("\n")[0]}`}
        onClick={() => deleteWithUndo(card)}
        className="absolute top-1/2 right-2 size-11 -translate-y-1/2 rounded-full text-muted-foreground hover:text-destructive lg:size-8 lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-visible:opacity-100"
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

/** The list pane: the Deck's Cards, newest first, with New card on top. */
function ListPane({
  deckId,
  cards,
  currentId,
  writingNew = false,
  onSelect,
  className,
}: {
  deckId: string;
  cards: readonly Card[];
  currentId?: string;
  writingNew?: boolean;
  onSelect?: (card: Card) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <p className="text-sm font-medium text-muted-foreground tabular-nums">
          {cardCount(cards.length)}
        </p>
        {writingNew ? (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium">
            <PenLine aria-hidden className="size-4 text-primary" />
            Writing
          </span>
        ) : (
          <Link to="/decks/$deckId/cards/new" params={{ deckId }} className={NEW_PILL}>
            <Plus aria-hidden className="size-4" />
            New card
          </Link>
        )}
      </div>
      <ul aria-label="Cards" className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain">
        {cards.map((card) => (
          <Row key={card.id} card={card} current={card.id === currentId} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

/** One side, read: its label in the margin and the source as typed. */
function ReadSide({ label, text, big = false }: { label: string; text: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "whitespace-pre-wrap [overflow-wrap:anywhere]",
          big
            ? "text-2xl leading-snug font-semibold tracking-tight"
            : "text-[1.05rem] leading-relaxed",
        )}
      >
        {text}
      </p>
    </div>
  );
}

/** The deck page's Cards: the list pane, and from 1024 px a reading pane beside it. */
export function CardsSection({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const selected = cards.find((c) => c.id === selectedId) ?? cards[0];

  if (cards.length === 0) {
    return (
      <section aria-labelledby="cards-title" className="flex flex-col gap-4 border-t pt-6 lg:pt-8">
        <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
          Cards
        </h2>
        <div className="grid overflow-hidden rounded-[1.25rem] border bg-card lg:grid-cols-[20rem_1fr]">
          <div className="hidden flex-col gap-3 border-r p-5 lg:flex" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2 opacity-60">
                <div className="h-3 w-2/3 rounded-full bg-muted" />
                <div className="h-2.5 w-full rounded-full bg-muted" />
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Layers aria-hidden className="size-8 text-muted-foreground" />
            <p className="text-lg font-medium">No cards yet</p>
            <p className="max-w-xs text-sm text-balance text-muted-foreground">
              Write the first one: a Front to be asked, a Back to recall.
            </p>
            <div className="pt-2">
              <Link to="/decks/$deckId/cards/new" params={{ deckId }} className={NEW_PILL}>
                <Plus aria-hidden className="size-4" />
                New card
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-4 border-t pt-6 lg:pt-8">
      <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
        Cards
      </h2>
      <div className="grid gap-4 lg:h-[34rem] lg:grid-cols-[20rem_1fr]">
        <ListPane
          deckId={deckId}
          cards={cards}
          currentId={selected?.id}
          onSelect={(card) => setSelectedId(card.id)}
        />
        {selected !== undefined && (
          <article
            aria-label="Selected card"
            className="hidden min-h-0 flex-col overflow-hidden rounded-[1.25rem] border bg-card lg:flex"
          >
            <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
              <p className="text-sm text-muted-foreground">Written {ago(selected.createdAt)}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(PILL, "h-9 px-3 text-destructive hover:text-destructive")}
                  onClick={() => deleteWithUndo(selected)}
                >
                  <Trash2 aria-hidden />
                  Delete
                </Button>
                <Link
                  to="/cards/$cardId"
                  params={{ cardId: selected.id }}
                  className={cn(
                    OUTLINE_PILL,
                    "inline-flex h-9 items-center gap-1.5 border px-4 text-sm font-medium text-foreground no-underline hover:bg-muted",
                  )}
                >
                  <PenLine aria-hidden className="size-4" />
                  Edit
                </Link>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-7">
              <ReadSide label="Front" text={selected.front} big />
              <div aria-hidden className="border-t" />
              <ReadSide label="Back" text={selected.back} />
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One side's labelled textarea, in a box of its own that grows with what's typed. */
function Side({
  label,
  value,
  error,
  big = false,
  inputRef,
  autoFocus,
  onChange,
  onKeyDown,
}: {
  label: string;
  value: string;
  error: string | undefined;
  big?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {label}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={big ? 2 : 6}
        value={value}
        autoFocus={autoFocus}
        spellCheck
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={label === "Front" ? "What to be asked" : "What to recall"}
        className={cn(
          "field-sizing-content w-full resize-none rounded-xl border border-input/50 bg-background px-4 py-3 outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/10",
          big
            ? "min-h-20 text-xl leading-snug font-semibold tracking-tight"
            : "min-h-40 text-[1.05rem] leading-relaxed",
        )}
      />
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The two panes of a writing page: the Deck's list, and the editor. */
function Workbench({
  deck,
  currentId,
  writingNew,
  last,
  toolbar,
  status,
  children,
  onSubmit,
}: {
  deck: Deck;
  currentId?: string;
  writingNew?: boolean;
  last: string;
  toolbar: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  onSubmit: () => void;
}) {
  const library = useLibrary();
  const cards = useCards(deck.id);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <CardCrumbs library={library} deck={deck} last={last} />
      <div className="grid gap-4 lg:h-[calc(100dvh-9.5rem)] lg:min-h-[32rem] lg:grid-cols-[20rem_1fr]">
        <ListPane
          deckId={deck.id}
          cards={cards}
          currentId={currentId}
          writingNew={writingNew}
          className="hidden lg:flex"
        />
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex min-h-0 flex-col rounded-[1.25rem] border bg-card text-card-foreground"
        >
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3 sm:px-6">
            <Link
              to="/decks/$deckId"
              params={{ deckId: deck.id }}
              aria-label={`Back to ${deck.name}`}
              className="-ml-2 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft aria-hidden className="size-5" />
            </Link>
            <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{last}</h1>
            <div className="flex items-center gap-2">{toolbar}</div>
          </div>
          {status}
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-6 sm:px-6">
            {children}
          </div>
          <p className="hidden border-t px-6 py-2.5 text-xs text-muted-foreground lg:block">
            {MOD}+Enter to save
          </p>
        </form>
      </div>
    </div>
  );
}

const BLANK = { front: "", back: "" };

export function NewCardScreen({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const state = useProtoState();
  const form = useCardForm(
    state === "discard" ? UNSAVED : BLANK,
    BLANK,
    state === "invalid" ? sideErrors("", "") : {},
  );
  const [added, setAdded] = useState(state === "added");
  const toDeck = () => navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });
  const guard = useDiscardGuard(form.dirty, state === "discard", () => void toDeck());

  const save = () => {
    const outcome = createCard(deck.id, form.front, form.back);
    if ("id" in outcome) {
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
      <Workbench
        deck={deck}
        writingNew
        last="New card"
        onSubmit={save}
        toolbar={
          <>
            <Link
              to="/decks/$deckId"
              params={{ deckId: deck.id }}
              className={cn(
                OUTLINE_PILL,
                "hidden h-11 items-center border text-sm font-medium text-foreground no-underline hover:bg-muted sm:inline-flex lg:h-9",
              )}
            >
              Done
            </Link>
            <Button type="submit" className={cn(PILL, "h-11 lg:h-9")}>
              Save card
            </Button>
          </>
        }
        status={
          <div aria-live="polite">
            {added && (
              <p
                role="status"
                className="flex items-center gap-2 border-b bg-accent px-6 py-2.5 text-sm font-medium"
              >
                <Check aria-hidden className="size-4 text-primary" />
                Card added. It's at the top of the list; write the next one.
              </p>
            )}
          </div>
        }
      >
        <Side
          label="Front"
          big
          value={form.front}
          error={form.errors.front}
          inputRef={form.frontRef}
          autoFocus
          onChange={(v) => {
            setAdded(false);
            form.setFront(v);
          }}
          onKeyDown={form.onKeyDown(save)}
        />
        <Side
          label="Back"
          value={form.back}
          error={form.errors.back}
          onChange={form.setBack}
          onKeyDown={form.onKeyDown(save)}
        />
      </Workbench>
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

  return (
    <>
      <Workbench
        deck={deck}
        currentId={card.id}
        last="Edit card"
        onSubmit={save}
        toolbar={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete card"
              className="size-11 rounded-full text-muted-foreground hover:text-destructive lg:size-9"
              onClick={() => {
                guard.release();
                void toDeck().then(() => deleteWithUndo(card));
              }}
            >
              <Trash2 aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 lg:h-9")}
              onClick={() => void toDeck()}
            >
              Cancel
            </Button>
            <Button type="submit" className={cn(PILL, "h-11 lg:h-9")}>
              Save
            </Button>
          </>
        }
        status={
          <p className="border-b px-6 py-2 text-xs text-muted-foreground">
            Written {ago(card.createdAt)}
            {card.updatedAt !== card.createdAt && ` · edited ${ago(card.updatedAt)}`}
          </p>
        }
      >
        <Side
          label="Front"
          big
          value={form.front}
          error={form.errors.front}
          inputRef={form.frontRef}
          onChange={form.setFront}
          onKeyDown={form.onKeyDown(save)}
        />
        <Side
          label="Back"
          value={form.back}
          error={form.errors.back}
          onChange={form.setBack}
          onKeyDown={form.onKeyDown(save)}
        />
      </Workbench>
      {guard.dialog}
    </>
  );
}
