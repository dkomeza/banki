import {
  type IntervalPreview,
  type IntervalPreviews,
  type QueueKind,
  RATINGS,
  RateCardResponse,
  type Rating,
  StudyNextResponse,
  UndoReviewResponse,
} from "@banki/shared";
import { type ApiClient, api } from "./api";
import type { Card } from "./cards";

// The study screen's Session (CONTEXT.md: Session, Queue, Interval, New-card
// batch): it walks a Deck's Queue Card by Card, asking the API for each next
// Card, and keeps the Ratings it gave so Undo can take them back, newest
// first. Where the Queue ends with New cards held back, it can take another
// batch and carry on. Left early, or at the end of the Queue, it sums up the
// Ratings still standing (the summary). Nothing here touches the page, so it
// is tested without one.

export const RATING_LABELS: Record<Rating, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

/** The key that gives each Rating on a keyboard. */
export const RATING_KEYS: Record<Rating, string> = { again: "1", hard: "2", good: "3", easy: "4" };

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

/** A number to one decimal, without a trailing `.0`. */
const oneDecimal = (value: number) => String(Math.round(value * 10) / 10);

/** Days as an Interval shows them: `4d` under a month, `3.5mo` under a year, else `1.2y`. */
function formatDays(days: number): string {
  if (days < 30) return `${Math.max(1, Math.round(days))}d`;
  if (days < 365) return `${oneDecimal(days / 30)}mo`;
  return `${oneDecimal(days / 365)}y`;
}

/**
 * An Interval as a rating button shows it: `10m` under an hour, `5h` under a
 * day, `4d` under a month, `3.5mo` under a year, else `1.2y`. A Card the
 * Rating schedules in days shows its scheduled days (it is due from a Study
 * day's Day start, so the moment would say less); one in its learning steps,
 * the time from `now` to its due moment, at least a minute.
 */
export function formatInterval(preview: IntervalPreview, now: number): string {
  if (preview.state === "review" && preview.scheduledDays >= 1) {
    return formatDays(preview.scheduledDays);
  }
  const minutes = Math.max(0, Date.parse(preview.due) - now) / MINUTE_MS;
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < HOUR_MINUTES) return `${rounded}m`;
  const hours = Math.round(minutes / HOUR_MINUTES);
  if (hours < 24) return `${hours}h`;
  return formatDays(minutes / DAY_MINUTES);
}

/** A Card the Queue shows, with why and each Rating's Interval preview. */
export type NextCard = { card: Card; kind: QueueKind; intervals: IntervalPreviews };

/** How the Session counts what it has shown and the batches it has been given, as `study/next` takes it. */
export type Progress = {
  reviewsShown: number;
  newShown: number;
  batches: number;
  after: string | undefined;
};

/** The next Card, or null at the end of the Queue with the New cards the batch held back. */
export type NextAnswer = { next: NextCard | null; newHeld: number };

/** What the Session needs from the API. Each call throws when Banki can't be reached. */
export type StudyApi = {
  next: (progress: Progress) => Promise<NextAnswer>;
  /** Saves a Rating: its Review's ID, or "gone" when the Card was deleted meanwhile. */
  rate: (
    cardId: string,
    rating: Rating,
    durationMs: number,
  ) => Promise<{ reviewId: string } | "gone">;
  /** Undoes a Review: the Card and its fresh previews, or "gone" when it can't be undone anymore. */
  undo: (reviewId: string) => Promise<{ card: Card; intervals: IntervalPreviews } | "gone">;
};

/** The study API over HTTP. */
export function studyApi(deckId: string, client: ApiClient = api): StudyApi {
  return {
    next: async ({ reviewsShown, newShown, batches, after }) => {
      const res = await client.api.decks[":deckId"].study.next.$get({
        param: { deckId },
        query: {
          reviewsShown: String(reviewsShown),
          newShown: String(newShown),
          batches: String(batches),
          after: after ?? "",
        },
      });
      if (!res.ok) throw new Error(`study/next answered ${res.status}`);
      const { next, newHeld } = StudyNextResponse.parse(await res.json());
      return { next, newHeld };
    },
    rate: async (cardId, rating, durationMs) => {
      const res = await client.api.cards[":id"].reviews.$post({
        param: { id: cardId },
        json: { rating, durationMs },
      });
      // Read as any status: a proxy or a crash can answer one the route doesn't.
      const status: number = res.status;
      if (status === 404) return "gone";
      if (status !== 201) throw new Error(`Rating answered ${status}`);
      return { reviewId: RateCardResponse.parse(await res.json()).review.id };
    },
    undo: async (reviewId) => {
      const res = await client.api.reviews[":id"].$delete({ param: { id: reviewId } });
      const status: number = res.status;
      if (status === 404 || status === 409) return "gone";
      if (status !== 200) throw new Error(`Undo answered ${status}`);
      const { card, intervals } = UndoReviewResponse.parse(await res.json());
      return { card, intervals };
    },
  };
}

export const RATE_FAILED = "Couldn't save your rating. Check your connection.";
export const NEXT_FAILED = "Couldn't load the next card. Check your connection.";
export const CARD_GONE = "That card was deleted elsewhere, so it was skipped.";
export const UNDO_GONE = "That rating can't be undone anymore.";
export const UNDO_FAILED = "Couldn't undo. Check your connection.";
export const MORE_FAILED = "Couldn't load more cards. Check your connection.";

/**
 * Where the Session is: loading its first Card, showing one, done after
 * studying, left early with a Rating standing (until Keep studying), with
 * nothing to study from the start, or unable to load its first Card.
 */
export type Phase = "loading" | "card" | "done" | "left" | "nothing" | "unreachable";

/**
 * What the Session's standing Ratings add up to: the Cards studied (each
 * once) and how many of them were New, the Recall rate's count over the
 * review-kind Cards (null with none), and the time spent on them.
 */
export type SessionSummary = {
  studied: number;
  newStudied: number;
  /** Review-kind Cards whose first standing Rating wasn't Again (`kept`), of all of them (`of`). */
  recall: { kept: number; of: number } | null;
  /** The sum of the standing Reviews' durations. */
  timeMs: number;
};

/** A standing Rating, as the summary counts it. */
export type StandingRating = {
  cardId: string;
  kind: QueueKind;
  rating: Rating;
  durationMs: number;
};

/**
 * The summary of `ratings`, the Session's standing Ratings, oldest first.
 * Each Card counts once, by its first standing Rating: New when it was shown
 * New; for the Recall rate, review-kind and kept when that Rating wasn't
 * Again. Time sums every standing Rating's duration.
 */
export function summaryOf(ratings: readonly StandingRating[]): SessionSummary {
  const first = new Map<string, StandingRating>();
  let timeMs = 0;
  for (const rating of ratings) {
    if (!first.has(rating.cardId)) first.set(rating.cardId, rating);
    timeMs += rating.durationMs;
  }
  const firsts = [...first.values()];
  const reviews = firsts.filter((r) => r.kind === "review");
  return {
    studied: firsts.length,
    newStudied: firsts.filter((r) => r.kind === "new").length,
    recall:
      reviews.length === 0
        ? null
        : { kept: reviews.filter((r) => r.rating !== "again").length, of: reviews.length },
    timeMs,
  };
}

/** The Recall rate as a whole percentage: 22 of 25 → 88. */
export const recallPercent = ({ kept, of }: { kept: number; of: number }) =>
  Math.round((kept / of) * 100);

/** Time spent as the summary shows it: "14 min", or "45 s" under a minute. */
export function spentLabel(ms: number): string {
  if (ms < 59_500) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export type StudyState = {
  phase: Phase;
  /** The Card shown, with why and its previews, in the `card` phase. */
  shown: NextCard | undefined;
  /** When the shown Card's previews arrived, to count their minutes from. */
  previewedAt: number;
  revealed: boolean;
  /** The Rating being saved (until the next Card shows), if any. */
  saving: Rating | undefined;
  /** Set while an Undo is on its way. */
  undoing: boolean;
  /** Why the shown Card is stuck, with Try again: a Rating that didn't save, or the next Card that didn't load. */
  failure: string | undefined;
  /** The Session's Ratings still standing. */
  rated: number;
  /** Whether a Rating can be given now: the Card is revealed and nothing is on its way. */
  ratable: boolean;
  /** Set when the shown Card is back from an Undo, until it is rated. */
  undone: boolean;
  /** In the `done` phase, how many New cards the New-card batch held back; else 0. */
  newHeld: number;
  /** What the standing Ratings add up to. */
  summary: SessionSummary;
  /** Set while another batch's first Card is on its way, from the `done` phase. */
  loadingMore: boolean;
};

/** A Rating the Session gave and can take back. */
type Given = { reviewId: string; shown: NextCard; rating: Rating; durationMs: number };

const standing = (given: readonly Given[]): StandingRating[] =>
  given.map(({ shown, rating, durationMs }) => ({
    cardId: shown.card.id,
    kind: shown.kind,
    rating,
    durationMs,
  }));

/**
 * One Session over a Deck's Queue. `start` loads the first Card; then
 * `reveal`, `rate` and `undo` walk it, `retry` tries again what failed, and
 * `more` takes another New-card batch once the Queue ends with some held.
 * Each Card is timed from when it shows (`now`) to its Rating, a hidden tab
 * included. A Card back from an Undo carries on from the undone Review's
 * time, and the counters stay as they were. `leave` steps out to the summary
 * with a Rating standing, and `resume` comes back to the Card shown, its time
 * paused meanwhile. `notify` shows a passing message (a toast).
 */
export function createStudySession({
  studyApi: client,
  notify,
  now = Date.now,
}: {
  studyApi: StudyApi;
  notify: (message: string) => void;
  now?: () => number;
}) {
  let state: StudyState = {
    phase: "loading",
    shown: undefined,
    previewedAt: 0,
    revealed: false,
    saving: undefined,
    undoing: false,
    failure: undefined,
    rated: 0,
    ratable: false,
    undone: false,
    newHeld: 0,
    loadingMore: false,
    summary: summaryOf([]),
  };
  const listeners = new Set<() => void>();
  const given: Given[] = [];
  // Every Card the Session has shown, so each counts once, by its first kind.
  const seen = new Set<string>();
  let reviewsShown = 0;
  let newShown = 0;
  let batches = 1;
  let shownAt = 0;
  // While left, the time the shown Card had been on screen.
  let pausedFor = 0;
  // What Try again does: save the Rating again, or load the next Card again.
  let failed:
    | { kind: "rate"; rating: Rating; durationMs: number }
    | { kind: "next"; after: string | undefined }
    | undefined;
  // Once stopped (the screen left), answers on their way change nothing. Each
  // start counts, so only the newest one's answer shows.
  let stopped = false;
  let starts = 0;

  const set = (patch: Partial<Omit<StudyState, "rated" | "ratable" | "summary">>) => {
    if (stopped) return;
    const next = { ...state, ...patch };
    state = {
      ...next,
      newHeld: next.phase === "done" ? next.newHeld : 0,
      rated: given.length,
      summary: summaryOf(standing(given)),
      // A Rating that failed can be given again, or another one instead; a
      // Card whose Rating saved, waiting for the next one, can't.
      ratable:
        next.phase === "card" &&
        next.revealed &&
        next.saving === undefined &&
        !next.undoing &&
        failed?.kind !== "next",
    };
    for (const listener of listeners) listener();
  };

  const busy = () =>
    state.saving !== undefined || state.undoing || state.loadingMore || state.phase === "loading";

  /** Shows the next Card, or the end of the Queue; while left, keeps it for Keep studying. */
  const show = ({ next, newHeld }: NextAnswer) => {
    failed = undefined;
    if (next === null) {
      const studied = seen.size > 0;
      set({
        phase: studied ? "done" : "nothing",
        shown: undefined,
        revealed: false,
        saving: undefined,
        failure: undefined,
        undone: false,
        newHeld,
        loadingMore: false,
      });
      return;
    }
    if (!seen.has(next.card.id)) {
      seen.add(next.card.id);
      if (next.kind === "new") newShown += 1;
      if (next.kind === "review") reviewsShown += 1;
    }
    shownAt = now();
    pausedFor = 0;
    set({
      phase: state.phase === "left" ? "left" : "card",
      shown: next,
      previewedAt: shownAt,
      revealed: false,
      saving: undefined,
      failure: undefined,
      undone: false,
      loadingMore: false,
    });
  };

  /** Loads and shows the Card after `after`; on failure, says so on the Card still shown. */
  const loadNext = async (after: string | undefined) => {
    try {
      show(await client.next({ reviewsShown, newShown, batches, after }));
    } catch {
      failed = { kind: "next", after };
      set({ saving: undefined, failure: NEXT_FAILED });
    }
  };

  /** Loads another batch's first Card; on failure, says so and keeps the batches as they were. */
  const loadMore = async () => {
    let answer: NextAnswer;
    try {
      answer = await client.next({
        reviewsShown,
        newShown,
        batches: batches + 1,
        after: undefined,
      });
    } catch {
      notify(MORE_FAILED);
      set({ loadingMore: false });
      return;
    }
    batches += 1;
    show(answer);
  };

  async function start() {
    stopped = false;
    starts += 1;
    const mine = starts;
    let first: NextAnswer;
    try {
      first = await client.next({ reviewsShown, newShown, batches, after: undefined });
    } catch {
      if (mine === starts) set({ phase: "unreachable" });
      return;
    }
    if (mine === starts) show(first);
  }

  const save = async (rating: Rating, durationMs: number) => {
    const shown = state.shown;
    if (shown === undefined) return;
    set({ saving: rating, failure: undefined });
    let saved: Awaited<ReturnType<StudyApi["rate"]>>;
    try {
      saved = await client.rate(shown.card.id, rating, durationMs);
    } catch {
      failed = { kind: "rate", rating, durationMs };
      set({ saving: undefined, failure: RATE_FAILED });
      return;
    }
    if (saved === "gone") notify(CARD_GONE);
    else given.push({ reviewId: saved.reviewId, shown, rating, durationMs });
    await loadNext(shown.card.id);
  };

  return {
    getState: (): StudyState => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Loads the first Card; once stopped, starts again from there. */
    start,
    /** Shows the Back of the Card shown. */
    reveal() {
      if (state.phase === "card" && !state.revealed) set({ revealed: true });
    },
    /** Rates the revealed Card, then shows the next one once the Rating saved. */
    rate(rating: Rating) {
      if (!state.ratable) return;
      void save(rating, Math.max(0, Math.round(now() - shownAt)));
    },
    /** Tries again what failed: the Rating, or loading the next Card. */
    retry() {
      if (busy()) return;
      if (state.phase === "unreachable") {
        set({ phase: "loading" });
        void start();
        return;
      }
      const what = failed;
      if (what?.kind === "rate") void save(what.rating, what.durationMs);
      if (what?.kind === "next") {
        set({ failure: undefined });
        void loadNext(what.after);
      }
    },
    /**
     * At the end of a Queue that held New cards back, takes another batch of
     * them and shows the next Card, the counters and Undo as they were; with
     * none back, the end shows again. One that can't load says so and leaves
     * the batch as it was.
     */
    more() {
      if (state.phase !== "done" || state.newHeld === 0 || busy()) return;
      set({ loadingMore: true });
      void loadMore();
    },
    /** Whether a Rating of this Session is still standing to take back. */
    canUndo: () => given.length > 0,
    /**
     * Takes back the newest Rating still standing: its Review is deleted and
     * its Card comes back revealed, with fresh previews. One that can't be
     * undone anymore (gone elsewhere) is dropped, with a message.
     */
    async undo() {
      const last = given.at(-1);
      if (last === undefined || busy()) return;
      set({ undoing: true });
      let back: Awaited<ReturnType<StudyApi["undo"]>>;
      try {
        back = await client.undo(last.reviewId);
      } catch {
        notify(UNDO_FAILED);
        set({ undoing: false });
        return;
      }
      given.pop();
      if (back === "gone") {
        notify(UNDO_GONE);
        set({ undoing: false });
        return;
      }
      failed = undefined;
      // The re-rated Review's time is the undone one's plus the time since.
      shownAt = now() - last.durationMs;
      set({
        phase: "card",
        shown: { card: back.card, kind: last.shown.kind, intervals: back.intervals },
        previewedAt: now(),
        revealed: true,
        saving: undefined,
        undoing: false,
        failure: undefined,
        undone: true,
      });
    },
    /**
     * Leaving the study screen (Esc, or ×): with a Rating standing, while a
     * Card is shown, the summary shows instead ("summary"), the Card's time
     * paused; otherwise the screen goes ("away").
     */
    leave(): "summary" | "away" {
      if (state.phase !== "card" || given.length === 0) return "away";
      pausedFor = now() - shownAt;
      set({ phase: "left" });
      return "summary";
    },
    /** Keep studying: back from the summary to the Card shown when it was left, its time going on. */
    resume() {
      if (state.phase !== "left") return;
      shownAt = now() - pausedFor;
      set({ phase: "card" });
    },
    /** Stops it: answers still on their way change nothing, until it starts again. */
    stop() {
      stopped = true;
    },
  };
}

export type StudySession = ReturnType<typeof createStudySession>;

/** What a key press on the study screen does. */
export type KeyAction =
  | { type: "reveal" }
  | { type: "rate"; rating: Rating }
  | { type: "undo" }
  | { type: "leave" }
  /** Keeps the key from doing what it would: Space or Enter on a focused rating button. */
  | { type: "block" }
  | { type: "none" };

/**
 * What a key does on the study screen, given whether a Card is shown, whether
 * it is revealed, and what has the focus: Space or Enter reveals a shown Card;
 * once revealed, 1 to 4 rate (Again, Hard, Good, Easy); Ctrl/⌘+Z undoes; Esc
 * leaves. Space and Enter never rate, not even on a focused rating button, and
 * on another focused control (a link, a button) they do what they do there.
 */
export function keyAction(
  key: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  {
    showing,
    revealed,
    focus,
  }: { showing: boolean; revealed: boolean; focus: "rating" | "control" | undefined },
): KeyAction {
  if ((key.ctrlKey || key.metaKey) && !key.altKey && key.key.toLowerCase() === "z") {
    return { type: "undo" };
  }
  if (key.ctrlKey || key.metaKey || key.altKey) return { type: "none" };
  if (key.key === "Escape") return { type: "leave" };
  if (key.key === " " || key.key === "Enter") {
    if (focus === "rating") return { type: "block" };
    if (focus === "control" || !showing || revealed) return { type: "none" };
    return { type: "reveal" };
  }
  if (!revealed) return { type: "none" };
  const rating = RATINGS.find((r) => RATING_KEYS[r] === key.key);
  return rating === undefined ? { type: "none" } : { type: "rate", rating };
}

/** The part of a clicked element a click on the Card looks at. */
type Clicked = {
  closest: (selector: string) => { getAttribute: (name: string) => string | null } | null;
};

/** What a click or tap on the Card does. */
export type CardClickAction =
  | { type: "reveal" }
  | { type: "copy"; source: string }
  | { type: "none" };

/**
 * What a click or tap on the Card does: anywhere before the reveal, it
 * reveals; once revealed, on a Formula it copies the Formula as written, on a
 * link it leaves the link to open, and anywhere else it does nothing. A
 * Formula inside a link never copies.
 */
export function cardClickAction(
  target: Clicked,
  { revealed }: { revealed: boolean },
): CardClickAction {
  if (!revealed) return { type: "reveal" };
  if (target.closest("a") !== null) return { type: "none" };
  const source = target.closest("[data-formula]")?.getAttribute("data-formula");
  return source === null || source === undefined ? { type: "none" } : { type: "copy", source };
}

/** Copies a Formula's source, saying "Copied", or "Couldn't copy" when the browser refuses. */
export async function copyFormula(
  source: string,
  {
    clipboard,
    notify,
  }: { clipboard: Pick<Clipboard, "writeText"> | undefined; notify: (message: string) => void },
): Promise<void> {
  try {
    if (clipboard === undefined) throw new Error("No clipboard");
    await clipboard.writeText(source);
    notify("Copied");
  } catch {
    notify("Couldn't copy");
  }
}
