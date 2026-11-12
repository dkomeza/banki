import type { CardPromptOptions } from "@banki/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type CardPromptDraft,
  checkDraft,
  deckCardPromptSaverFor,
  draftOf,
  sameOptions,
} from "@/lib/card-prompt";
import type { Deck } from "@/lib/decks";

/** How long typing pauses before the options save. */
const SETTLE_MS = 600;

export type CardPromptSaveStatus = "saving" | "saved" | "failed" | undefined;

/**
 * A Deck's Card prompt options as its page edits them, saved as they change,
 * the way Deck settings are: typing saves once it pauses, a pick at once, and
 * options with a problem not at all. `valid` is what the prompt is built
 * from: the options as they last had no problem. A change still waiting is
 * sent when the page closes, and a failed save waits with Try again.
 */
export function useCardPromptOptions(deck: Deck) {
  const queryClient = useQueryClient();
  const saver = deckCardPromptSaverFor(queryClient, deck.id);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  // Back on the page, the change not answered yet, or the one that failed, if any.
  const [start] = useState(
    () => saver.getState().queue.at(-1) ?? saver.getState().failed?.attempted ?? deck.cardPrompt,
  );
  const [draft, setDraft] = useState(() => draftOf(start));
  const [valid, setValid] = useState(start);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<CardPromptOptions | undefined>(undefined);
  const sent = useRef(start);

  /** Sends the change waiting, unless the Deck has it already. */
  const flush = () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = undefined;
    if (next === undefined) return;
    if (sameOptions(next, sent.current) && saver.getState().failed === undefined) return;
    sent.current = next;
    saver.change(next);
  };
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);

  const change = (patch: Partial<CardPromptDraft>, settleMs = SETTLE_MS) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    clearTimeout(timer.current);
    const { options } = checkDraft(next);
    pending.current = options;
    setWaiting(options !== undefined);
    if (options === undefined) return;
    setValid(options);
    if (settleMs === 0) {
      setWaiting(false);
      flush();
      return;
    }
    timer.current = setTimeout(() => {
      setWaiting(false);
      flush();
    }, settleMs);
  };

  const status: CardPromptSaveStatus =
    state.failed !== undefined && !waiting
      ? "failed"
      : waiting || state.queue.length > 0
        ? "saving"
        : state.saved
          ? "saved"
          : undefined;

  return {
    draft,
    errors: checkDraft(draft).errors,
    valid,
    status,
    /** Changes the fields; a pick saves at once. */
    change,
    pick: (patch: Partial<CardPromptDraft>) => change(patch, 0),
    retry: () => saver.retry(),
  };
}
