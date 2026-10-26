// PROTOTYPE (BAN-12), Variant h, "Dialogue": a Card is a question and its
// answer, so the deck page reads as a conversation. Each Card is an exchange:
// the Front in a bubble on the left, the Back in an accent-tinted bubble on the
// right, a quiet timestamp over each, newest at the top under a composer bar
// that is the New card action. New and edit write in the same two bubbles,
// with a round Save at the foot like a send button; a Card just added shows
// above the empty bubbles as a sent exchange.
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUp, Check, MessagesSquare, Trash2 } from "lucide-react";
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

/** "Today 09:12", "Yesterday 18:40", "20 Oct 07:05". */
function stamp(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}

// The two bubbles' shapes: the Front's tail at the bottom left, the Back's at the bottom right.
const FRONT_BUBBLE = "rounded-[1.4rem] rounded-bl-md border bg-card text-card-foreground shadow-xs";
const BACK_BUBBLE =
  "rounded-[1.4rem] rounded-br-md bg-accent text-accent-foreground ring-1 ring-primary/15";

/** The composer bar that opens the new-card page. */
function Composer({ deckId }: { deckId: string }) {
  return (
    <Link
      to="/decks/$deckId/cards/new"
      params={{ deckId }}
      className="group flex h-14 items-center gap-3 rounded-full border border-input/50 bg-card pr-2 pl-5 text-muted-foreground no-underline shadow-xs transition-[border-color,box-shadow] hover:border-foreground/30 hover:shadow-sm motion-reduce:transition-none"
    >
      <span className="min-w-0 flex-1 truncate text-[1.05rem]">Ask something new…</span>
      <span className="sr-only">New card</span>
      <span className="hidden text-sm font-medium text-foreground sm:inline">New card</span>
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground group-hover:bg-primary/85"
      >
        <ArrowUp className="size-5" />
      </span>
    </Link>
  );
}

/** One Card as an exchange: Front asked on the left, Back answered on the right. */
function Exchange({ card }: { card: Card }) {
  return (
    <li className="group/tile relative flex flex-col gap-1.5">
      <p className="text-center text-xs text-muted-foreground tabular-nums">
        {stamp(card.createdAt)}
      </p>
      <Link
        to="/cards/$cardId"
        params={{ cardId: card.id }}
        aria-label={`Edit card: ${card.front}`}
        className="flex flex-col gap-2 rounded-[1.6rem] p-1.5 no-underline outline-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <p
          className={cn(
            FRONT_BUBBLE,
            "max-w-[85%] self-start px-4 py-2.5 font-medium whitespace-pre-wrap [overflow-wrap:anywhere] sm:max-w-[75%]",
          )}
        >
          {card.front}
        </p>
        <p
          className={cn(
            BACK_BUBBLE,
            "line-clamp-[8] max-w-[85%] self-end px-4 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere] sm:max-w-[75%]",
          )}
        >
          {card.back}
        </p>
      </Link>
      <TileMenu
        label="Card actions"
        className="absolute top-6 right-0 lg:top-5"
        actions={[
          {
            label: "Delete",
            icon: <Trash2 aria-hidden />,
            danger: true,
            onClick: () => deleteWithUndo(card),
          },
        ]}
      />
    </li>
  );
}

/** The Deck's Cards as a conversation, newest at the top; or the empty state. */
export function CardsSection({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-5 border-t pt-6 lg:pt-8">
      <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
        Cards{" "}
        {cards.length > 0 && (
          <span className="font-normal text-muted-foreground tabular-nums">{cards.length}</span>
        )}
      </h2>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <Composer deckId={deckId} />
        {cards.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <MessagesSquare aria-hidden className="size-8 text-muted-foreground" />
            <p className="text-lg font-medium">No cards yet</p>
            <p className="max-w-xs text-sm text-balance text-muted-foreground">
              Ask the first question above; its answer goes on the Back.
            </p>
            <div aria-hidden className="mt-4 flex w-full max-w-sm flex-col gap-2 opacity-50">
              <div className={cn(FRONT_BUBBLE, "h-10 w-3/5 self-start shadow-none")} />
              <div className={cn(BACK_BUBBLE, "h-10 w-2/3 self-end ring-0")} />
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-5">
            {cards.map((card) => (
              <Exchange key={card.id} card={card} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One side as a bubble you type in, growing with what's typed. */
function BubbleSide({
  side,
  value,
  error,
  inputRef,
  autoFocus,
  onChange,
  onKeyDown,
}: {
  side: "front" | "back";
  value: string;
  error: string | undefined;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const id = useId();
  const front = side === "front";
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1.5 sm:max-w-[85%]",
        front ? "items-start self-start" : "items-end self-end",
      )}
    >
      <label
        htmlFor={id}
        className="px-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {front ? "Front · the question" : "Back · the answer"}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={front ? 2 : 4}
        value={value}
        autoFocus={autoFocus}
        spellCheck
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={front ? "What to be asked" : "What to recall"}
        className={cn(
          front ? FRONT_BUBBLE : BACK_BUBBLE,
          "field-sizing-content w-full resize-none px-4 py-3 text-[1.05rem] leading-relaxed outline-none placeholder:text-muted-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-destructive aria-invalid:outline-solid",
          front ? "min-h-20 font-medium" : "min-h-32",
        )}
      />
      {error !== undefined && (
        <p id={`${id}-error`} className="px-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The writing page: crumbs, title, the two bubbles and a foot with the actions. */
function Conversation({
  deck,
  last,
  form,
  save,
  autoFocus = false,
  above,
  foot,
}: {
  deck: Deck;
  last: string;
  form: ReturnType<typeof useCardForm>;
  save: () => void;
  autoFocus?: boolean;
  above?: ReactNode;
  foot: ReactNode;
}) {
  const library = useLibrary();
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <CardCrumbs library={library} deck={deck} last={last} />
      <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
        {last}
      </h1>
      {above}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-5"
      >
        <BubbleSide
          side="front"
          value={form.front}
          error={form.errors.front}
          inputRef={form.frontRef}
          autoFocus={autoFocus}
          onChange={form.setFront}
          onKeyDown={form.onKeyDown(save)}
        />
        <BubbleSide
          side="back"
          value={form.back}
          error={form.errors.back}
          onChange={form.setBack}
          onKeyDown={form.onKeyDown(save)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3 border-t pt-5">{foot}</div>
      </form>
    </div>
  );
}

/** The round accent Save, like a send button, with its word beside it from 640 px. */
function SendButton({ label }: { label: string }) {
  return (
    <Button
      type="submit"
      className={cn(PILL, "h-12 gap-2 pr-2 pl-5 text-[0.95rem] lg:h-11 lg:pr-1.5")}
    >
      {label}
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-full bg-primary-foreground/20"
      >
        <ArrowUp className="size-4" />
      </span>
    </Button>
  );
}

const BLANK = { front: "", back: "" };

/** The sample exchange the `added` state shows as just sent. */
const SENT_SAMPLE = { front: "el mercado", back: "the market\nCompramos fruta en el mercado." };

export function NewCardScreen({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const state = useProtoState();
  const form = useCardForm(
    state === "discard" ? UNSAVED : BLANK,
    BLANK,
    state === "invalid" ? sideErrors("", "") : {},
  );
  const [sent, setSent] = useState<{ front: string; back: string }[]>(
    state === "added" ? [SENT_SAMPLE] : [],
  );
  const [added, setAdded] = useState(state === "added");
  const toDeck = () => navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });
  const guard = useDiscardGuard(form.dirty, state === "discard", () => void toDeck());

  const save = () => {
    const outcome = createCard(deck.id, form.front, form.back);
    if ("id" in outcome) {
      setSent((s) => [...s, { front: outcome.front, back: outcome.back }].slice(-2));
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
      <Conversation
        deck={deck}
        last="New card"
        form={{
          ...form,
          setFront: (v) => {
            setAdded(false);
            form.setFront(v);
          },
        }}
        save={save}
        autoFocus
        above={
          sent.length > 0 && (
            <div className="flex flex-col gap-2 opacity-70" aria-hidden>
              {sent.map((s, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <p
                    className={cn(
                      FRONT_BUBBLE,
                      "line-clamp-2 max-w-[75%] self-start px-4 py-2 text-sm font-medium whitespace-pre-wrap",
                    )}
                  >
                    {s.front}
                  </p>
                  <p
                    className={cn(
                      BACK_BUBBLE,
                      "line-clamp-2 max-w-[75%] self-end px-4 py-2 text-sm whitespace-pre-wrap",
                    )}
                  >
                    {s.back}
                  </p>
                </div>
              ))}
            </div>
          )
        }
        foot={
          <>
            <div className="min-w-0 flex-1 basis-full sm:basis-auto" aria-live="polite">
              {added ? (
                <p role="status" className="flex items-center gap-2 text-[0.95rem] font-medium">
                  <Check aria-hidden className="size-4 text-primary" />
                  Card added. Ask the next one.
                </p>
              ) : (
                <p className="hidden text-sm text-muted-foreground lg:block">{MOD}+Enter to save</p>
              )}
            </div>
            <Link
              to="/decks/$deckId"
              params={{ deckId: deck.id }}
              className={cn(
                OUTLINE_PILL,
                "inline-flex h-12 items-center border text-sm font-medium text-foreground no-underline hover:bg-muted lg:h-11",
              )}
            >
              Done
            </Link>
            <SendButton label="Save card" />
          </>
        }
      />
      {guard.dialog}
    </Page>
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
    <Page width="reading">
      <Conversation
        deck={deck}
        last="Edit card"
        form={form}
        save={save}
        above={
          <p className="-mt-3 text-sm text-muted-foreground lg:-mt-5">
            Asked {stamp(card.createdAt).replace(/^(Today|Yesterday)/, (d) => d.toLowerCase())}
          </p>
        }
        foot={
          <>
            <div className="min-w-0 flex-1">
              <Button
                type="button"
                variant="ghost"
                className={cn(PILL, "-ml-3 h-12 text-destructive hover:text-destructive lg:h-11")}
                onClick={() => {
                  guard.release();
                  void toDeck().then(() => deleteWithUndo(card));
                }}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              className={cn(OUTLINE_PILL, "h-12 lg:h-11")}
              onClick={() => void toDeck()}
            >
              Cancel
            </Button>
            <SendButton label="Save" />
          </>
        }
      />
      {guard.dialog}
    </Page>
  );
}
