import {
  type AnswerMode,
  DEFAULT_ANSWER_MODE,
  type IntervalPreview,
  type IntervalPreviews,
  type QueueKind,
  IntervalPreviews as IntervalPreviewsSchema,
  CardResponse,
  RATINGS,
  REVIEW_CAP_MS,
  RateCardResponse,
  type Rating,
  StudyNextResponse,
  UndoReviewResponse,
} from "@banki/shared";
import { type ApiClient, api } from "./api";
import { type Card, type CardOutcome, saveCardEdit } from "./cards";
import {
  NO_STORE,
  type SessionStore,
  newId,
  type StoredSession,
  type StoredShown,
  timeoutMsOf,
} from "./session-store";

// The study screen's Session (CONTEXT.md: Session, Queue, Interval, New-card
// batch): it walks a Deck's Queue Card by Card, asking the API for each next
// Card, and keeps the Ratings it gave so Undo can take them back, newest
// first. Where the Queue ends with New cards held back, it can take another
// batch and carry on. The shown Card can be edited without leaving it, and a
// studied one put back to New (a Progress reset). Each Card is answered in
// the Session's Answer mode: self-rate (reveal, then rate) or write-and-grade
// (a Written answer, then Check and rate, or I don't know). Left early, or at the end
// of the Queue, it sums up the Ratings still standing (the summary). It
// saves itself to the browser on every change and resumes from there, until
// it goes a Session timeout without activity (ADR-0027). Nothing here
// touches the page, so it is tested without one.

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
  /** A Card as it is now, or "gone" when it was deleted or moved to another Deck meanwhile. */
  card: (cardId: string) => Promise<Card | "gone">;
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
    card: async (cardId) => {
      const res = await client.api.cards[":id"].$get({ param: { id: cardId } });
      const status: number = res.status;
      if (status === 404) return "gone";
      if (status !== 200) throw new Error(`Card answered ${status}`);
      const card = CardResponse.parse(await res.json());
      return card.deckId === deckId ? card : "gone";
    },
  };
}

/** Whether a Written answer is blank: nothing but whitespace. */
export const isBlank = (text: string) => text.trim() === "";

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
 * nothing to study from the start, unable to load its first Card, or ended by
 * the Session timeout with a Rating standing (until a new Session starts).
 */
export type Phase = "loading" | "card" | "done" | "left" | "nothing" | "unreachable" | "ended";

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
  /** In the `ended` phase, the Session timeout that ended it, in ms; else 0. */
  endedAfterMs: number;
  /** The Session's Answer mode, which every Card after the switch is answered in. */
  mode: AnswerMode;
  /** The shown Card's Written answer as typed so far, in write-and-grade. */
  draft: string;
  /** The Written answer the shown Card was checked with, shown read-only beside the Back; else undefined. */
  written: string | undefined;
  /** Set once I don't know rated the shown Card Again (while it saves too), until the next Card shows. */
  dontKnow: boolean;
  /** Whether the Answer mode can switch now: a Card is shown, not revealed yet, the editor closed. */
  switchable: boolean;
  /** Whether Check can reveal now: write-and-grade, a Written answer that isn't blank, nothing on its way. */
  checkable: boolean;
};

/**
 * A Rating the Session gave and can take back, until it stands for good
 * (`settled`): the API says so (a newer Review of its Card, or a Progress
 * reset since), the Session saved a Progress reset of its Card, or an Undo
 * of it found its Card deleted from the Session (`gone`).
 */
type Given = StandingRating & { reviewId: string; settled: boolean };

const standing = (given: readonly Given[]): StandingRating[] =>
  given.map(({ cardId, kind, rating, durationMs }) => ({ cardId, kind, rating, durationMs }));

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
 *
 * Each change is saved to `store`, and the first `start` resumes what it
 * holds: the counters, batches, Ratings and the Card shown, as it was (re-read,
 * with fresh previews), or the next Card when its Queue had run out. Only the
 * Session timeout (`timeoutMs`, since the last activity: a Card shown, a
 * reveal, a Rating, an Undo, another batch, Keep studying, an edit saved)
 * ends it. Past it, opening it starts afresh; on a screen still open
 * (`checkTimeout`, and each action), it ends on its summary with a Rating
 * standing (`ended`, until `restart`), or quietly starts afresh without one.
 * Each Card's time is at most `REVIEW_CAP_MS`.
 */
/** A Card not answered yet: no draft, no Written answer, no I don't know. */
const UNANSWERED = { draft: "", written: undefined, dontKnow: false } as const;

export function createStudySession({
  studyApi: client,
  notify,
  now = Date.now,
  transition = (update) => update(),
  store = NO_STORE,
  timeoutMs = () => timeoutMsOf(undefined),
  answerMode = () => DEFAULT_ANSWER_MODE,
}: {
  studyApi: StudyApi;
  notify: (message: string) => void;
  now?: () => number;
  /** Runs the change of opening or closing the editor, such as in a View Transition. */
  transition?: (update: () => void) => void;
  /** Where the Session is saved, to resume from; nowhere by default. */
  store?: SessionStore;
  /** The Session timeout as it is now, in ms. */
  timeoutMs?: () => number;
  /** The Deck's Answer mode as it is now, which a new Session starts in. */
  answerMode?: () => AnswerMode;
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
    endedAfterMs: 0,
    mode: answerMode(),
    draft: "",
    written: undefined,
    dontKnow: false,
    switchable: false,
    checkable: false,
  };
  const listeners = new Set<() => void>();
  const given: Given[] = [];
  // Takes `g` out of `given`; taken out already (an Undo answered twice, after
  // a restart), nothing else goes.
  const drop = (g: Given) => {
    const at = given.indexOf(g);
    if (at !== -1) given.splice(at, 1);
  };
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
    | { kind: "rate"; rating: Rating; durationMs: number; wait: boolean }
    | { kind: "next"; after: string | undefined }
    | { kind: "intervals"; cardId: string }
    | undefined;
  // Once stopped (the screen left), answers on their way change nothing. Each
  // start counts, so only the newest one's answer shows.
  let stopped = false;
  let starts = 0;
  // The Card shown last, which the next Card comes after.
  let lastShown: string | undefined;
  // When the Session was last active; 0 before its first activity.
  let activeAt = 0;
  // Whether the stored Session was read: only the first start resumes it.
  let restored = false;
  // The stored Card shown, while resuming it.
  let resuming: StoredShown | undefined;
  // Which Session this is, as stored: another tab's fresh one is another.
  let sessionId = newId();
  // The write this tab last stored or read: one stored since is another tab's.
  let lastWrite: string | undefined;
  // The shown Card once it is done with (rated, or found gone), until the next
  // shows: stored as none, so a resume never shows it to rate again.
  let doneWith: string | undefined;
  const say = (message: string) => {
    if (!stopped) notify(message);
  };
  const touch = () => {
    activeAt = now();
  };

  /** The shown Card's time on screen so far, its editor's and while left out. */
  const elapsed = () => {
    if (state.phase === "left") return pausedFor;
    return Math.max(0, (editorOpen ? editedAt : now()) - shownAt);
  };

  const snapshot = (): Omit<StoredSession, "writeId"> => {
    const shown = state.shown;
    return {
      id: sessionId,
      reviewsShown,
      newShown,
      batches,
      after: lastShown ?? null,
      seen: [...seen],
      resetKinds: [...resetKinds],
      gone: [...gone],
      given: given.map((g) => ({ ...g })),
      shown:
        resuming ??
        // A Card whose Rating is on its way may be rated already: stored as
        // none, a tab closed meanwhile never shows it to rate again.
        (shown === undefined || shown.card.id === doneWith || state.saving !== undefined
          ? null
          : {
              cardId: shown.card.id,
              kind: shown.kind,
              revealed: state.revealed,
              undone: state.undone,
              elapsedMs: elapsed(),
              draft: state.draft,
              checked: state.written !== undefined,
            }),
      activeAt,
      mode: state.mode,
    };
  };

  /**
   * Saves the Session, once it has shown a Card, even once stopped (a Rating
   * or an Undo answered after the screen went); an ended one is cleared
   * already. Never over what another tab stored since this one last wrote
   * or read, when it acted later, as the one acted in last wins: a change
   * that is no activity (the shown Card's time, leaving, the editor) doesn't
   * make this tab's the newer. Its own writes always go, even after the
   * clock steps back. `shown` stores another Card shown than the screen's.
   */
  const write = (shown?: StoredShown) => {
    if (state.phase === "ended" || seen.size === 0) return;
    const stored = store.read();
    if (stored !== undefined && stored.writeId !== lastWrite && stored.activeAt > activeAt) return;
    const writeId = newId();
    store.write({ ...snapshot(), ...(shown === undefined ? {} : { shown }), writeId });
    lastWrite = writeId;
  };

  /** Saves the Session while the screen shows it. */
  const persist = () => {
    if (!stopped) write();
  };

  /** Takes in the stored Session, unless it timed out, which is cleared. */
  const restore = () => {
    const stored = store.read();
    if (stored === undefined) return;
    if (now() - stored.activeAt >= timeoutMs()) {
      store.clear();
      return;
    }
    ({ reviewsShown, newShown, batches } = stored);
    sessionId = stored.id;
    lastWrite = stored.writeId;
    lastShown = stored.after ?? undefined;
    for (const [id, kind] of stored.seen) seen.set(id, kind);
    for (const [id, kind] of stored.resetKinds) resetKinds.set(id, kind);
    for (const id of stored.gone) gone.add(id);
    given.push(...stored.given);
    activeAt = stored.activeAt;
    resuming = stored.shown ?? undefined;
    // Stored before Answer modes, it is in the Deck's.
    if (stored.mode !== undefined) state = { ...state, mode: stored.mode };
  };

  const set = (
    patch: Partial<
      Omit<
        StudyState,
        "rated" | "undoable" | "ratable" | "summary" | "editable" | "switchable" | "checkable"
      >
    >,
  ) => {
    if (stopped) return;
    const next = { ...state, ...patch };
    state = {
      ...next,
      newHeld: next.phase === "done" ? next.newHeld : 0,
      endedAfterMs: next.phase === "ended" ? next.endedAfterMs : 0,
      rated: given.length,
      undoable: next.phase !== "ended" && given.some((g) => !g.settled),
      summary: summaryOf(standing(given)),
      // A Rating that failed can be given again, or another one instead; a
      // Card whose Rating saved, waiting for the next one, can't.
      ratable:
        next.phase === "card" &&
        next.revealed &&
        !next.dontKnow &&
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
        !next.dontKnow &&
        next.saving === undefined &&
        !next.undoing &&
        !next.editing &&
        !next.skipping &&
        !next.refreshing &&
        failed?.kind !== "next",
      switchable: next.phase === "card" && !next.revealed && !next.editing,
      checkable:
        next.phase === "card" &&
        next.mode === "write" &&
        !next.revealed &&
        !isBlank(next.draft) &&
        next.saving === undefined &&
        !next.undoing &&
        !next.editing &&
        !next.skipping &&
        failed?.kind !== "next",
    };
    persist();
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
        ...UNANSWERED,
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
    lastShown = next.card.id;
    doneWith = undefined;
    touch();
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
      ...UNANSWERED,
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

  /** The first Card couldn't load: says so, with Try again. */
  const unreachable = () =>
    // What was on its way before the restart can't clear itself, so Try again isn't held.
    set({
      phase: "unreachable",
      editing: false,
      skipping: false,
      refreshing: false,
      saving: undefined,
      undoing: false,
      loadingMore: false,
    });

  /**
   * Shows the stored Card `stored` as it stood, re-read with fresh previews;
   * one deleted or moved meanwhile is skipped for the Card after it.
   */
  const resume = async (stored: StoredShown, mine: number) => {
    let card: Card | "gone";
    let fresh: IntervalPreviews | "gone" = "gone";
    try {
      card = await client.card(stored.cardId);
      if (card !== "gone") fresh = await client.intervals(stored.cardId);
    } catch {
      if (mine === starts) unreachable();
      return;
    }
    if (mine !== starts) return;
    resuming = undefined;
    if (card === "gone" || fresh === "gone") {
      // Its Reviews stand (ADR-0018), so an Undo of one that answers 404 keeps it counting.
      gone.add(stored.cardId);
      say(CARD_GONE);
      lastShown = stored.cardId;
      await loadFirst(mine, stored.cardId);
      return;
    }
    failed = undefined;
    doneWith = undefined;
    touch();
    shownAt = now() - stored.elapsedMs;
    pausedFor = 0;
    set({
      phase: "card",
      shown: { card, kind: stored.kind, intervals: fresh },
      previewedAt: now(),
      revealed: stored.revealed,
      undone: stored.undone,
      draft: stored.draft,
      written: stored.checked ? stored.draft : undefined,
      dontKnow: false,
      saving: undefined,
      failure: undefined,
      loadingMore: false,
      undoing: false,
      progressReset: false,
      turning: false,
      skipping: false,
      refreshing: false,
      editing: false,
    });
  };

  /** Loads and shows the first Card, after `from`; one that can't load says so. */
  const loadFirst = async (mine: number, from: string | undefined) => {
    let first: NextAnswer;
    try {
      first = await client.next({ reviewsShown, newShown, batches, after: from });
    } catch {
      if (mine === starts) unreachable();
      return;
    }
    if (mine === starts) show(first);
  };

  async function start() {
    stopped = false;
    starts += 1;
    // Started again with the editor open (a restart, dev only): it closes on
    // the first Card (`show`), and a Save on its way changes nothing.
    editorOpen = false;
    const mine = starts;
    if (!restored) {
      restored = true;
      restore();
    }
    // With no Card shown (a resumed Session whose Queue had run out, or one
    // whose first Card didn't load), it asks for the Card after its last.
    if (resuming !== undefined) await resume(resuming, mine);
    else await loadFirst(mine, state.shown === undefined ? lastShown : undefined);
  }

  /**
   * Forgets the Session, here and stored, and starts afresh: at a fresh
   * Session's first Card, or in the open one another tab stored since, kept
   * unless `clear` is "any".
   */
  const startFresh = (clear: "own" | "any") => {
    if (clear === "any" || store.read()?.id === sessionId) store.clear();
    sessionId = newId();
    lastWrite = undefined;
    restored = false;
    given.length = 0;
    seen.clear();
    resetKinds.clear();
    gone.clear();
    reviewsShown = 0;
    newShown = 0;
    batches = 1;
    lastShown = undefined;
    activeAt = 0;
    resuming = undefined;
    failed = undefined;
    editorOpen = false;
    starts += 1;
    set({
      mode: answerMode(),
      ...UNANSWERED,
      phase: "loading",
      shown: undefined,
      revealed: false,
      saving: undefined,
      undoing: false,
      failure: undefined,
      undone: false,
      loadingMore: false,
      editing: false,
      progressReset: false,
      turning: false,
      skipping: false,
      refreshing: false,
    });
    void start();
  };

  /**
   * Past the Session timeout since the last activity (the editor open aside,
   * whose save is activity): with a Rating standing, ends on the summary;
   * without one, starts afresh. Answers on their way are then the old
   * Session's, and change nothing. Answers whether it timed out.
   */
  const timeOut = (): boolean => {
    if (stopped || activeAt === 0 || editorOpen || state.phase === "ended") return false;
    // Resuming, the Card it shows is activity, still to come.
    if (state.phase === "loading") return false;
    // Another tab acting in this Session since keeps it open: the stale tab
    // neither ends nor clears it, and acting in it wins again. A Session
    // another tab started since is another, and keeps nothing open.
    const read = store.read();
    const stored = read?.id === sessionId ? read : undefined;
    const last = Math.max(activeAt, stored?.activeAt ?? 0);
    const timeout = timeoutMs();
    if (now() - last < timeout) return false;
    // Another tab acted in it last: it ends on that tab's Ratings.
    if (stored !== undefined && stored.writeId !== lastWrite && stored.activeAt >= activeAt) {
      given.length = 0;
      given.push(...stored.given);
    }
    if (given.length === 0) {
      startFresh("own");
      return true;
    }
    // Ended, it never resumes, not even under a longer timeout set later.
    if (stored !== undefined) store.clear();
    starts += 1;
    failed = undefined;
    set({
      phase: "ended",
      endedAfterMs: timeout,
      ...UNANSWERED,
      shown: undefined,
      revealed: false,
      saving: undefined,
      undoing: false,
      failure: undefined,
      undone: false,
      newHeld: 0,
      loadingMore: false,
      editing: false,
      progressReset: false,
      turning: false,
      skipping: false,
      refreshing: false,
    });
    return true;
  };

  /**
   * Skipping the shown Card `cardId`, gone: what was said about it (a failure and its
   * Try again, "rate it again", "Back to New") goes with it while the next
   * one loads.
   */
  const skipGone = (cardId: string): Partial<StudyState> => {
    gone.add(cardId);
    doneWith = cardId;
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
    const mine = starts;
    // Gone from the screen, nothing is left to move. Started again before the
    // frame, another Card shows, and the start closed the editor already.
    if (!stopped) {
      transition(() => {
        if (mine === starts) set({ turning: false, ...patch, editing: false });
      });
    }
  };

  /**
   * Saves `rating` of the shown Card, then shows the next Card, or with
   * `wait` (I don't know) stays on it until Next; one deleted meanwhile
   * goes on to the next Card either way.
   */
  const save = async (rating: Rating, durationMs: number, wait: boolean) => {
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
      failed = { kind: "rate", rating, durationMs, wait };
      set({ saving: undefined, failure: RATE_FAILED });
      return;
    }
    if (mine !== starts) return;
    doneWith = shown.card.id;
    if (saved === "gone") {
      gone.add(shown.card.id);
      say(CARD_GONE);
    } else {
      given.push({
        reviewId: saved.reviewId,
        cardId: shown.card.id,
        kind: shown.kind,
        rating,
        durationMs,
        settled: false,
      });
    }
    // Stored at once, so a tab closed before the next Card shows keeps the
    // Rating, and so does one closed before it was answered.
    write();
    if (wait && saved !== "gone") {
      failed = undefined;
      set({ saving: undefined });
      return;
    }
    await loadNext(shown.card.id);
  };

  /** The shown Card's time on screen, capped, as its Review records it. */
  const durationOf = () => Math.min(REVIEW_CAP_MS, Math.max(0, Math.round(now() - shownAt)));

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
    /** Shows the Back of the Card shown, in self-rate: write-and-grade reveals by Check or I don't know. */
    reveal() {
      if (timeOut()) return;
      if (state.phase === "card" && state.mode === "self-rate" && !state.revealed && !editorOpen) {
        touch();
        set({ revealed: true });
      }
    },
    /** Rates the revealed Card, its time capped, then shows the next one once the Rating saved. */
    rate(rating: Rating) {
      if (timeOut() || !state.ratable || editorOpen) return;
      touch();
      void save(rating, durationOf(), false);
    },
    /**
     * Switches the Answer mode, for the shown Card and every Card after it,
     * until switched again; only before the reveal. The draft stays.
     */
    setMode(mode: AnswerMode) {
      if (timeOut() || !state.switchable || editorOpen || mode === state.mode) return;
      touch();
      set({ mode });
    },
    /** Keeps the shown Card's Written answer as typed so far, until the reveal; typing is activity. */
    setDraft(draft: string) {
      if (state.phase !== "card" || state.revealed || draft === state.draft) return;
      if (timeOut()) return;
      touch();
      set({ draft });
    },
    /** Check: reveals the Back beside the Written answer, to rate; not while it is blank. */
    check() {
      if (timeOut() || !state.checkable || editorOpen) return;
      touch();
      set({ revealed: true, written: state.draft });
    },
    /**
     * I don't know, in write-and-grade: rates the shown Card Again at once,
     * its draft discarded, and shows its Back until Next; the Rating saves as
     * any does, with Try again when it fails.
     */
    dontKnow() {
      if (timeOut() || state.phase !== "card" || state.mode !== "write" || state.revealed) return;
      if (busy() || failed?.kind === "next") return;
      touch();
      const durationMs = durationOf();
      set({ revealed: true, dontKnow: true, draft: "", written: undefined });
      void save("again", durationMs, true);
    },
    /** Next, after I don't know saved: shows the next Card. */
    next() {
      const shown = state.shown;
      if (timeOut() || shown === undefined || !state.dontKnow) return;
      if (busy() || failed !== undefined || state.phase !== "card") return;
      touch();
      set({ skipping: true });
      void loadNext(shown.card.id);
    },
    /**
     * Tries again what failed: the Rating, loading the next Card, or loading a
     * reset Card's fresh Intervals.
     */
    retry() {
      if (timeOut() || busy()) return;
      if (state.phase === "unreachable") {
        set({ phase: "loading" });
        void start();
        return;
      }
      const what = failed;
      if (what?.kind === "rate") void save(what.rating, what.durationMs, what.wait);
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
      if (timeOut() || state.phase !== "done" || state.newHeld === 0 || busy()) return;
      touch();
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
      if (timeOut() || state.phase === "ended") return;
      const last = given.findLast((g) => !g.settled);
      if (last === undefined || busy()) return;
      touch();
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
        const { cardId } = last;
        // Its Review gone (undone elsewhere), it no longer counts. Still
        // standing, under a deleted Card or a newer Review or Progress reset,
        // none of the Card's Ratings can be undone, and they keep counting.
        if (back === "gone" && !gone.has(cardId)) drop(last);
        else for (const g of given) if (g.cardId === cardId) g.settled = true;
        if (stopped) return write();
        if (!current) return set({});
        say(UNDO_GONE);
        set({ undoing: false });
        return;
      }
      drop(last);
      if (stopped) {
        // Answered after the screen went, its Card is the one to resume, back from the Undo.
        return write({
          cardId: last.cardId,
          kind: last.kind,
          revealed: true,
          undone: true,
          elapsedMs: last.durationMs,
          draft: "",
          checked: false,
        });
      }
      if (!current) return set({});
      failed = undefined;
      doneWith = undefined;
      // The re-rated Review's time is the undone one's plus the time since.
      shownAt = now() - last.durationMs;
      set({
        phase: "card",
        shown: { card: back.card, kind: last.kind, intervals: back.intervals },
        previewedAt: now(),
        revealed: true,
        saving: undefined,
        undoing: false,
        failure: undefined,
        undone: true,
        progressReset: false,
        turning: false,
        // Its Written answer went with the Rating.
        ...UNANSWERED,
      });
    },
    /**
     * Opens the editor over the shown Card, before or after the reveal; not
     * while a Rating or an Undo is on its way. Its time is left out of the
     * Card's. Answers whether it opened.
     */
    edit(): boolean {
      if (stopped || timeOut() || !state.editable || editorOpen) return false;
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
      touch();
      if (!progressReset) {
        closeEditor({ shown: { ...state.shown, card } });
        return;
      }
      for (const g of given) if (g.cardId === card.id) g.settled = true;
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
     * may show a frame later), nothing happens ("stay"). Past the Session
     * timeout, it ends there first: on its summary with a Rating standing.
     */
    leave(): "summary" | "away" | "stay" {
      if (editorOpen) return "stay";
      if (timeOut()) return state.phase === "ended" ? "summary" : "away";
      if (state.phase !== "card" || given.length === 0) return "away";
      pausedFor = now() - shownAt;
      set({ phase: "left" });
      return "summary";
    },
    /** Keep studying: back from the summary to the Card shown when it was left, its time going on. */
    resume() {
      if (timeOut() || state.phase !== "left") return;
      touch();
      shownAt = now() - pausedFor;
      set({ phase: "card" });
    },
    /** Stops it: answers still on their way change nothing, until it starts again. */
    stop() {
      persist();
      stopped = true;
    },
    /**
     * Checks the Session timeout, as on focus or on a timer: past it, ends the
     * Session on its summary with a Rating standing, or starts afresh without.
     */
    checkTimeout() {
      timeOut();
    },
    /** Saves the shown Card's time so far, as the page hides; not activity. */
    persist,
    /**
     * How far the Session has gone into its New cards, as `study/overview`
     * takes it: a New Card it shows is still to come, so it isn't counted as
     * shown. An ended one's is a fresh Session's.
     */
    overviewProgress(): { newShown: number; batches: number } {
      if (state.phase === "ended") return { newShown: 0, batches: 1 };
      const pending = state.shown?.kind === "new" && state.shown.card.id !== doneWith ? 1 : 0;
      return { newShown: Math.max(0, newShown - pending), batches };
    },
    /** Start a new session, from an ended one: clears it and loads a fresh Session's first Card. */
    restart() {
      if (state.phase === "ended") startFresh("any");
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
  /** Next, after I don't know. */
  | { type: "next" }
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
 * In write-and-grade (`writing`, before the reveal) Space and Enter reveal
 * nothing; after I don't know (`waiting`) they press Next, and 1 to 4 rate nothing.
 */
export function keyAction(
  key: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  {
    showing,
    revealed,
    focus,
    editing = false,
    writing = false,
    waiting = false,
  }: {
    showing: boolean;
    revealed: boolean;
    focus: "rating" | "control" | undefined;
    /** While the editor is open, every key is its own, Esc included. */
    editing?: boolean;
    /** A Card shown in write-and-grade, not revealed yet: Check and I don't know reveal it. */
    writing?: boolean;
    /** The Back shown after I don't know, until Next. */
    waiting?: boolean;
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
    if (focus === "control" || !showing) return { type: "none" };
    if (waiting) return { type: "next" };
    if (revealed || writing) return { type: "none" };
    return { type: "reveal" };
  }
  if (!revealed || waiting) return { type: "none" };
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
