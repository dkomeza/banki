/* eslint-disable typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion -- prototype code */
import { type QueueKind, type Rating, StudyNextResponse } from "@banki/shared";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "./api";
import type { Card } from "./cards";

// PROTOTYPE (BAN-26): the study loop every Variant shares. It walks the real
// Queue (`study/next`) and rates for real (`POST /api/cards/:id/reviews`), but
// the Interval previews are made up here (the API doesn't answer them yet),
// and Undo only steps back on screen: the Review stays saved.
//
// `?state=<name>` opens the screen in one of the Prototype section's states,
// from fixtures, and the loop carries on for real from there.

export const STUDY_STATES = [
  "revealed",
  "math",
  "undone",
  "rate-error",
  "done",
  "nothing",
] as const;
export type StudyState = (typeof STUDY_STATES)[number];

export const RATING_LABELS: Record<Rating, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};
export const RATING_KEYS: Record<Rating, string> = { again: "1", hard: "2", good: "3", easy: "4" };
const RATINGS: readonly Rating[] = ["again", "hard", "good", "easy"];

/** Each Rating's Interval, as the button shows it. Made up for the prototype. */
export type Intervals = Record<Rating, string>;

function intervalsFor(kind: QueueKind, reps: number): Intervals {
  if (kind === "review") {
    const base = 2 + reps * 3;
    return { again: "10m", hard: `${base}d`, good: `${base * 2}d`, easy: `${base * 4}d` };
  }
  return { again: "1m", hard: "6m", good: "10m", easy: "3d" };
}

/** What the screen shows: a Card, the end of the Queue, or nothing to study. */
export type Phase = "loading" | "card" | "done" | "nothing";

type Shown = { card: Card; kind: QueueKind; intervals: Intervals; shownAt: number };

/** A Card from the fixtures, shaped like the API's. */
function fixtureCard(id: string, deckId: string, front: string, back: string): Card {
  const at = "2026-10-20T10:00:00.000Z";
  return { id, deckId, front, back, tags: [], createdAt: at, updatedAt: at } as unknown as Card;
}

const SEED_IMAGE = "images/5eed0000-0000-4000-8000-00000000a001.png";

/** The `math` state's Card: the seed's Calculus 2 sketch Card with the Maclaurin derivation after it. */
const MATH_FRONT =
  "Sketch $y = \\ln(1+x)$ near $x = 0$.\n\nWhere is it defined, and what is its Maclaurin series?";
const MATH_BACK = [
  `![](${SEED_IMAGE})`,
  "It passes through the origin with slope $1$, since $\\frac{d}{dx}\\ln(1+x) = \\frac{1}{1+x}$.",
  "",
  "$$\\frac{1}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n t^n, \\quad |t| < 1$$",
  "",
  "Integrate both sides from $0$ to $x$:",
  "",
  "$$\\ln(1+x) = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\frac{x^4}{4} + \\cdots$$",
  "",
  "It converges for $-1 < x \\le 1$, and is defined for $x > -1$, with a vertical asymptote at $x = -1$. See [the alternating series test](https://en.wikipedia.org/wiki/Alternating_series_test).",
].join("\n");

export type Study = {
  phase: Phase;
  card: Card | undefined;
  kind: QueueKind | undefined;
  intervals: Intervals | undefined;
  revealed: boolean;
  saving: Rating | undefined;
  error: string | undefined;
  /** How many Ratings this Session gave that are still standing. */
  rated: number;
  canUndo: boolean;
  /** Set right after an Undo, until the next Rating. */
  undone: boolean;
  reveal: () => void;
  rate: (rating: Rating) => void;
  retry: () => void;
  undo: () => void;
  leave: () => void;
  /** A click or tap on the Card: reveals, or once revealed copies a Formula. */
  onCardClick: (event: React.MouseEvent) => void;
};

export function useStudy(deckId: string, state: StudyState | undefined): Study {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");
  const [shown, setShown] = useState<Shown>();
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState<Rating>();
  const [error, setError] = useState<string>();
  const [history, setHistory] = useState<Shown[]>([]);
  const [undone, setUndone] = useState(false);
  const counts = useRef({ reviewsShown: 0, newShown: 0 });
  const failed = useRef<Rating>(undefined);

  const load = useCallback(
    async (after?: string) => {
      const res = await api.api.decks[":deckId"].study.next.$get({
        param: { deckId },
        query: {
          reviewsShown: String(counts.current.reviewsShown),
          newShown: String(counts.current.newShown),
          after: after ?? "",
        },
      });
      const { next } = StudyNextResponse.parse(await res.json());
      return next;
    },
    [deckId],
  );

  const showNext = useCallback(
    async (after: string | undefined, studied: boolean) => {
      const next = await load(after);
      setRevealed(false);
      setError(undefined);
      if (next === null) {
        setShown(undefined);
        setPhase(studied ? "done" : "nothing");
        return;
      }
      if (next.kind === "new") counts.current.newShown += 1;
      if (next.kind === "review") counts.current.reviewsShown += 1;
      setShown({
        card: next.card as Card,
        kind: next.kind,
        intervals: intervalsFor(next.kind, next.schedule.reps),
        shownAt: Date.now(),
      });
      setPhase("card");
    },
    [load],
  );

  // The first Card, or the state the URL asks for.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (state === "nothing") {
        setPhase("nothing");
        return;
      }
      if (state === "done") {
        const fake = Array.from({ length: 12 }, () => undefined as unknown as Shown);
        setHistory(fake);
        setPhase("done");
        return;
      }
      if (state === "math") {
        const card = fixtureCard("math-fixture", deckId, MATH_FRONT, MATH_BACK);
        setShown({ card, kind: "new", intervals: intervalsFor("new", 0), shownAt: Date.now() });
        setHistory(Array.from({ length: 3 }, () => undefined as unknown as Shown));
        setRevealed(true);
        setPhase("card");
        setTimeout(() => toast("Copied"), 300);
        return;
      }
      const next = await load();
      if (cancelled) return;
      if (next === null) {
        setPhase("nothing");
        return;
      }
      if (next.kind === "new") counts.current.newShown += 1;
      setShown({
        card: next.card as Card,
        kind: next.kind,
        intervals: intervalsFor(next.kind, next.schedule.reps),
        shownAt: Date.now(),
      });
      setPhase("card");
      if (state === "revealed") setRevealed(true);
      if (state === "undone") {
        setRevealed(true);
        setUndone(true);
        setHistory(Array.from({ length: 2 }, () => undefined as unknown as Shown));
      }
      if (state === "rate-error") {
        setRevealed(true);
        failed.current = "good";
        setError("Couldn't save your rating. Check your connection.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, state, load]);

  const reveal = useCallback(() => {
    if (phase === "card") setRevealed(true);
  }, [phase]);

  const rate = useCallback(
    (rating: Rating) => {
      if (shown === undefined || !revealed || saving !== undefined) return;
      setSaving(rating);
      setError(undefined);
      void (async () => {
        try {
          if (shown.card.id === "math-fixture") throw new Error("fixture");
          const res = await api.api.cards[":id"].reviews.$post({
            param: { id: shown.card.id },
            json: { rating, durationMs: Date.now() - shown.shownAt },
          });
          const status: number = res.status;
          if (status === 404) {
            toast("That card was deleted elsewhere, so it was skipped.");
          } else if (!res.ok) {
            throw new Error(String(status));
          }
          setHistory((h) => [...h, shown]);
          setUndone(false);
          await showNext(shown.card.id, true);
        } catch {
          if (shown.card.id === "math-fixture") {
            setHistory((h) => [...h, shown]);
            setUndone(false);
            await showNext(undefined, true);
          } else {
            failed.current = rating;
            setError("Couldn't save your rating. Check your connection.");
          }
        } finally {
          setSaving(undefined);
        }
      })();
    },
    [shown, revealed, saving, showNext],
  );

  const retry = useCallback(() => {
    if (failed.current !== undefined) {
      if (error !== undefined && saving === undefined) {
        setError(undefined);
        rate(failed.current);
      }
    }
  }, [rate, error, saving]);

  const undo = useCallback(() => {
    if (history.length === 0 || saving !== undefined) return;
    const previous = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setError(undefined);
    setUndone(true);
    if (previous !== undefined) {
      setShown({ ...previous, shownAt: Date.now() });
    } else if (shown === undefined) {
      // A fixture's history: bring the first Card of the Queue back.
      void load().then((next) => {
        if (next === null) return;
        setShown({
          card: next.card as Card,
          kind: next.kind,
          intervals: intervalsFor(next.kind, next.schedule.reps),
          shownAt: Date.now(),
        });
      });
    }
    setRevealed(true);
    setPhase("card");
  }, [history, saving, shown, load]);

  const leave = useCallback(() => {
    void navigate({ to: "/decks/$deckId", params: { deckId } });
  }, [navigate, deckId]);

  const onCardClick = useCallback(
    (event: React.MouseEvent) => {
      if (!revealed) {
        reveal();
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest("a") !== null) return;
      const formula = target.closest<HTMLElement>("[data-formula]");
      if (formula === null) return;
      const source = formula.dataset["formula"] ?? "";
      navigator.clipboard.writeText(source).then(
        () => toast("Copied"),
        () => toast("Couldn't copy"),
      );
    },
    [revealed, reveal],
  );

  // Desktop keys: Space / Enter reveal, 1–4 rate, Ctrl/⌘+Z undo, Esc leaves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === "Escape") {
        leave();
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        if (!revealed && phase === "card") {
          event.preventDefault();
          reveal();
        } else if (event.key === " ") event.preventDefault();
        return;
      }
      if (!revealed) return;
      const index = ["1", "2", "3", "4"].indexOf(event.key);
      const rating = RATINGS[index];
      if (rating !== undefined) rate(rating);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, leave, reveal, rate, revealed, phase]);

  return {
    phase,
    card: shown?.card,
    kind: shown?.kind,
    intervals: shown?.intervals,
    revealed,
    saving,
    error,
    rated: history.length,
    canUndo: history.length > 0,
    undone,
    reveal,
    rate,
    retry,
    undo,
    leave,
    onCardClick,
  };
}

export const studySearch = (search: Record<string, unknown>): { state?: StudyState } => {
  const state = search["state"];
  return typeof state === "string" && (STUDY_STATES as readonly string[]).includes(state)
    ? { state: state as StudyState }
    : {};
};

export { RATINGS };
