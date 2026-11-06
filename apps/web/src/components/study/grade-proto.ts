import type { Rating } from "@banki/shared";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Highlight } from "@/components/cards/card-text";
import type { StudySession, StudyState } from "@/lib/study";

// PROTOTYPE (BAN-40): the Grader's result on the study screen, in a store of
// its own beside the Session, with the Grader stubbed: a Check waits about
// two and a half seconds, then grades. `?state=` puts the screen in one of the
// Prototype section's states, on the first Card the Session shows:
// `grading`, `grading-selected`, `graded`, `graded-mistakes`, `grade-failed`,
// `no-key`. The plain load is the Card's Front in write-and-grade.

export type GradeStatus = "idle" | "grading" | "graded" | "failed";
export type GradeFailure = "grading_failed" | "no_api_key";

/** What the Grader sends back (`GradeResponse`), its ranges already found in the texts shown. */
export type GradeResult = {
  rating: Rating;
  feedback: string;
  missing: Highlight[];
  mistakes: (Highlight & { note: string })[];
};

/** A stand-in for the Card shown, so a state can show a Card the Queue doesn't start with. */
export type ShownOverride = { front: string; back: string };

export type GradeProto = {
  status: GradeStatus;
  result: GradeResult | undefined;
  failure: GradeFailure | undefined;
  /** The Rating selected before the suggestion arrived, to confirm. */
  selected: Rating | undefined;
  /** The Card the grade belongs to; a new one starts idle. */
  cardId: string | undefined;
  override: ShownOverride | undefined;
};

export const FAILURE_MESSAGES: Record<GradeFailure, string> = {
  grading_failed: "Couldn't grade this answer. Try again, or rate it yourself.",
  no_api_key: "Add your OpenRouter API key in Settings to grade answers.",
};

/** Calculus 2's first Card, "Sketch y = ln(1 + x) near x = 0", answered well. */
const SKETCH_ANSWER =
  "It's defined for $x > -1$, with a vertical asymptote at $x = -1$.\n\nIt goes through the origin with slope $1$, since $\\frac{d}{dx}\\ln(1+x) = \\frac{1}{1+x}$.";
const SKETCH_FEEDBACK =
  "Right on the domain and on the slope at the origin. What's missing is the shape: the curve is **concave** everywhere, so it bends below its tangent $y = x$.";

/** The Maclaurin series Card, answered with two mistakes. */
const MACLAURIN: ShownOverride = {
  front: "Derive the Maclaurin series of $\\ln(1+x)$.\n\nFor which $x$ does it converge?",
  back: [
    "Start from the geometric series:",
    "$$\\frac{1}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n t^n, \\quad |t| < 1$$",
    "Integrate both sides from $0$ to $x$:",
    "$$\\ln(1+x) = \\int_0^x \\frac{dt}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n \\frac{x^{n+1}}{n+1}$$",
    "so",
    "$$\\ln(1+x) = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\frac{x^4}{4} + \\cdots$$",
    "It converges for $-1 < x \\le 1$: at $x = 1$ by the alternating series test (giving $\\ln 2$), and it diverges at $x = -1$ (the harmonic series).",
  ].join("\n"),
};
const MACLAURIN_ANSWER = [
  "Start from the geometric series, $\\frac{1}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n t^n$ for $|t| < 1$.",
  "",
  "Differentiate both sides with respect to $t$ and put $t = x$:",
  "",
  "$$\\ln(1+x) = \\sum_{n=0}^{\\infty} (-1)^n \\frac{x^{n+1}}{n+1} = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\cdots$$",
  "",
  "It converges for $-1 \\le x \\le 1$, since the terms go to $0$.",
].join("\n");
const MACLAURIN_FEEDBACK = [
  "The series itself is right, and starting from the geometric series is the way in. Two steps go wrong on the way:",
  "",
  "1. **Integrate, don't differentiate.** $\\ln(1+x) = \\int_0^x \\frac{dt}{1+t}$, so you integrate the geometric series term by term from $0$ to $x$. Differentiating it gives $-\\frac{1}{(1+t)^2}$ instead.",
  "2. **The left end is out.** At $x = -1$ the series is $-\\sum \\frac{1}{n}$, the harmonic series, which diverges; terms going to $0$ isn't enough. The interval is $-1 < x \\le 1$, with $x = 1$ in by the alternating series test.",
].join("\n");

/** The range of `part` in `text`, the first one, or after `after`. */
function rangeOf(text: string, part: string, after = 0): { from: number; to: number } {
  const from = text.indexOf(part, after);
  if (from < 0) throw new Error(`Not in the text: ${part}`);
  return { from, to: from + part.length };
}

/** The stubbed Grader: a canned grade for the two Cards the states show, a plain one for any other. */
export function stubGrade(written: string, back: string): GradeResult {
  if (back === MACLAURIN.back && written === MACLAURIN_ANSWER) {
    return {
      rating: "hard",
      feedback: MACLAURIN_FEEDBACK,
      missing: [
        {
          ...rangeOf(back, "at $x = 1$ by the alternating series test (giving $\\ln 2$)"),
          kind: "missing",
          n: 1,
        },
      ],
      mistakes: [
        {
          ...rangeOf(written, "Differentiate both sides"),
          kind: "mistake",
          n: 1,
          note: "Integrate from $0$ to $x$ instead: differentiating gives $-\\frac{1}{(1+t)^2}$.",
        },
        {
          // Inside the Formula: it marks the whole of it.
          ...rangeOf(written, "-1 \\le"),
          kind: "mistake",
          n: 2,
          note: "At $x = -1$ it's the harmonic series, which diverges: $-1 < x \\le 1$.",
        },
      ],
    };
  }
  if (written === SKETCH_ANSWER) {
    return {
      rating: "good",
      feedback: SKETCH_FEEDBACK,
      missing: [{ ...rangeOf(back, "It is concave everywhere"), kind: "missing", n: 1 }],
      mistakes: [],
    };
  }
  const lines = back.split("\n");
  const last = lines.at(-1) ?? back;
  return {
    rating: "good",
    feedback:
      "Mostly there: the stubbed Grader marks the Back's last line as missing, so you can see a Highlight on any Card.",
    missing: last.trim() === "" ? [] : [{ ...rangeOf(back, last), kind: "missing", n: 1 }],
    mistakes: [],
  };
}

type Start = {
  status: GradeStatus;
  failure?: GradeFailure;
  selected?: Rating;
  answer: string;
  override?: ShownOverride;
};

/** What `?state=` asks for: the answer to check the first Card with, and where the grade starts. */
function requested(): Start | undefined {
  const name =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state");
  switch (name) {
    case "grading":
      return { status: "grading", answer: SKETCH_ANSWER };
    case "grading-selected":
      return { status: "grading", selected: "hard", answer: SKETCH_ANSWER };
    case "graded":
      return { status: "graded", answer: SKETCH_ANSWER };
    case "graded-mistakes":
      return { status: "graded", answer: MACLAURIN_ANSWER, override: MACLAURIN };
    case "grade-failed":
      return { status: "failed", failure: "grading_failed", answer: SKETCH_ANSWER };
    case "no-key":
      return { status: "failed", failure: "no_api_key", answer: SKETCH_ANSWER };
    default:
      return undefined;
  }
}

const IDLE: GradeProto = {
  status: "idle",
  result: undefined,
  failure: undefined,
  selected: undefined,
  cardId: undefined,
  override: undefined,
};

let current: GradeProto = IDLE;
let pending: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const set = (change: Partial<GradeProto>) => {
  current = { ...current, ...change };
  for (const listener of listeners) listener();
};
const store = {
  get: (): GradeProto => current,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** How long the stubbed Grader takes. */
const GRADER_MS = 2500;

/** The texts the screen shows for the Card: its own, or the state's stand-in. */
export function shownTexts(state: StudyState, proto: GradeProto) {
  const card = state.shown?.card;
  return {
    front: proto.override?.front ?? card?.front ?? "",
    back: proto.override?.back ?? card?.back ?? "",
  };
}

/** Sends the stubbed Grader the Card's Written answer: graded after a while, unless the Card moved on. */
function grade(session: StudySession, id: string) {
  clearTimeout(pending);
  set({ status: "grading", failure: undefined, result: undefined });
  pending = setTimeout(() => {
    const now = store.get();
    if (now.cardId !== id || now.status !== "grading") return;
    const s = session.getState();
    set({
      status: "graded",
      result: stubGrade(s.written ?? "", shownTexts(s, now).back),
    });
  }, GRADER_MS);
}

/**
 * The prototype's grade, kept in step with the Session: Check starts the
 * stubbed Grader (a Card already checked when the screen opens resumes in
 * the failure state, as the spec says), a new Card starts idle, and a
 * `?state=` checks the first Card with its answer.
 */
export function useGradeProto(session: StudySession, state: StudyState) {
  const proto = useSyncExternalStore(store.subscribe, store.get);
  const cardId = state.phase === "card" ? state.shown?.card.id : undefined;
  const written = state.written;
  useEffect(() => {
    if (cardId === undefined) return;
    const now = store.get();
    if (now.cardId === cardId) return;
    clearTimeout(pending);
    const first = now.cardId === undefined;
    const start = first ? requested() : undefined;
    if (start !== undefined) {
      const s = session.getState();
      if (!s.revealed) {
        if (s.mode !== "write") session.setMode("write");
        session.setDraft(start.answer);
        session.check();
      }
      const texts = start.override ?? { back: s.shown?.card.back ?? "" };
      set({
        ...IDLE,
        cardId,
        status: start.status,
        failure: start.failure,
        selected: start.selected,
        override: start.override,
        result: start.status === "graded" ? stubGrade(start.answer, texts.back) : undefined,
      });
      return;
    }
    const s = session.getState();
    // Resumed after Check with no grade kept: the failure state.
    if (s.written !== undefined) {
      set({ ...IDLE, cardId, status: "failed", failure: "grading_failed" });
      return;
    }
    set({ ...IDLE, cardId });
  }, [cardId, session]);
  // Check on the Card shown: the stubbed Grader starts.
  useEffect(() => {
    if (cardId === undefined || written === undefined) return;
    const now = store.get();
    if (now.cardId !== cardId || now.status !== "idle") return;
    grade(session, cardId);
  }, [cardId, written, session]);
  // Undo brings a Card back without its Written answer: the grade goes.
  useEffect(() => {
    if (written === undefined && store.get().status !== "idle") {
      clearTimeout(pending);
      set({ status: "idle", result: undefined, failure: undefined, selected: undefined });
    }
  }, [written]);
  const actions = useMemo(
    () => ({
      /** Before the suggestion, a tap or 1–4 selects; after it, or after a failure, it saves. */
      tap: (rating: Rating) => {
        if (!session.getState().ratable) return;
        if (store.get().status === "grading") set({ selected: rating });
        else session.rate(rating);
      },
      /** Confirm or Enter: the selection, else (once it is in) the suggestion. */
      confirm: () => {
        const now = store.get();
        const rating = now.selected ?? (now.status === "graded" ? now.result?.rating : undefined);
        if (rating === undefined || !session.getState().ratable) return;
        clearTimeout(pending);
        session.rate(rating);
      },
      /** Variant f: Change, back to the four ratings with nothing selected. */
      deselect: () => set({ selected: undefined }),
      retry: () => {
        const id = store.get().cardId;
        if (id !== undefined) grade(session, id);
      },
    }),
    [session],
  );
  return [proto, actions] as const;
}
export type GradeActions = ReturnType<typeof useGradeProto>[1];

/** Whether the grade governs the ratings: the Card was checked, not answered I don't know. */
export const grading = (state: StudyState) => state.written !== undefined && !state.dontKnow;

/** The grade as it is now, for a key handler. */
export const gradeNow = (): GradeProto => current;
