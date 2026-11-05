import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { StudySession, StudyState } from "@/lib/study";

// PROTOTYPE (BAN-38): the answer mode, the Written answer and the steps of
// write-and-grade, in a store of their own beside the Session, so a Variant
// can show them without the real Session changes. `?state=` puts the screen
// in one of the Prototype section's states: `write`, `writing`, `checked`,
// `dont-know`; the plain load is self-rate.

export type AnswerMode = "self-rate" | "write";
/** Where the shown Card is in write-and-grade: its Front, after Check, after I don't know. */
export type AnswerStep = "front" | "checked" | "dont-know";

export type AnswerProto = {
  mode: AnswerMode;
  draft: string;
  step: AnswerStep;
  /** Open the cheatsheet once the editor shows (`?state=writing`). */
  cheatsheet: boolean;
  /** The Card the step and draft belong to; a new one starts at its Front, blank. */
  cardId: string | undefined;
};

/** A half-written answer to Calculus 2's first Card, with inline and display Formulas. */
export const SAMPLE_DRAFT =
  "Defined for $x > -1$. Near $0$ it passes through the origin with slope one:\n\n$$\\ln(1+x) \\approx x - \\frac{x^2}{2}$$\n\nso it bends";

function initial(): AnswerProto {
  const state =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state");
  const base: AnswerProto = {
    mode: "self-rate",
    draft: "",
    step: "front",
    cheatsheet: false,
    cardId: undefined,
  };
  switch (state) {
    case "write":
      return { ...base, mode: "write" };
    case "writing":
      return { ...base, mode: "write", draft: SAMPLE_DRAFT, cheatsheet: true };
    case "checked":
      return { ...base, mode: "write", draft: `${SAMPLE_DRAFT} down.`, step: "checked" };
    case "dont-know":
      return { ...base, mode: "write", step: "dont-know" };
    default:
      return base;
  }
}

let current: AnswerProto = initial();
const listeners = new Set<() => void>();

export const answerProto = {
  get: (): AnswerProto => current,
  set: (change: Partial<AnswerProto>) => {
    current = { ...current, ...change };
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const isBlank = (text: string): boolean => text.trim() === "";

/** Whether the pointer is fine (desktop): the answer editor takes the focus as a Card shows. */
export const finePointer = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

/**
 * The prototype's state, kept in step with the Session: a new Card starts at
 * its Front with a blank answer, and a state that starts revealed reveals
 * the first Card.
 */
export function useAnswerProto(session: StudySession, state: StudyState) {
  const proto = useSyncExternalStore(answerProto.subscribe, answerProto.get);
  const cardId = state.phase === "card" ? state.shown?.card.id : undefined;
  useEffect(() => {
    if (cardId === undefined) return;
    const now = answerProto.get();
    if (now.cardId === undefined) {
      answerProto.set({ cardId });
      if (now.step !== "front" && !session.getState().revealed) session.reveal();
    } else if (now.cardId !== cardId) {
      answerProto.set({ cardId, step: "front", draft: "", cheatsheet: false });
    }
  }, [cardId, session]);
  const actions = useMemo(
    () => ({
      setMode: (mode: AnswerMode) => answerProto.set({ mode }),
      setDraft: (draft: string) => answerProto.set({ draft }),
      check: () => {
        if (isBlank(answerProto.get().draft) || session.getState().revealed) return;
        answerProto.set({ step: "checked" });
        session.reveal();
      },
      dontKnow: () => {
        if (session.getState().revealed) return;
        answerProto.set({ step: "dont-know", draft: "" });
        session.reveal();
      },
      /** I don't know's Next: the prototype saves its Again here, the real one as it is tapped. */
      next: () => session.rate("again"),
    }),
    [session],
  );
  return [proto, actions] as const;
}
export type AnswerActions = ReturnType<typeof useAnswerProto>[1];
