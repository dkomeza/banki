// PROTOTYPE (BAN-12), Variant e, "Contours", built on Variant a: the deck
// page's Cards are tiles (card-tile.tsx), with Delete in each one's ⋯ menu and
// New card as the section's primary pill. New and edit are Variant a's: one
// index card at reading width, the two sides inside it, with the actions along
// its foot.
import { Link, useNavigate } from "@tanstack/react-router";
import { Layers, Plus, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { Done, OUTLINE_PILL, PILL } from "@/components/settings/parts";
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
import { CardTile } from "./card-tile";
import { CardCrumbs } from "./crumbs";
import { useDiscardGuard } from "./discard";
import { deleteWithUndo } from "./toaster";

/** The Deck's Cards, newest first, as index cards; or the empty state. */
export function CardsSection({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  const newCard = (
    <Link
      to="/decks/$deckId/cards/new"
      params={{ deckId }}
      className={cn(
        PILL,
        "inline-flex h-11 items-center gap-1.5 bg-primary text-sm font-medium text-primary-foreground no-underline hover:bg-primary/85 lg:h-10",
      )}
    >
      <Plus aria-hidden className="size-4" />
      New card
    </Link>
  );
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-5 border-t pt-6 lg:pt-8">
      <div className="flex items-center justify-between gap-4">
        <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
          Cards{" "}
          {cards.length > 0 && (
            <span className="font-normal text-muted-foreground tabular-nums">{cards.length}</span>
          )}
        </h2>
        {cards.length > 0 && newCard}
      </div>
      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[1.25rem] border-2 border-dashed border-input/60 px-6 py-16 text-center">
          <Layers aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-lg font-medium">No cards yet</p>
          <p className="max-w-xs text-sm text-balance text-muted-foreground">
            Write the first one: a Front to be asked, a Back to recall.
          </p>
          <div className="pt-2">{newCard}</div>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((card) => (
            <CardTile key={card.id} card={card} />
          ))}
        </ul>
      )}
    </section>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One side's labelled textarea, growing with what's typed. */
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
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 sm:px-6">
      <label
        htmlFor={id}
        className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {label}
      </label>
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
        className="field-sizing-content min-h-20 w-full resize-none rounded-lg bg-transparent py-1 text-[1.05rem] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-4 aria-invalid:outline-destructive aria-invalid:outline-solid"
        placeholder={label === "Front" ? "What to be asked" : "What to recall"}
      />
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The index card the two sides are written on, with the actions along its foot. */
function EditorCard({
  form,
  save,
  foot,
  autoFocus = false,
}: {
  form: ReturnType<typeof useCardForm>;
  save: () => void;
  foot: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col rounded-[1.25rem] border bg-card text-card-foreground shadow-xs"
    >
      <Side
        label="Front"
        value={form.front}
        error={form.errors.front}
        rows={2}
        inputRef={form.frontRef}
        autoFocus={autoFocus}
        onChange={form.setFront}
        onKeyDown={form.onKeyDown(save)}
      />
      <div aria-hidden className="mx-5 border-t border-dashed sm:mx-6" />
      <Side
        label="Back"
        value={form.back}
        error={form.errors.back}
        rows={4}
        onChange={form.setBack}
        onKeyDown={form.onKeyDown(save)}
      />
      <div className="flex flex-col gap-3 rounded-b-[1.25rem] border-t bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        {foot}
      </div>
    </form>
  );
}

const Title = ({ children }: { children: ReactNode }) => (
  <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
    {children}
  </h1>
);

const BLANK = { front: "", back: "" };

export function NewCardScreen({ deck }: { deck: Deck }) {
  const library = useLibrary();
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
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <CardCrumbs library={library} deck={deck} last="New card" />
        <Title>New card</Title>
        <EditorCard
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
                  <Done>Card added. Write the next one.</Done>
                ) : (
                  <p className="hidden text-sm text-muted-foreground lg:block">
                    {MOD}+Enter to save
                  </p>
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
        />
      </div>
      {guard.dialog}
    </Page>
  );
}

export function EditCardScreen({ deck, card }: { deck: Deck; card: Card }) {
  const library = useLibrary();
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
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <CardCrumbs library={library} deck={deck} last="Edit card" />
        <Title>Edit card</Title>
        <EditorCard
          form={form}
          save={save}
          foot={
            <>
              <div className="min-w-0 flex-1">
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
      </div>
      {guard.dialog}
    </Page>
  );
}
