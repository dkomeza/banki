// PROTOTYPE (BAN-12), Variant b, "Ledger": the deck page's Cards are one
// bordered list of rows, Front and Back side by side in two columns from
// 768 px, with a Delete button always on each row and New card as the list's
// first row. New and edit write Front and Back side by side from 1024 px, like
// the two faces of the card, with the actions in a bar stuck to the bottom of
// the screen, where "Card added" shows too.
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Layers, Plus, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { useCardForm } from "./card-form";
import { type Card, UNSAVED, createCard, sideErrors, updateCard, useProtoState } from "./cards";
import { CardCrumbs } from "./crumbs";
import { useDiscardGuard } from "./discard";
import { deleteWithUndo } from "./toaster";

/** The Deck's Cards, newest first, as rows of one list; or the empty state. */
export function CardsSection({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-4 border-t pt-6 lg:pt-8">
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
          <Link
            to="/decks/$deckId/cards/new"
            params={{ deckId }}
            className={cn(
              PILL,
              "mt-2 inline-flex h-11 items-center gap-1.5 bg-primary text-sm font-medium text-primary-foreground no-underline hover:bg-primary/85 lg:h-10",
            )}
          >
            <Plus aria-hidden className="size-4" />
            New card
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[1.25rem] border bg-card text-card-foreground">
          <div
            aria-hidden
            className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-6 border-b px-5 py-2.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase md:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem]"
          >
            <span>Front</span>
            <span>Back</span>
          </div>
          <ul className="divide-y">
            <li>
              <Link
                to="/decks/$deckId/cards/new"
                params={{ deckId }}
                className="flex min-h-14 items-center gap-2.5 px-5 py-3 font-medium text-primary no-underline outline-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
              >
                <span className="flex size-7 items-center justify-center rounded-full border-2 border-dashed border-primary/50">
                  <Plus aria-hidden className="size-4" />
                </span>
                New card
              </Link>
            </li>
            {cards.map((card) => (
              <li
                key={card.id}
                className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-start gap-x-3 transition-colors hover:bg-muted/50 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] md:gap-x-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem]"
              >
                <Link
                  to="/cards/$cardId"
                  params={{ cardId: card.id }}
                  aria-label={`Edit card: ${card.front}`}
                  className="col-span-1 grid gap-1 py-3.5 pl-5 text-card-foreground no-underline outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid md:col-span-2 md:grid-cols-2 md:gap-6"
                >
                  <span className="line-clamp-3 self-start font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {card.front}
                  </span>
                  <span className="line-clamp-3 self-start text-sm whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere] md:text-[0.95rem]">
                    {card.back}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete card"
                  className="mt-1.5 mr-2 rounded-full text-muted-foreground hover:text-destructive lg:mt-3"
                  onClick={() => deleteWithUndo(card)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One face of the card: a labelled panel that is all textarea. */
function Face({
  label,
  hint,
  value,
  error,
  inputRef,
  autoFocus,
  onChange,
  onKeyDown,
}: {
  label: string;
  hint: string;
  value: string;
  error: string | undefined;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "flex flex-1 flex-col rounded-[1.25rem] border bg-card text-card-foreground transition-colors focus-within:border-ring focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring focus-within:outline-solid",
          error !== undefined && "border-destructive ring-3 ring-destructive/20",
        )}
      >
        <div className="flex items-baseline justify-between gap-3 border-b px-5 py-3">
          <label htmlFor={id} className="font-semibold">
            {label}
          </label>
          <span className="text-sm text-muted-foreground">{hint}</span>
        </div>
        <textarea
          id={id}
          ref={inputRef}
          value={value}
          autoFocus={autoFocus}
          spellCheck
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="field-sizing-content min-h-40 w-full flex-1 resize-none rounded-b-[1.25rem] bg-transparent px-5 py-4 text-[1.05rem] leading-relaxed outline-none lg:min-h-72"
        />
      </div>
      {error !== undefined && (
        <p id={`${id}-error`} className="px-1 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The two faces side by side from 1024 px, and the bar of actions stuck to the bottom. */
function Editor({
  title,
  crumbs,
  form,
  save,
  autoFocus = false,
  status,
  actions,
}: {
  title: string;
  crumbs: ReactNode;
  form: ReturnType<typeof useCardForm>;
  save: () => void;
  autoFocus?: boolean;
  status: ReactNode;
  actions: ReactNode;
}) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex min-h-[calc(100svh-4rem)] flex-col lg:min-h-svh"
    >
      <Page width="cards">
        <div className="flex flex-col gap-6 lg:gap-8">
          {crumbs}
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            {title}
          </h1>
          <div className="grid gap-5 lg:grid-cols-2">
            <Face
              label="Front"
              hint="What you're asked"
              value={form.front}
              error={form.errors.front}
              inputRef={form.frontRef}
              autoFocus={autoFocus}
              onChange={form.setFront}
              onKeyDown={form.onKeyDown(save)}
            />
            <Face
              label="Back"
              hint="What you recall"
              value={form.back}
              error={form.errors.back}
              onChange={form.setBack}
              onKeyDown={form.onKeyDown(save)}
            />
          </div>
        </div>
      </Page>
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-auto border-t bg-background/95 backdrop-blur lg:bottom-0">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3 sm:px-8 lg:px-10">
          <div className="min-w-0 flex-1" aria-live="polite">
            {status}
          </div>
          <div className="flex shrink-0 gap-2">{actions}</div>
        </div>
      </div>
    </form>
  );
}

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
  const [added, setAdded] = useState(state === "added" ? 1 : 0);
  const toDeck = () => navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });
  const guard = useDiscardGuard(form.dirty, state === "discard", () => void toDeck());

  const save = () => {
    const outcome = createCard(deck.id, form.front, form.back);
    if ("id" in outcome) {
      form.markSaved(BLANK);
      setAdded((n) => n + 1);
      form.frontRef.current?.focus();
    } else {
      form.setErrors(outcome);
    }
  };

  return (
    <>
      <Editor
        title="New card"
        crumbs={<CardCrumbs library={library} deck={deck} last="New card" />}
        form={form}
        save={save}
        autoFocus
        status={
          added > 0 && !form.dirty ? (
            <p className="flex items-center gap-2 text-[0.95rem] font-medium">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                <Check aria-hidden className="size-3.5" />
              </span>
              <span className="truncate">Card added{added > 1 ? ` (${added} so far)` : ""}</span>
            </p>
          ) : (
            <p className="hidden text-sm text-muted-foreground lg:block">{MOD}+Enter to save</p>
          )
        }
        actions={
          <>
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
          </>
        }
      />
      {guard.dialog}
    </>
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
    <>
      <Editor
        title="Edit card"
        crumbs={<CardCrumbs library={library} deck={deck} last="Edit card" />}
        form={form}
        save={save}
        status={
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
        }
        actions={
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
      />
      {guard.dialog}
    </>
  );
}
