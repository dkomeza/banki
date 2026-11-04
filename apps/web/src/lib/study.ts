import {
  type IntervalPreview,
  type IntervalPreviews,
  type QueueKind,
  IntervalPreviews as IntervalPreviewsSchema,
  RATINGS,
  RateCardResponse,
  type Rating,
  StudyNextResponse,
  UndoReviewResponse,
} from "@banki/shared";
import { type ApiClient, api } from "./api";
import { type Card, type CardOutcome, saveCardEdit } from "./cards";

// The study screen's Session (CONTEXT.md: Session, Queue, Interval, New-card
// batch): it walks a Deck's Queue Card by Card, asking the API for each next
// Card, and keeps the Ratings it gave so Undo can take them back, newest
// first. Where the Queue ends with New cards held back, it can take another
// batch and carry on. The shown Card can be edited without leaving it, and a
// studied one put back to New (a Progress reset). Left early, or at the end
// of the Queue, it sums up the Ratings still standing (the summary). Nothing
// here touches the page, so it is tested without one.

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
  /**
   * Undoes a Review: the Card and its fresh previews; "gone" when the Review
   * is gone (deleted elsewhere, or its Card), or "settled" when it stands but
   * can't be undone anymore (a newer Review, or a Progress reset since).
   */
  undo: (
    reviewId: string,
  ) => Promise<{ card: Card; intervals: IntervalPreviews } | "gone" | "settled">;
  /** A Card's previews as it is now, or "gone" when it was deleted meanwhile. */
  intervals: (cardId: string) => Promise<IntervalPreviews | "gone">;
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
      if (status === 404) return "gone";
      if (status === 409) return "settled";
      if (status !== 200) throw new Error(`Undo answered ${status}`);
      const { card, intervals } = UndoReviewResponse.parse(await res.json());
      return { card, intervals };
    },
    intervals: async (cardId) => {
      const res = await client.api.cards[":id"].intervals.$get({ param: { id: cardId } });
      const status: number = res.status;
      if (status === 404) return "gone";
      if (status !== 200) throw new Error(`Intervals answered ${status}`);
      return IntervalPreviewsSchema.parse(await res.json());
    },
  };
}

export const RATE_FAILED = "Couldn't save your rating. Check your connection.";
export const NEXT_FAILED = "Couldn't load the next card. Check your connection.";
export const CARD_GONE = "That card was deleted elsewhere, so it was skipped.";
export const UNDO_GONE = "That rating can't be undone anymore.";
export const UNDO_FAILED = "Couldn't undo. Check your connection.";
export const MORE_FAILED = "Couldn't load more cards. Check your connection.";
export const INTERVALS_FAILED = "Couldn't load the card's new intervals. Check your connection.";
export const EDITOR_FAILED = "Couldn't open the editor. Check your connection.";

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
  /** Whether a standing Rating is left that Undo can try to take back. */
  undoable: boolean;
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
  /** Set while the editor is open over the shown Card. */
  editing: boolean;
  /** Whether the editor can open now: a Card is shown and nothing is on its way. */
  editable: boolean;
  /** Set when the shown Card was just put back to New from the editor, until it is rated. */
  progressReset: boolean;
  /** Set on the close that follows a Progress reset alone, so its Intervals turn over once. */
  turning: boolean;
  /**
   * Set while the next Card is on its way in place of the one shown, which is
   * done with: deleted from the editor, or rated when Try again loads the next.
   */
  skipping: boolean;
  /** Set while a reset Card's previews load again (Try again). */
  refreshing: boolean;
};

/**
 * A Rating the Session gave and can take back, until it stands for good
 * (`settled`): the API says so (a newer Review of its Card, or a Progress
 * reset since), the Session saved a Progress reset of its Card, or an Undo
 * of it found its Card deleted from the Session (`gone`).
 */
type Given = {
  reviewId: string;
  shown: NextCard;
  rating: Rating;
  durationMs: number;
  settled?: boolean;
};

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
 * paused meanwhile. `edit` opens the editor over the shown Card, its time
 * paused while it is open, and `cancelEdit`, `saveEdit` and `closeGone`
 * close it. `notify` shows a passing message (a toast).
 */
export function createStudySession({
  studyApi: client,
  notify,
  now = Date.now,
  transition = (update) => update(),
}: {
  studyApi: StudyApi;
  notify: (message: string) => void;
  now?: () => number;
  /** Runs the change of opening or closing the editor, such as in a View Transition. */
  transition?: (update: () => void) => void;
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
    undoable: false,
    ratable: false,
    undone: false,
    newHeld: 0,
    loadingMore: false,
    summary: summaryOf([]),
    editing: false,
    editable: false,
    progressReset: false,
    turning: false,
    skipping: false,
    refreshing: false,
  };
  const listeners = new Set<() => void>();
  const given: Given[] = [];
  // Every Card the Session has shown, with its first kind, so each counts once, by it.
  const seen = new Map<string, QueueKind>();
  // The kind each Card put back to New here came with: served again by the
  // Queue (after an Undo took its place), it still counts as that kind.
  const resetKinds = new Map<string, QueueKind>();
  // The Cards seen deleted: their Reviews stand (ADR-0018), so an Undo of one
  // that answers 404 keeps its Rating counting.
  const gone = new Set<string>();
  let reviewsShown = 0;
  let newShown = 0;
  let batches = 1;
  let shownAt = 0;
  // While left, the time the shown Card had been on screen.
  let pausedFor = 0;
  // Whether the editor is open, at once: `transition` may show it a frame
  // later. And when it opened, to leave its time out of the Card's.
  let editorOpen = false;
  let editedAt = 0;
  // What Try again does: save the Rating again, load the next Card again, or
  // load a reset Card's previews again.
  let failed:
    | { kind: "rate"; rating: Rating; durationMs: number }
    | { kind: "next"; after: string | undefined }
    | { kind: "intervals"; cardId: string }
    | undefined;
  // Once stopped (the screen left), answers on their way change nothing. Each
  // start counts, so only the newest one's answer shows.
  let stopped = false;
  let starts = 0;
  const say = (message: string) => {
    if (!stopped) notify(message);
  };

  const set = (
    patch: Partial<Omit<StudyState, "rated" | "undoable" | "ratable" | "summary" | "editable">>,
  ) => {
    if (stopped) return;
    const next = { ...state, ...patch };
    state = {
      ...next,
      newHeld: next.phase === "done" ? next.newHeld : 0,
      rated: given.length,
      undoable: given.some((g) => !g.settled),
      summary: summaryOf(standing(given)),
      // A Rating that failed can be given again, or another one instead; a
      // Card whose Rating saved, waiting for the next one, can't.
      ratable:
        next.phase === "card" &&
        next.revealed &&
        next.saving === undefined &&
        !next.undoing &&
        !next.editing &&
        !next.skipping &&
        !next.refreshing &&
        failed?.kind !== "next" &&
        failed?.kind !== "intervals",
      // Not on a Card whose Rating saved, waiting for the next one: it is done.
      editable:
        next.phase === "card" &&
        next.saving === undefined &&
        !next.undoing &&
        !next.editing &&
        !next.skipping &&
        !next.refreshing &&
        failed?.kind !== "next",
    };
    for (const listener of listeners) listener();
  };

  const busy = () =>
    state.saving !== undefined ||
    state.undoing ||
    state.loadingMore ||
    editorOpen ||
    state.skipping ||
    state.refreshing ||
    state.phase === "loading";

  /** Shows the next Card, or the end of the Queue; while left, keeps it for Keep studying. */
  const show = ({ next: served, newHeld }: NextAnswer) => {
    failed = undefined;
    const kind = served === null ? undefined : resetKinds.get(served.card.id);
    const next = served === null || kind === undefined ? served : { ...served, kind };
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
        undoing: false,
        progressReset: false,
        turning: false,
        skipping: false,
        refreshing: false,
        // Closed a frame ago (closeEditor), it doesn't open on what follows.
        editing: state.editing && editorOpen,
      });
      return;
    }
    if (!seen.has(next.card.id)) {
      seen.set(next.card.id, next.kind);
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
      undoing: false,
      progressReset: false,
      turning: false,
      skipping: false,
      refreshing: false,
      // Closed a frame ago (closeEditor), it doesn't open on the next Card.
      editing: state.editing && editorOpen,
    });
  };

  /** Loads and shows the Card after `after`; on failure, says so on the Card still shown. */
  const loadNext = async (after: string | undefined) => {
    // Gone from the screen, or started again since: nothing is left to show it on.
    if (stopped) return;
    const mine = starts;
    let answer: NextAnswer;
    try {
      answer = await client.next({ reviewsShown, newShown, batches, after });
    } catch {
      if (stopped || mine !== starts) return;
      failed = { kind: "next", after };
      set({ saving: undefined, skipping: false, failure: NEXT_FAILED });
      return;
    }
    if (!stopped && mine === starts) show(answer);
  };

  /** Loads another batch's first Card; on failure, says so and keeps the batches as they were. */
  const loadMore = async () => {
    const mine = starts;
    let answer: NextAnswer;
    try {
      answer = await client.next({
        reviewsShown,
        newShown,
        batches: batches + 1,
        after: undefined,
      });
    } catch {
      // Started again since, the batch was another Session's.
      if (mine !== starts) return;
      say(MORE_FAILED);
      set({ loadingMore: false });
      return;
    }
    if (mine !== starts) return;
    batches += 1;
    show(answer);
  };

  async function start() {
    stopped = false;
    starts += 1;
    // Started again with the editor open (a restart, dev only): it closes on
    // the first Card (`show`), and a Save on its way changes nothing.
    editorOpen = false;
    const mine = starts;
    let first: NextAnswer;
    try {
      first = await client.next({ reviewsShown, newShown, batches, after: undefined });
    } catch {
      // What was on its way before the restart can't clear itself, so Try again isn't held.
      if (mine === starts) {
        set({
          phase: "unreachable",
          editing: false,
          skipping: false,
          refreshing: false,
          saving: undefined,
          undoing: false,
          loadingMore: false,
        });
      }
      return;
    }
    if (mine === starts) show(first);
  }

  /**
   * Skipping the shown Card `cardId`, gone: what was said about it (a failure and its
   * Try again, "rate it again", "Back to New") goes with it while the next
   * one loads.
   */
  const skipGone = (cardId: string): Partial<StudyState> => {
    gone.add(cardId);
    failed = undefined;
    return { skipping: true, failure: undefined, undone: false, progressReset: false };
  };

  /**
   * Try again for a reset Card's previews: shows them as it is now; one
   * deleted meanwhile is skipped. Started again since, the answer is for a
   * Card no longer shown, and changes nothing.
   */
  const refresh = async (cardId: string) => {
    const mine = starts;
    set({ refreshing: true, failure: undefined });
    let fresh: Awaited<ReturnType<StudyApi["intervals"]>>;
    try {
      fresh = await client.intervals(cardId);
    } catch {
      if (mine === starts) set({ refreshing: false, failure: INTERVALS_FAILED });
      return;
    }
    if (mine !== starts) return;
    if (fresh === "gone") {
      say(CARD_GONE);
      set({ refreshing: false, ...skipGone(cardId) });
      await loadNext(cardId);
      return;
    }
    const shown = state.shown;
    if (shown === undefined || shown.card.id !== cardId) {
      set({ refreshing: false });
      return;
    }
    failed = undefined;
    set({
      shown: { ...shown, intervals: fresh },
      previewedAt: now(),
      failure: undefined,
      refreshing: false,
      turning: false,
    });
  };

  /**
   * Closes the editor with `patch`, its time left out of the Card's. The
   * patch may show a frame later (`transition`), so it holds nothing the
   * Session changes again on its own.
   */
  const closeEditor = (patch: Partial<StudyState>) => {
    if (!editorOpen) return;
    editorOpen = false;
    shownAt += now() - editedAt;
    // Gone from the screen, nothing is left to move.
    if (!stopped) transition(() => set({ turning: false, ...patch, editing: false }));
  };

  const save = async (rating: Rating, durationMs: number) => {
    const shown = state.shown;
    if (shown === undefined) return;
    set({ saving: rating, failure: undefined });
    const mine = starts;
    let saved: Awaited<ReturnType<StudyApi["rate"]>>;
    try {
      saved = await client.rate(shown.card.id, rating, durationMs);
    } catch {
      // Started again since, the Rating was another Session's.
      if (mine !== starts) return;
      failed = { kind: "rate", rating, durationMs };
      set({ saving: undefined, failure: RATE_FAILED });
      return;
    }
    if (mine !== starts) return;
    if (saved === "gone") {
      gone.add(shown.card.id);
      say(CARD_GONE);
    } else given.push({ reviewId: saved.reviewId, shown, rating, durationMs });
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
      if (state.phase === "card" && !state.revealed && !editorOpen) set({ revealed: true });
    },
    /** Rates the revealed Card, then shows the next one once the Rating saved. */
    rate(rating: Rating) {
      if (!state.ratable || editorOpen) return;
      void save(rating, Math.max(0, Math.round(now() - shownAt)));
    },
    /**
     * Tries again what failed: the Rating, loading the next Card, or loading a
     * reset Card's fresh Intervals.
     */
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
        // Its answer replaces the Card shown, so nothing else may change it meanwhile.
        set({ failure: undefined, skipping: true });
        void loadNext(what.after);
      }
      if (what?.kind === "intervals") void refresh(what.cardId);
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
    canUndo: () => state.undoable,
    /**
     * Takes back the newest Rating still standing: its Review is deleted and
     * its Card comes back revealed, with fresh previews. One that can't be
     * undone anymore says so: gone elsewhere, it is dropped; still standing
     * (its Card deleted, or a newer Review or a Progress reset since), it
     * keeps counting, as do its Card's earlier Ratings, and the next Undo goes
     * on to the Rating before them.
     */
    async undo() {
      const last = given.findLast((g) => !g.settled);
      if (last === undefined || busy()) return;
      set({ undoing: true });
      const mine = starts;
      let back: Awaited<ReturnType<StudyApi["undo"]>>;
      try {
        back = await client.undo(last.reviewId);
      } catch {
        // Started again since, another Card shows: the Undo was the old one's.
        if (mine !== starts) return;
        say(UNDO_FAILED);
        set({ undoing: false });
        return;
      }
      // Started again since, another Card shows: what the answer says of the
      // Rating still counts, but the screen stays as it is.
      const current = mine === starts;
      if (back === "gone" || back === "settled") {
        const cardId = last.shown.card.id;
        // Its Review gone (undone elsewhere), it no longer counts. Still
        // standing, under a deleted Card or a newer Review or Progress reset,
        // none of the Card's Ratings can be undone, and they keep counting.
        if (back === "gone" && !gone.has(cardId)) given.splice(given.indexOf(last), 1);
        else for (const g of given) if (g.shown.card.id === cardId) g.settled = true;
        if (!current) return set({});
        say(UNDO_GONE);
        set({ undoing: false });
        return;
      }
      given.splice(given.indexOf(last), 1);
      if (!current) return set({});
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
        progressReset: false,
        turning: false,
      });
    },
    /**
     * Opens the editor over the shown Card, before or after the reveal; not
     * while a Rating or an Undo is on its way. Its time is left out of the
     * Card's. Answers whether it opened.
     */
    edit(): boolean {
      if (stopped || !state.editable || editorOpen) return false;
      editorOpen = true;
      editedAt = now();
      // The Intervals turned over on the last close: done, before this
      // transition sees the screen, or they'd move apart from the dock.
      if (state.turning) set({ turning: false });
      const mine = starts;
      transition(() => {
        // Stopped before this frame, the editor never opened: a start that
        // follows mustn't wait for it to close. Started again since, the
        // start closed it already, and it doesn't open on the new Card.
        if (stopped) editorOpen = false;
        else if (mine === starts && editorOpen) set({ editing: true });
      });
      return true;
    },
    /** Closes the editor, the Card shown as it was. */
    cancelEdit() {
      closeEditor({});
    },
    /**
     * Closes the editor on the Card as saved, revealed or not as it was, with
     * its previews unchanged. After a Progress reset (`progressReset`), the
     * editor stays open until the Card's fresh previews are in from the API,
     * and it shows revealed, as New, still counting as the kind it first came
     * with; previews that don't load leave it unratable until Try again, and a
     * Card deleted meanwhile is skipped. The Card's earlier Ratings then stand
     * for good, as the API won't undo them. Answers once the editor is closed.
     */
    async saveEdit(card: Card, { progressReset }: { progressReset: boolean }) {
      if (!editorOpen || state.shown === undefined) return;
      if (!progressReset) {
        closeEditor({ shown: { ...state.shown, card } });
        return;
      }
      for (const g of given) if (g.shown.card.id === card.id) g.settled = true;
      resetKinds.set(card.id, seen.get(card.id) ?? state.shown.kind);
      const mine = starts;
      let fresh: Awaited<ReturnType<StudyApi["intervals"]>> | undefined;
      try {
        fresh = await client.intervals(card.id);
      } catch {
        fresh = undefined;
      }
      const shown = state.shown;
      // Started again since, the editor open now isn't this one.
      if (!editorOpen || mine !== starts || shown?.card.id !== card.id) return;
      if (fresh === "gone") {
        say(CARD_GONE);
        set(skipGone(card.id));
        closeEditor({});
        await loadNext(card.id);
        return;
      }
      failed = fresh === undefined ? { kind: "intervals", cardId: card.id } : undefined;
      closeEditor({
        // Previews that failed are the old ones, still counted from when they came.
        shown: { ...shown, card, intervals: fresh ?? shown.intervals },
        previewedAt: fresh === undefined ? state.previewedAt : now(),
        revealed: true,
        undone: false,
        progressReset: true,
        // Only fresh previews turn over: those that failed are the old ones.
        turning: fresh !== undefined,
        failure: fresh === undefined ? INTERVALS_FAILED : undefined,
      });
    },
    /**
     * The shown Card is gone, deleted from the editor or elsewhere: closes the
     * editor and loads the next Card.
     */
    async closeGone() {
      const shown = state.shown;
      if (!editorOpen || shown === undefined) return;
      set(skipGone(shown.card.id));
      closeEditor({});
      await loadNext(shown.card.id);
    },
    /**
     * Leaving the study screen (Esc, or ×): with a Rating standing, while a
     * Card is shown, the summary shows instead ("summary"), the Card's time
     * paused; otherwise the screen goes ("away"). With the editor opening (it
     * may show a frame later), nothing happens ("stay").
     */
    leave(): "summary" | "away" | "stay" {
      if (editorOpen) return "stay";
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

/**
 * Save in the study editor: writes the shown Card `card` (`saveCardEdit`,
 * with a Progress reset when ticked on a studied one), then, once `saved`
 * has run (the discard guard letting go), closes the editor on it as saved,
 * reset or not (`saveEdit`). Answers how it went; one that didn't save
 * leaves the editor open.
 */
export const saveStudyEdit = (
  session: Pick<StudySession, "saveEdit">,
  card: Card,
  ticked: boolean,
  update: (options: { resetProgress: boolean }) => Promise<CardOutcome>,
  saved: () => void,
): Promise<CardOutcome> =>
  saveCardEdit(card, ticked, update, async (savedCard, progressReset) => {
    saved();
    await session.saveEdit(savedCard, { progressReset });
  });

/**
 * Opens the editor on the shown Card once `ready` (the Deck's Cards the
 * editor reads) is in, as it can't show without them. Not when, meanwhile,
 * the Card shown changed (a Rating, an Undo), the User stepped out to the
 * summary (`leave`, even if they came back), another press came, or the
 * screen went (`stop`); Cards that don't load say so (`notify`) instead.
 */
export function editorOpener({
  session,
  ready,
  notify,
}: {
  session: Pick<StudySession, "getState" | "subscribe" | "edit">;
  ready: () => Promise<unknown>;
  notify: (message: string) => void;
}) {
  let presses = 0;
  let live = true;
  // The newest press's watch for a step out to the summary; a newer press ends it.
  let unwatch: (() => void) | undefined;
  return {
    open: () => {
      presses += 1;
      const mine = presses;
      const asked = session.getState().shown;
      let left = false;
      unwatch?.();
      const unsubscribe = session.subscribe(() => {
        if (session.getState().phase === "left") left = true;
      });
      unwatch = unsubscribe;
      const current = () => live && mine === presses;
      void ready()
        .then(
          () => {
            if (current() && !left && session.getState().shown === asked) session.edit();
          },
          () => {
            if (current()) notify(EDITOR_FAILED);
          },
        )
        .finally(unsubscribe);
    },
    /** Mounted again (a remount): opens as before. */
    start: () => {
      live = true;
    },
    /** The screen went: answers on their way open nothing and say nothing. */
    stop: () => {
      live = false;
      unwatch?.();
    },
  };
}

/**
 * Whether a key is E, the editor's: the letter e, or, on a layout whose key
 * there types no Latin letter (Russian, Greek), the key where E is.
 */
export function isEditKey({ key, code }: { key: string; code?: string }): boolean {
  if (key.toLowerCase() === "e") return true;
  return code === "KeyE" && /^\p{L}$/u.test(key) && !/\p{Script=Latin}/u.test(key);
}

/** What a key press on the study screen does. */
export type KeyAction =
  | { type: "reveal" }
  | { type: "rate"; rating: Rating }
  | { type: "undo" }
  | { type: "edit" }
  | { type: "leave" }
  /** Keeps the key from doing what it would: Space or Enter on a focused rating button. */
  | { type: "block" }
  | { type: "none" };

/**
 * What a key does on the study screen, given whether a Card is shown, whether
 * it is revealed, and what has the focus: Space or Enter reveals a shown Card;
 * once revealed, 1 to 4 rate (Again, Hard, Good, Easy); E edits a shown Card,
 * revealed or not; Ctrl/⌘+Z undoes; Esc leaves. Space and Enter never rate, not even on a focused rating button, and
 * on another focused control (a link, a button) they do what they do there.
 */
export function keyAction(
  key: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  {
    showing,
    revealed,
    focus,
    editing = false,
  }: {
    showing: boolean;
    revealed: boolean;
    focus: "rating" | "control" | undefined;
    /** While the editor is open, every key is its own, Esc included. */
    editing?: boolean;
  },
): KeyAction {
  if (editing) return { type: "none" };
  if ((key.ctrlKey || key.metaKey) && !key.altKey && key.key.toLowerCase() === "z") {
    return { type: "undo" };
  }
  if (key.ctrlKey || key.metaKey || key.altKey) return { type: "none" };
  if (key.key === "Escape") return { type: "leave" };
  if (isEditKey(key)) return showing ? { type: "edit" } : { type: "none" };
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

/**
 * What closing the study screen's editor (Cancel, ×, Esc) does: with the
 * Card deleted elsewhere, skips to the next one; with something unsaved, asks
 * first (the discard guard); else closes it on the Card as it was.
 */
export function editorCloseAction({
  gone,
  unsaved,
}: {
  gone: boolean;
  unsaved: boolean;
}): "skip" | "ask" | "close" {
  if (gone) return "skip";
  return unsaved ? "ask" : "close";
}

/**
 * What Esc does in the study screen's editor, given the Front or Back field it
 * was pressed in (`null` anywhere else in the panel) and the field where the
 * key just before it was a lone Esc (`armed`): in a field, the first Esc only
 * leaves it, so Tab moves on (CodeMirror's Esc-then-Tab), and a second closes
 * the editor; anywhere else, Esc closes it at once.
 */
export function editorEscAction<F>(field: F | null, armed: F | null): "leave-field" | "close" {
  return field !== null && field !== armed ? "leave-field" : "close";
}

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
