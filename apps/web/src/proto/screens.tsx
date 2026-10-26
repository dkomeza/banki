// PROTOTYPE (BAN-12), Variant c, "Composer": the deck page's Cards are one
// column of wide cards, the Front large and the Back on a muted panel
// under it, with Edit and Delete as plain words at each card's foot, and New
// card a round button floating at the bottom right. New and edit are a quiet
// writing page: a toolbar with the way back to the deck and Save at the top,
// then the Front at heading size and the Back under a rule, with no boxes.
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Layers, Plus, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { useCardForm } from "./card-form";
import { type Card, UNSAVED, createCard, sideErrors, updateCard, useProtoState } from "./cards";
import { useDiscardGuard } from "./discard";
import { deleteWithUndo } from "./toaster";

/** The Deck's Cards, newest first, in one column; or the empty state. */
export function CardsSection({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  const newCard = (floating: boolean) => (
    <Link
      to="/decks/$deckId/cards/new"
      params={{ deckId }}
      aria-label={floating ? "New card" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 bg-primary font-medium text-primary-foreground no-underline hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        floating
          ? "fixed right-[max(1.25rem,env(safe-area-inset-right))] bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 h-14 rounded-full px-5 text-base shadow-lg lg:right-10 lg:bottom-10"
          : cn(PILL, "h-11 text-sm lg:h-10"),
      )}
    >
      <Plus aria-hidden className={floating ? "size-5" : "size-4"} />
      New card
    </Link>
  );
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-5 border-t pt-6 lg:pt-8">
      <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
        Cards
      </h2>
      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[1.25rem] border-2 border-dashed border-input/60 px-6 py-16 text-center">
          <Layers aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-lg font-medium">No cards yet</p>
          <p className="max-w-xs text-sm text-balance text-muted-foreground">
            Write the first one: a Front to be asked, a Back to recall.
          </p>
          <div className="pt-2">{newCard(false)}</div>
        </div>
      ) : (
        <>
          <ol className="flex flex-col gap-4">
            {cards.map((card) => (
              <li
                key={card.id}
                className="flex flex-col gap-3 rounded-[1.25rem] border bg-card p-4 text-card-foreground sm:p-5"
              >
                <p className="line-clamp-4 text-lg leading-snug font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {card.front}
                </p>
                <p className="line-clamp-6 rounded-xl bg-muted/70 px-4 py-3 text-[0.95rem] leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                  {card.back}
                </p>
                <div className="-mb-1 -ml-2 flex gap-1 text-sm">
                  <Link
                    to="/cards/$cardId"
                    params={{ cardId: card.id }}
                    className="inline-flex h-11 items-center rounded-full px-3 font-medium text-foreground no-underline hover:bg-muted lg:h-8"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => deleteWithUndo(card)}
                    className="inline-flex h-11 items-center rounded-full px-3 font-medium text-destructive hover:bg-destructive/10 lg:h-8"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {newCard(true)}
          {/* Room for the floating button under the last card. */}
          <div aria-hidden className="h-16" />
        </>
      )}
    </section>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One side, written straight on the page: a small label and a borderless textarea. */
function Side({
  label,
  value,
  error,
  big,
  placeholder,
  inputRef,
  autoFocus,
  onChange,
  onKeyDown,
}: {
  label: string;
  value: string;
  error: string | undefined;
  big: boolean;
  placeholder: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-l-2 border-transparent pl-4 transition-colors focus-within:border-primary motion-reduce:transition-none sm:pl-5",
        error !== undefined && "border-destructive focus-within:border-destructive",
      )}
    >
      <label
        htmlFor={id}
        className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {label}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        value={value}
        rows={big ? 2 : 5}
        autoFocus={autoFocus}
        spellCheck
        placeholder={placeholder}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          "field-sizing-content w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground/60",
          big
            ? "min-h-20 text-2xl leading-snug font-semibold tracking-[-0.02em] lg:text-[1.75rem]"
            : "min-h-36 text-[1.05rem] leading-relaxed",
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

/** The writing page: a toolbar, an optional line under it, then the two sides. */
function Composer({
  deck,
  title,
  form,
  save,
  autoFocus = false,
  note,
  tools,
  foot,
}: {
  deck: Deck;
  title: string;
  form: ReturnType<typeof useCardForm>;
  save: () => void;
  autoFocus?: boolean;
  note?: ReactNode;
  tools: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <Page width="reading">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-6 lg:gap-8"
      >
        <div className="flex items-center gap-3">
          <Link
            to="/decks/$deckId"
            params={{ deckId: deck.id }}
            className="-ml-2 inline-flex h-11 min-w-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground no-underline hover:text-foreground lg:h-9"
          >
            <ArrowLeft aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{deck.name}</span>
          </Link>
          <div className="ml-auto flex shrink-0 gap-2">{tools}</div>
        </div>
        <h1 className="sr-only">{title}</h1>
        <div aria-live="polite">{note}</div>
        <div className="flex flex-col gap-6">
          <Side
            label="Front"
            value={form.front}
            error={form.errors.front}
            big
            placeholder="What to be asked"
            inputRef={form.frontRef}
            autoFocus={autoFocus}
            onChange={form.setFront}
            onKeyDown={form.onKeyDown(save)}
          />
          <div aria-hidden className="border-t" />
          <Side
            label="Back"
            value={form.back}
            error={form.errors.back}
            big={false}
            placeholder="What to recall"
            onChange={form.setBack}
            onKeyDown={form.onKeyDown(save)}
          />
        </div>
        <div className="flex items-center gap-3 border-t pt-4">
          {foot}
          <p className="ml-auto hidden text-sm text-muted-foreground lg:block">
            {MOD}+Enter to save
          </p>
        </div>
      </form>
    </Page>
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
      form.setErrors(outcome);
      setAdded(false);
    }
  };

  return (
    <>
      <Composer
        deck={deck}
        title="New card"
        form={form}
        save={save}
        autoFocus
        note={
          added && !form.dirty ? (
            <p className="flex items-center gap-2 text-[0.95rem] font-medium text-primary">
              <Check aria-hidden className="size-4" />
              Card added. Next one:
            </p>
          ) : (
            <p className="text-[0.95rem] text-muted-foreground">New card</p>
          )
        }
        tools={
          <Button type="submit" className={cn(PILL, "h-11 lg:h-10")}>
            Save card
          </Button>
        }
        foot={
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

  return (
    <>
      <Composer
        deck={deck}
        title="Edit card"
        form={form}
        save={save}
        note={<p className="text-[0.95rem] text-muted-foreground">Editing a card</p>}
        tools={
          <>
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
          </>
        }
        foot={
          <Button
            type="button"
            variant="ghost"
            className={cn(PILL, "h-11 -ml-3 text-destructive hover:text-destructive lg:h-10")}
            onClick={() => {
              guard.release();
              void toDeck().then(() => deleteWithUndo(card));
            }}
          >
            <Trash2 aria-hidden />
            Delete card
          </Button>
        }
      />
      {guard.dialog}
    </>
  );
}
