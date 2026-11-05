import {
  type AnswerMode,
  type IntervalPreviews,
  type QueueKind,
  REVIEW_CAP_MS,
  type Rating,
} from "@banki/shared";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import type { Card, CardOutcome } from "./cards";
import { memoryStorage } from "./memory-storage";
import { clearStoredSessions, openProgress, sessionStore } from "./session-store";
import {
  CARD_GONE,
  EDITOR_FAILED,
  INTERVALS_FAILED,
  MORE_FAILED,
  NEXT_FAILED,
  type NextAnswer,
  type NextCard,
  type Progress,
  RATE_FAILED,
  type StudyApi,
  UNDO_FAILED,
  UNDO_GONE,
  cardClickAction,
  copyFormula,
  createStudySession,
  editorCloseAction,
  editorEscAction,
  editorOpener,
  formatInterval,
  isEditKey,
  keyAction,
  recallPercent,
  saveStudyEdit,
  spentLabel,
  studyApi,
  summaryOf,
} from "./study";

const NOW = Date.parse("2026-05-01T10:00:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const moment = (ms: number) => ({
  state: "learning" as const,
  scheduledDays: 0,
  due: new Date(NOW + ms).toISOString(),
});

const days = (scheduledDays: number) => ({
  state: "review" as const,
  scheduledDays,
  due: new Date(NOW + scheduledDays * DAY).toISOString(),
});

describe("formatInterval", () => {
  test.each([
    [moment(0), "1m"],
    [moment(MINUTE), "1m"],
    [moment(10 * MINUTE), "10m"],
    [moment(59 * MINUTE), "59m"],
    [moment(60 * MINUTE), "1h"],
    [moment(5 * 60 * MINUTE), "5h"],
    [moment(23 * 60 * MINUTE), "23h"],
    [moment(DAY), "1d"],
    [days(1), "1d"],
    [days(4), "4d"],
    [days(29), "29d"],
    [days(30), "1mo"],
    [days(105), "3.5mo"],
    [days(364), "12.1mo"],
    [days(365), "1y"],
    [days(438), "1.2y"],
    [days(36_500), "100y"],
  ])("%j shows as %s", (preview, shown) => {
    expect(formatInterval(preview, NOW)).toBe(shown);
  });

  test("a Card scheduled in days shows its scheduled days, not the time to its due moment", () => {
    // Due from a Study day's Day start: 3 days and some hours from now.
    const preview = {
      state: "review" as const,
      scheduledDays: 3,
      due: new Date(NOW + 3 * DAY - 6 * 60 * MINUTE).toISOString(),
    };
    expect(formatInterval(preview, NOW)).toBe("3d");
  });

  test("relearning counts the minutes to its due moment", () => {
    expect(
      formatInterval(
        { state: "relearning", scheduledDays: 0, due: new Date(NOW + 10 * MINUTE).toISOString() },
        NOW,
      ),
    ).toBe("10m");
  });
});

const intervals = (tag: string): IntervalPreviews => {
  const preview = (minutes: number) => ({
    state: "learning" as const,
    scheduledDays: 0,
    due: new Date(NOW + minutes * MINUTE + tag.length).toISOString(),
  });
  return { again: preview(1), hard: preview(6), good: preview(10), easy: preview(20) };
};

const card = (id: string): Card => ({
  id,
  deckId: "d1",
  front: `${id} front`,
  back: `${id} back`,
  tags: [],
  gradingNotes: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  studied: false,
});

const next = (id: string, kind: QueueKind = "new"): NextCard => ({
  card: card(id),
  kind,
  intervals: intervals(id),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type UndoAnswer = Awaited<ReturnType<StudyApi["undo"]>>;

/** A promise the test answers when it likes. */
function deferred<T>() {
  const box: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((done) => {
    box.resolve = done;
  });
  return { promise, resolve: (value: T) => box.resolve?.(value) };
}

/**
 * A fake study API over a Queue of Cards, answering each call at once unless
 * the test makes it fail, and recording every call. Once the Queue is empty it
 * answers `held` New cards held back.
 */
function fakeApi(queue: NextCard[]) {
  const calls = {
    next: [] as Progress[],
    rate: [] as { cardId: string; rating: Rating; durationMs: number }[],
    undo: [] as string[],
    intervals: [] as string[],
    card: [] as string[],
  };
  let reviews = 0;
  const fail = {
    next: false,
    rate: false as boolean | "gone",
    undo: false as boolean | "gone" | "settled",
    intervals: false as boolean | "gone",
    card: false as boolean,
  };
  // The Cards deleted or moved to another Deck meanwhile: re-read, they are gone.
  const missing = new Set<string>();
  const held = { count: 0 };
  const api: StudyApi = {
    next: async (progress) => {
      calls.next.push(progress);
      if (fail.next) throw new Error("offline");
      const shown = queue.shift();
      return shown === undefined
        ? { next: null, newHeld: held.count }
        : { next: shown, newHeld: 0 };
    },
    rate: async (cardId, rating, durationMs) => {
      calls.rate.push({ cardId, rating, durationMs });
      if (fail.rate === "gone") return "gone";
      if (fail.rate) throw new Error("offline");
      reviews += 1;
      return { reviewId: `r${reviews}` };
    },
    undo: async (reviewId) => {
      calls.undo.push(reviewId);
      if (fail.undo === "gone" || fail.undo === "settled") return fail.undo;
      if (fail.undo) throw new Error("offline");
      const cardId = calls.rate.find((_, i) => `r${i + 1}` === reviewId)?.cardId ?? "?";
      return { card: card(cardId), intervals: intervals(`${cardId}-undone`) };
    },
    intervals: async (cardId) => {
      calls.intervals.push(cardId);
      if (fail.intervals === "gone") return "gone";
      if (fail.intervals) throw new Error("offline");
      return intervals(`${cardId}-fresh`);
    },
    card: async (cardId) => {
      calls.card.push(cardId);
      if (fail.card) throw new Error("offline");
      return missing.has(cardId) ? "gone" : card(cardId);
    },
  };
  return { api, calls, fail, held, queue, missing };
}

function setUp(queue: NextCard[]) {
  const server = fakeApi(queue);
  const messages: string[] = [];
  let time = NOW;
  const session = createStudySession({
    studyApi: server.api,
    notify: (message) => messages.push(message),
    now: () => time,
  });
  return {
    ...server,
    session,
    messages,
    state: () => session.getState(),
    /** Moves the test's clock on. */
    wait: (ms: number) => {
      time += ms;
    },
    shownId: () => session.getState().shown?.card.id,
  };
}

/** Reveals the Card shown and rates it, waiting for the next one. */
async function revealAndRate(t: ReturnType<typeof setUp>, rating: Rating) {
  t.session.reveal();
  t.session.rate(rating);
  await flush();
}

describe("a Session", () => {
  test("walks the Queue: Front, reveal, Back, Rating, next Card, then the end", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();

    expect(t.state()).toMatchObject({ phase: "card", revealed: false, ratable: false });
    expect(t.shownId()).toBe("a");

    // Before the reveal a Rating does nothing.
    t.session.rate("good");
    await flush();
    expect(t.calls.rate).toEqual([]);

    t.session.reveal();
    expect(t.state()).toMatchObject({ revealed: true, ratable: true });
    t.wait(4200);
    t.session.rate("good");
    expect(t.state()).toMatchObject({ saving: "good", ratable: false });
    await flush();

    expect(t.calls.rate).toEqual([{ cardId: "a", rating: "good", durationMs: 4200 }]);
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ revealed: false, saving: undefined, rated: 1 });

    await revealAndRate(t, "easy");
    expect(t.state()).toMatchObject({ phase: "done", shown: undefined, rated: 2 });
    expect(t.session.canUndo()).toBe(true);
  });

  test("counts each Card once, by the kind it first came with, and passes the Card just shown", async () => {
    const t = setUp([
      next("a", "review"),
      next("b", "new"),
      next("a", "learning"),
      next("c", "learning"),
    ]);
    await t.session.start();
    await revealAndRate(t, "again");
    await revealAndRate(t, "good");
    await revealAndRate(t, "good");
    await revealAndRate(t, "good");

    expect(t.calls.next).toEqual([
      { reviewsShown: 0, newShown: 0, batches: 1, after: undefined },
      { reviewsShown: 1, newShown: 0, batches: 1, after: "a" },
      { reviewsShown: 1, newShown: 1, batches: 1, after: "b" },
      // a came back from its learning step, and c was a learning Card from before: neither counts.
      { reviewsShown: 1, newShown: 1, batches: 1, after: "a" },
      { reviewsShown: 1, newShown: 1, batches: 1, after: "c" },
    ]);
  });

  test("with nothing to study, says so from the start", async () => {
    const t = setUp([]);
    await t.session.start();

    expect(t.state().phase).toBe("nothing");
    expect(t.session.canUndo()).toBe(false);
  });

  test("rate, rate, undo, undo: each Undo takes back the newest Rating, its Card back revealed with fresh previews", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    t.wait(1000);
    await revealAndRate(t, "good");
    t.wait(2000);
    await revealAndRate(t, "hard");
    expect(t.shownId()).toBe("c");

    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2"]);
    expect(t.state()).toMatchObject({ phase: "card", revealed: true, ratable: true, undone: true });
    expect(t.state().shown).toEqual({
      card: card("b"),
      kind: "new",
      intervals: intervals("b-undone"),
    });
    expect(t.state().rated).toBe(1);

    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r1"]);
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ revealed: true, undone: true, rated: 0 });
    expect(t.session.canUndo()).toBe(false);

    // A third Undo has nothing to take back.
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r1"]);
  });

  test("Undo works from the end state", async () => {
    const t = setUp([next("a")]);
    await t.session.start();
    await revealAndRate(t, "good");
    expect(t.state().phase).toBe("done");

    await t.session.undo();

    expect(t.state()).toMatchObject({ phase: "card", revealed: true, undone: true });
    expect(t.shownId()).toBe("a");
  });

  test("after an Undo the counters stay, and the re-rated Review's time is the undone one's plus the time since", async () => {
    const t = setUp([next("a", "review"), next("b"), next("c")]);
    await t.session.start();
    t.wait(3000);
    await revealAndRate(t, "again");

    t.wait(500);
    await t.session.undo();
    t.wait(1500);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate.map((r) => r.durationMs)).toEqual([3000, 4500]);
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 1, newShown: 1, batches: 1, after: "a" });
  });

  test("a Rating that fails keeps the Card with the error, and Try again saves it", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.wait(2500);
    t.fail.rate = true;
    await revealAndRate(t, "hard");

    expect(t.state()).toMatchObject({
      phase: "card",
      revealed: true,
      saving: undefined,
      failure: RATE_FAILED,
      ratable: true,
    });
    expect(t.shownId()).toBe("a");

    t.fail.rate = false;
    t.wait(10_000);
    t.session.retry();
    await flush();

    expect(t.calls.rate).toEqual([
      { cardId: "a", rating: "hard", durationMs: 2500 },
      { cardId: "a", rating: "hard", durationMs: 2500 },
    ]);
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ failure: undefined, rated: 1 });
  });

  test("a Card deleted elsewhere is skipped with a message, and leaves nothing to undo", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.fail.rate = "gone";
    await revealAndRate(t, "good");

    expect(t.messages).toEqual([CARD_GONE]);
    expect(t.shownId()).toBe("b");
    expect(t.session.canUndo()).toBe(false);
  });

  test("a next Card that doesn't load keeps the rated one, unratable, until Try again", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.fail.next = true;
    await revealAndRate(t, "good");

    expect(t.state()).toMatchObject({ failure: NEXT_FAILED, ratable: false, rated: 1 });
    t.session.rate("easy");
    await flush();
    expect(t.calls.rate).toHaveLength(1);

    t.fail.next = false;
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("b");
    expect(t.calls.next.at(-1)).toMatchObject({ after: "a" });
  });

  test("while Try again loads the next Card, Undo and Edit wait, so its answer replaces nothing they did", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.fail.next = true;
    await revealAndRate(t, "good");
    expect(t.state()).toMatchObject({ failure: NEXT_FAILED, undoable: true });

    const answer = deferred<NextAnswer>();
    t.api.next = () => answer.promise;
    t.session.retry();
    expect(t.state()).toMatchObject({ skipping: true, editable: false, failure: undefined });
    await t.session.undo();
    expect(t.session.edit()).toBe(false);
    expect(t.calls.undo).toEqual([]);

    answer.resolve({ next: next("c"), newHeld: 0 });
    await flush();
    expect(t.shownId()).toBe("c");
    expect(t.state()).toMatchObject({ skipping: false, rated: 2, undoable: true });
  });

  test("a first Card that doesn't load says so, and Try again loads it", async () => {
    const t = setUp([next("a")]);
    t.fail.next = true;
    await t.session.start();
    expect(t.state().phase).toBe("unreachable");

    t.fail.next = false;
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("a");
  });

  test("an Undo that fails keeps the Rating to undo, and one gone elsewhere drops it", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await revealAndRate(t, "good");

    t.fail.undo = true;
    await t.session.undo();
    expect(t.messages).toEqual([UNDO_FAILED]);
    expect(t.state()).toMatchObject({ rated: 2, undoing: false });
    expect(t.shownId()).toBe("c");

    t.fail.undo = "gone";
    await t.session.undo();
    expect(t.messages).toEqual([UNDO_FAILED, UNDO_GONE]);
    expect(t.state().rated).toBe(1);
    expect(t.shownId()).toBe("c");
  });

  test("an Undo refused for good keeps every Rating of its Card standing: the next Undo goes on past them", async () => {
    const t = setUp([next("a"), next("b"), next("a", "learning"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "again");
    await revealAndRate(t, "good");
    await revealAndRate(t, "good");

    t.fail.undo = "settled";
    await t.session.undo();
    t.fail.undo = false;
    await t.session.undo();
    expect(t.shownId()).toBe("b");
    // a's first Rating can't be undone either: no doomed Undo, no second toast.
    await t.session.undo();

    expect(t.calls.undo).toEqual(["r3", "r2"]);
    expect(t.messages).toEqual([UNDO_GONE]);
    expect(t.state()).toMatchObject({ rated: 2, undoable: false });
  });

  test("an Undo of a Card deleted from the editor answers 404 and is skipped, its Ratings still counting", async () => {
    const t = setUp([next("b"), next("a"), next("a", "learning"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await revealAndRate(t, "again");
    expect(t.shownId()).toBe("a");
    t.session.edit();
    await t.session.closeGone();
    expect(t.shownId()).toBe("c");

    t.fail.undo = "gone";
    await t.session.undo();
    expect(t.messages).toEqual([UNDO_GONE]);
    // Its Review outlives the Card (ADR-0018): it still counts.
    expect(t.state()).toMatchObject({ rated: 2, undoable: true });
    expect(t.state().summary.studied).toBe(2);

    t.fail.undo = false;
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r1"]);
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ rated: 1, undoable: false });
  });

  test("an Undo of a Card a Rating found deleted elsewhere answers 404 and is skipped, its Rating still counting", async () => {
    const t = setUp([next("a"), next("a", "learning"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "again");
    t.fail.rate = "gone";
    await revealAndRate(t, "good");
    t.fail.rate = false;
    expect(t.shownId()).toBe("c");

    t.fail.undo = "gone";
    await t.session.undo();
    expect(t.messages).toEqual([CARD_GONE, UNDO_GONE]);
    // Its Review outlives the Card (ADR-0018): it still counts.
    expect(t.state()).toMatchObject({ rated: 1 });
    expect(t.state().summary.studied).toBe(1);
  });

  test("an Undo refused for good (a Progress reset since) keeps its Rating standing, and the next goes on to the one before", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await revealAndRate(t, "good");

    t.fail.undo = "settled";
    await t.session.undo();
    expect(t.messages).toEqual([UNDO_GONE]);
    expect(t.state()).toMatchObject({ rated: 2, undoable: true, undoing: false });
    expect(t.state().summary.studied).toBe(2);
    expect(t.shownId()).toBe("c");

    t.fail.undo = false;
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r1"]);
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ rated: 1, undoable: false });
    expect(t.state().summary.studied).toBe(1);

    // Only the settled one is left: nothing to undo.
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r1"]);
  });

  test("a second Rating while one saves does nothing", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.session.rate("good");
    t.session.rate("easy");
    await flush();

    expect(t.calls.rate).toHaveLength(1);
  });

  test("once stopped, answers on their way change nothing", async () => {
    const t = setUp([next("a")]);
    const started = t.session.start();
    t.session.stop();
    await started;

    expect(t.state().phase).toBe("loading");
  });

  test("started again after a stop (a remount), shows only the newest start's Card", async () => {
    const t = setUp([next("a"), next("b")]);
    const first = t.session.start();
    t.session.stop();
    const second = t.session.start();
    await Promise.all([first, second]);

    expect(t.shownId()).toBe("b");
    expect(t.calls.next).toHaveLength(2);
  });
});

/** A Session that rated "a" (new) and "b" (review), then ran out with 37 New cards held. */
async function ranOut() {
  const t = setUp([next("a", "new"), next("b", "review")]);
  t.held.count = 37;
  await t.session.start();
  await revealAndRate(t, "good");
  await revealAndRate(t, "good");
  return t;
}

describe("another New-card batch", () => {
  test("the done phase says how many New cards the batch held", async () => {
    const t = await ranOut();

    expect(t.state()).toMatchObject({ phase: "done", newHeld: 37, rated: 2 });
  });

  test("a Session that ends with none held says 0", async () => {
    const t = setUp([next("a")]);
    await t.session.start();
    await revealAndRate(t, "good");

    expect(t.state()).toMatchObject({ phase: "done", newHeld: 0 });
  });

  test("more() adds a batch and loads the next Card, keeping the counters, the rated count and Undo", async () => {
    const t = await ranOut();
    t.queue.push(next("c", "new"));

    t.session.more();
    expect(t.state()).toMatchObject({ phase: "done", loadingMore: true });
    await flush();

    expect(t.calls.next.at(-1)).toEqual({
      reviewsShown: 1,
      newShown: 1,
      batches: 2,
      after: undefined,
    });
    expect(t.shownId()).toBe("c");
    expect(t.state()).toMatchObject({ phase: "card", newHeld: 0, rated: 2, loadingMore: false });

    // The next calls carry the batch on.
    await revealAndRate(t, "good");
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 1, newShown: 2, batches: 2, after: "c" });
    expect(t.state()).toMatchObject({ phase: "done", rated: 3 });

    // Undo still goes back through the earlier batch's Ratings.
    await t.session.undo();
    await t.session.undo();
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r3", "r2", "r1"]);
    expect(t.shownId()).toBe("a");
  });

  test("each more() adds one more batch", async () => {
    const t = await ranOut();
    t.session.more();
    await flush();
    expect(t.state()).toMatchObject({ phase: "done", newHeld: 37 });

    t.session.more();
    await flush();

    expect(t.calls.next.map((c) => c.batches)).toEqual([1, 1, 1, 2, 3]);
  });

  test("with no Card back (the New cards deleted meanwhile), shows the end again", async () => {
    const t = await ranOut();
    t.held.count = 0;

    t.session.more();
    await flush();

    expect(t.state()).toMatchObject({ phase: "done", newHeld: 0, rated: 2, loadingMore: false });
  });

  test("a more() that fails stays at the end with a message, and asks for the same batch again", async () => {
    const t = await ranOut();
    t.fail.next = true;

    t.session.more();
    await flush();

    expect(t.messages).toEqual([MORE_FAILED]);
    expect(t.state()).toMatchObject({ phase: "done", newHeld: 37, loadingMore: false });

    t.fail.next = false;
    t.queue.push(next("c", "new"));
    t.session.more();
    await flush();

    expect(t.calls.next.at(-1)?.batches).toBe(2);
    expect(t.shownId()).toBe("c");
  });

  test("does nothing unless the end holds New cards back, or while one is on its way", async () => {
    const t = setUp([next("a")]);
    await t.session.start();
    t.session.more();
    await flush();
    expect(t.calls.next).toHaveLength(1);

    await revealAndRate(t, "good");
    t.session.more();
    await flush();
    expect(t.calls.next).toHaveLength(2);

    const held = await ranOut();
    held.session.more();
    held.session.more();
    await flush();
    expect(held.calls.next.map((c) => c.batches)).toEqual([1, 1, 1, 2]);
  });

  test("an Undo from the end leaves no New cards held", async () => {
    const t = await ranOut();

    await t.session.undo();

    expect(t.state()).toMatchObject({ phase: "card", newHeld: 0 });
  });
});

const press = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("keyAction", () => {
  test("Space and Enter reveal, and never rate", () => {
    for (const key of [" ", "Enter"]) {
      expect(keyAction(press(key), { showing: true, revealed: false, focus: undefined })).toEqual({
        type: "reveal",
      });
      expect(keyAction(press(key), { showing: true, revealed: true, focus: undefined })).toEqual({
        type: "none",
      });
    }
  });

  test("1 to 4 rate Again, Hard, Good and Easy, only once revealed", () => {
    const ratings = ["again", "hard", "good", "easy"];
    ["1", "2", "3", "4"].forEach((key, i) => {
      expect(keyAction(press(key), { showing: true, revealed: true, focus: undefined })).toEqual({
        type: "rate",
        rating: ratings[i],
      });
      expect(keyAction(press(key), { showing: true, revealed: false, focus: undefined })).toEqual({
        type: "none",
      });
    });
    expect(keyAction(press("5"), { showing: true, revealed: true, focus: undefined })).toEqual({
      type: "none",
    });
    expect(
      keyAction(press("1", { ctrlKey: true }), { showing: true, revealed: true, focus: undefined }),
    ).toEqual({ type: "none" });
  });

  test("Ctrl+Z and ⌘+Z undo, revealed or not", () => {
    for (const revealed of [false, true]) {
      expect(
        keyAction(press("z", { ctrlKey: true }), { showing: true, revealed, focus: undefined }),
      ).toEqual({ type: "undo" });
      expect(
        keyAction(press("z", { metaKey: true }), { showing: true, revealed, focus: undefined }),
      ).toEqual({ type: "undo" });
      expect(
        keyAction(press("Z", { metaKey: true }), { showing: true, revealed, focus: undefined }),
      ).toEqual({ type: "undo" });
    }
    expect(keyAction(press("z"), { showing: true, revealed: true, focus: undefined })).toEqual({
      type: "none",
    });
  });

  test("Space and Enter leave a focused control to itself, and do nothing on a rating button", () => {
    for (const key of [" ", "Enter"]) {
      expect(keyAction(press(key), { showing: true, revealed: false, focus: "control" })).toEqual({
        type: "none",
      });
      expect(keyAction(press(key), { showing: true, revealed: true, focus: "rating" })).toEqual({
        type: "block",
      });
      // At the end, "Back to deck" or "Try again" has the focus, or nothing does.
      expect(keyAction(press(key), { showing: false, revealed: false, focus: undefined })).toEqual({
        type: "none",
      });
    }
  });

  test("E edits a shown Card, revealed or not, and nothing else", () => {
    for (const key of ["e", "E"]) {
      for (const revealed of [false, true]) {
        expect(keyAction(press(key), { showing: true, revealed, focus: undefined })).toEqual({
          type: "edit",
        });
      }
      expect(keyAction(press(key), { showing: false, revealed: false, focus: undefined })).toEqual({
        type: "none",
      });
      expect(
        keyAction(press(key, { ctrlKey: true }), {
          showing: true,
          revealed: true,
          focus: undefined,
        }),
      ).toEqual({ type: "none" });
    }
  });

  test("E is the key where E is on a layout with no Latin letters, and only there", () => {
    const shown = { showing: true, revealed: false, focus: undefined };
    // Russian and Greek: the key where E is types у and ε.
    for (const key of ["у", "ε"]) {
      expect(keyAction({ ...press(key), code: "KeyE" }, shown)).toEqual({ type: "edit" });
      expect(isEditKey({ key, code: "KeyE" })).toBe(true);
    }
    // Dvorak: the key where E is types a period, and e is elsewhere.
    expect(keyAction({ ...press("."), code: "KeyE" }, shown)).toEqual({ type: "none" });
    expect(keyAction({ ...press("e"), code: "KeyD" }, shown)).toEqual({ type: "edit" });
    expect(keyAction({ ...press("у"), code: "KeyR" }, shown)).toEqual({ type: "none" });
    // Turkish F: the key where E is types ğ, a Latin letter, and e is elsewhere.
    expect(keyAction({ ...press("ğ"), code: "KeyE" }, shown)).toEqual({ type: "none" });
    expect(isEditKey({ key: "ğ", code: "KeyE" })).toBe(false);
  });

  test("while editing, every key is the editor's, Esc included", () => {
    for (const key of [" ", "Enter", "1", "4", "e", "Escape"]) {
      expect(
        keyAction(press(key), { showing: true, revealed: true, focus: undefined, editing: true }),
      ).toEqual({ type: "none" });
    }
    expect(
      keyAction(press("z", { ctrlKey: true }), {
        showing: true,
        revealed: true,
        focus: undefined,
        editing: true,
      }),
    ).toEqual({ type: "none" });
  });

  test("Esc leaves", () => {
    expect(
      keyAction(press("Escape"), { showing: true, revealed: false, focus: undefined }),
    ).toEqual({ type: "leave" });
    expect(keyAction(press("Escape"), { showing: true, revealed: true, focus: undefined })).toEqual(
      { type: "leave" },
    );
  });
});

/** A clicked element, by what it is inside: the selectors it matches, with their attributes. */
const clicked = (inside: Record<string, Record<string, string>>) => ({
  closest: (selector: string) => {
    const attributes = inside[selector];
    return attributes === undefined
      ? null
      : { getAttribute: (name: string) => attributes[name] ?? null };
  },
});

describe("cardClickAction", () => {
  const formula = clicked({ "[data-formula]": { "data-formula": "$x^2$" } });

  test("once revealed, a click on a Formula copies it as written", () => {
    expect(cardClickAction(formula, { revealed: true })).toEqual({ type: "copy", source: "$x^2$" });
  });

  test("before the reveal, a click on a Formula, or anywhere, reveals", () => {
    expect(cardClickAction(formula, { revealed: false })).toEqual({ type: "reveal" });
    expect(cardClickAction(clicked({}), { revealed: false })).toEqual({ type: "reveal" });
  });

  test("a Formula inside a link, as in the deck page's timeline, never copies", () => {
    const linked = clicked({
      a: { href: "/cards/c1" },
      "[data-formula]": { "data-formula": "$x$" },
    });
    expect(cardClickAction(linked, { revealed: true })).toEqual({ type: "none" });
  });

  test("once revealed, a click anywhere else does nothing", () => {
    expect(cardClickAction(clicked({}), { revealed: true })).toEqual({ type: "none" });
  });
});

describe("copyFormula", () => {
  test("copies the source and says Copied", async () => {
    const written: string[] = [];
    const messages: string[] = [];
    await copyFormula("$$\\sum$$", {
      clipboard: { writeText: async (text) => void written.push(text) },
      notify: (m) => messages.push(m),
    });

    expect(written).toEqual(["$$\\sum$$"]);
    expect(messages).toEqual(["Copied"]);
  });

  test("says Couldn't copy when the browser refuses, or has no clipboard", async () => {
    const messages: string[] = [];
    const notify = (m: string) => messages.push(m);
    await copyFormula("$x$", {
      clipboard: { writeText: () => Promise.reject(new Error("NotAllowedError")) },
      notify,
    });
    await copyFormula("$x$", { clipboard: undefined, notify });

    expect(messages).toEqual(["Couldn't copy", "Couldn't copy"]);
  });
});

/** A standing Rating of `cardId`. */
const r = (cardId: string, kind: QueueKind, rating: Rating, durationMs = 1000) => ({
  cardId,
  kind,
  rating,
  durationMs,
});

describe("summaryOf", () => {
  test("is nothing with no standing Rating", () => {
    expect(summaryOf([])).toEqual({ studied: 0, newStudied: 0, recall: null, timeMs: 0 });
  });

  test("counts each Card once, with how many were New", () => {
    const summary = summaryOf([
      r("a", "new", "again"),
      r("b", "review", "good"),
      r("a", "learning", "good"),
      r("c", "new", "good"),
    ]);

    expect(summary).toMatchObject({ studied: 3, newStudied: 2 });
  });

  test("Recall rate counts only review-kind Cards, by their first standing Rating", () => {
    const summary = summaryOf([
      r("a", "review", "good"),
      r("b", "review", "again"),
      // b's later Rating doesn't change its first.
      r("b", "learning", "good"),
      r("c", "review", "hard"),
      // New and learning Cards don't count, Again or not.
      r("d", "new", "again"),
      r("e", "learning", "good"),
    ]);

    expect(summary.recall).toEqual({ kept: 2, of: 3 });
    expect(recallPercent({ kept: 2, of: 3 })).toBe(67);
  });

  test("Recall rate is absent with no review-kind Card", () => {
    expect(summaryOf([r("a", "new", "good"), r("b", "learning", "good")]).recall).toBeNull();
  });

  test("time sums every standing Rating's duration", () => {
    expect(summaryOf([r("a", "new", "again", 4000), r("a", "learning", "good", 2500)]).timeMs).toBe(
      6500,
    );
  });
});

test("spentLabel says seconds under a minute, else whole minutes", () => {
  expect(spentLabel(0)).toBe("0 s");
  expect(spentLabel(45_000)).toBe("45 s");
  expect(spentLabel(59_400)).toBe("59 s");
  expect(spentLabel(59_600)).toBe("1 min");
  expect(spentLabel(14 * 60_000 + 20_000)).toBe("14 min");
});

describe("the Session's summary", () => {
  test("adds up its standing Ratings, and an Undo takes its Rating out", async () => {
    const t = setUp([next("a", "review"), next("b", "new"), next("c", "review")]);
    await t.session.start();
    t.wait(3000);
    await revealAndRate(t, "good");
    t.wait(5000);
    await revealAndRate(t, "good");
    t.wait(2000);
    await revealAndRate(t, "again");

    expect(t.state().summary).toEqual({
      studied: 3,
      newStudied: 1,
      recall: { kept: 1, of: 2 },
      timeMs: 10_000,
    });

    await t.session.undo();

    expect(t.state().summary).toEqual({
      studied: 2,
      newStudied: 1,
      recall: { kept: 1, of: 1 },
      timeMs: 8000,
    });
  });

  test("shows at the end of the Queue", async () => {
    const t = setUp([next("a", "review")]);
    await t.session.start();
    await revealAndRate(t, "good");

    expect(t.state()).toMatchObject({ phase: "done", summary: { studied: 1 } });
  });
});

describe("leaving the Session", () => {
  test("with no Rating standing goes away", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();

    expect(t.session.leave()).toBe("away");
    expect(t.state().phase).toBe("card");
  });

  test("with a Rating standing shows the summary", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    await revealAndRate(t, "good");

    expect(t.session.leave()).toBe("summary");
    expect(t.state()).toMatchObject({ phase: "left", summary: { studied: 1 } });
  });

  test("from the summary goes away", async () => {
    const t = setUp([next("a")]);
    await t.session.start();
    await revealAndRate(t, "good");
    expect(t.state().phase).toBe("done");

    expect(t.session.leave()).toBe("away");
  });

  test("Keep studying returns to the Card shown, as it was, with its counters, time and Undo kept", async () => {
    const t = setUp([next("a", "review"), next("b", "new"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.wait(2000);
    t.session.reveal();
    t.session.leave();
    // Time on the summary doesn't count.
    t.wait(60_000);

    t.session.resume();
    expect(t.state()).toMatchObject({ phase: "card", revealed: true, ratable: true, rated: 1 });
    expect(t.shownId()).toBe("b");
    t.wait(1000);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate.at(-1)).toEqual({ cardId: "b", rating: "good", durationMs: 3000 });
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 1, newShown: 1, batches: 1, after: "b" });
    expect(t.session.canUndo()).toBe(true);
  });

  test("Undo from the summary brings the last Card back, revealed", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.session.leave();

    await t.session.undo();

    expect(t.state()).toMatchObject({ phase: "card", revealed: true, undone: true, rated: 0 });
    expect(t.shownId()).toBe("a");
  });

  test("a Queue that runs out while the summary shows makes it the end's summary", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.session.reveal();
    t.session.rate("good");
    // Left while b's Rating saves.
    expect(t.session.leave()).toBe("summary");
    await flush();

    // The Queue ran out meanwhile: the summary is the end's.
    expect(t.state()).toMatchObject({ phase: "done", summary: { studied: 2 } });
  });

  test("a next Card that arrives on the summary waits there", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    t.session.reveal();
    t.session.rate("good");
    await flush();
    t.session.reveal();
    t.session.rate("good");
    t.session.leave();
    await flush();

    expect(t.state()).toMatchObject({ phase: "left", revealed: false });
    t.session.resume();
    expect(t.state().phase).toBe("card");
    expect(t.shownId()).toBe("c");
  });
});

/** A Card as the editor saves it: `front` changed, studied or not. */
const edited = (id: string, front: string, studied = false): Card => ({
  ...card(id),
  front,
  studied,
});

describe("editorCloseAction", () => {
  test("closes at once with nothing unsaved, asks first with something unsaved", () => {
    expect(editorCloseAction({ gone: false, unsaved: false })).toBe("close");
    expect(editorCloseAction({ gone: false, unsaved: true })).toBe("ask");
  });

  test("skips to the next Card when it was deleted elsewhere, unsaved or not", () => {
    expect(editorCloseAction({ gone: true, unsaved: true })).toBe("skip");
    expect(editorCloseAction({ gone: true, unsaved: false })).toBe("skip");
  });
});

describe("editorEscAction", () => {
  const front = { field: "front" };
  const back = { field: "back" };

  test("in a field, the first Esc only leaves it, so Tab can move on", () => {
    expect(editorEscAction(front, null)).toBe("leave-field");
  });

  test("a second Esc in the same field closes the editor", () => {
    expect(editorEscAction(front, front)).toBe("close");
  });

  test("an Esc armed in one field leaves another just the same", () => {
    expect(editorEscAction(back, front)).toBe("leave-field");
  });

  test("anywhere else in the panel, Esc closes at once", () => {
    expect(editorEscAction(null, null)).toBe("close");
    expect(editorEscAction(null, front)).toBe("close");
  });
});

describe("editing the shown Card", () => {
  test("opens before or after the reveal, and turns the study actions off while open", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    expect(t.state()).toMatchObject({ editable: true, editing: false });

    expect(t.session.edit()).toBe(true);
    expect(t.state()).toMatchObject({ editing: true, editable: false, revealed: false });
    t.session.cancelEdit();

    t.session.reveal();
    expect(t.session.edit()).toBe(true);
    expect(t.state()).toMatchObject({ editing: true, ratable: false, revealed: true });

    // Ratings and Undo wait while it is open.
    t.session.rate("good");
    await t.session.undo();
    await flush();
    expect(t.calls.rate).toEqual([]);
    expect(t.calls.undo).toEqual([]);
    expect(t.session.edit()).toBe(false);
  });

  test("Undo waits while it is open, with a Rating standing to take back", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    await revealAndRate(t, "good");
    expect(t.state()).toMatchObject({ undoable: true, shown: { card: { id: "b" } } });

    expect(t.session.edit()).toBe(true);
    await t.session.undo();
    await flush();

    expect(t.calls.undo).toEqual([]);
    expect(t.state()).toMatchObject({
      editing: true,
      undoing: false,
      undoable: true,
      shown: { card: { id: "b" } },
    });
  });

  test("can't open while a Rating or an Undo saves, or with no Card shown", async () => {
    const t = setUp([next("a"), next("b")]);
    t.fail.rate = true;
    expect(t.session.edit()).toBe(false);
    await t.session.start();
    t.session.reveal();
    t.session.rate("good");
    expect(t.state().saving).toBe("good");
    expect(t.session.edit()).toBe(false);
    await flush();
    t.fail.rate = false;
    await revealAndRate(t, "good");

    const undoing = t.session.undo();
    expect(t.state().undoing).toBe(true);
    expect(t.session.edit()).toBe(false);
    await undoing;
    expect(t.session.edit()).toBe(true);
  });

  test("keeps the counters, `after` and the Undo history: rate a Card, edit the next, undo the first", async () => {
    const t = setUp([next("a", "review"), next("b"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    expect(t.shownId()).toBe("b");

    t.session.edit();
    await t.session.saveEdit(edited("b", "b edited"), { progressReset: false });
    expect(t.state().shown?.card.front).toBe("b edited");
    await revealAndRate(t, "easy");
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 1, newShown: 1, batches: 1, after: "b" });

    await t.session.undo();
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r1"]);
    expect(t.shownId()).toBe("a");
  });

  test("Save shows the edited Card revealed or not as it was, its previews unchanged; Cancel shows it unchanged", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.edit();
    await t.session.saveEdit(edited("a", "new front"), { progressReset: false });
    expect(t.state()).toMatchObject({ editing: false, revealed: false, progressReset: false });
    expect(t.state().shown).toEqual({
      card: edited("a", "new front"),
      kind: "new",
      intervals: intervals("a"),
    });

    t.session.reveal();
    t.session.edit();
    t.session.cancelEdit();
    expect(t.state()).toMatchObject({ editing: false, revealed: true, ratable: true });
    expect(t.state().shown?.card.front).toBe("new front");
    expect(t.calls.intervals).toEqual([]);
  });

  test("Save with a Progress reset shows the Card revealed with fresh previews, still counting by its first kind", async () => {
    const t = setUp([next("a", "review"), next("b")]);
    await t.session.start();
    t.session.edit();
    const saving = t.session.saveEdit(edited("a", "a", false), { progressReset: true });
    // Open until the fresh previews are in.
    expect(t.state().editing).toBe(true);
    await saving;

    expect(t.calls.intervals).toEqual(["a"]);
    expect(t.state()).toMatchObject({
      editing: false,
      revealed: true,
      ratable: true,
      progressReset: true,
    });
    expect(t.state().shown).toEqual({
      card: edited("a", "a", false),
      kind: "review",
      intervals: intervals("a-fresh"),
    });

    await revealAndRate(t, "good");
    expect(t.calls.rate).toEqual([{ cardId: "a", rating: "good", durationMs: 0 }]);
    expect(t.state().progressReset).toBe(false);
    expect(t.state().summary).toMatchObject({
      studied: 1,
      newStudied: 0,
      recall: { kept: 1, of: 1 },
    });
  });

  test("fresh previews that don't load leave the reset Card unratable until Try again", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    const previewedAt = t.state().previewedAt;
    t.session.edit();
    t.wait(8 * MINUTE);
    t.fail.intervals = true;
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });

    expect(t.state()).toMatchObject({ editing: false, ratable: false, failure: INTERVALS_FAILED });
    // The old previews, still counted from when they came: Good reads 10m, not 2m.
    expect(t.state().previewedAt).toBe(previewedAt);
    expect(t.state().shown?.intervals).toEqual(intervals("a"));
    t.session.rate("good");
    await flush();
    expect(t.calls.rate).toEqual([]);

    t.fail.intervals = false;
    t.session.retry();
    await flush();
    expect(t.state()).toMatchObject({ ratable: true, failure: undefined });
    expect(t.state().shown?.intervals).toEqual(intervals("a-fresh"));
  });

  test("while Try again loads a reset Card's previews, Undo, Edit and Rating wait", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.session.edit();
    t.fail.intervals = true;
    await t.session.saveEdit(edited("b", "b"), { progressReset: true });
    expect(t.state().failure).toBe(INTERVALS_FAILED);

    const answer = deferred<IntervalPreviews>();
    t.api.intervals = () => answer.promise;
    t.session.retry();
    expect(t.state()).toMatchObject({
      refreshing: true,
      undoable: true,
      editable: false,
      ratable: false,
      failure: undefined,
    });
    await t.session.undo();
    expect(t.session.edit()).toBe(false);
    expect(t.calls.undo).toEqual([]);

    answer.resolve(intervals("b-fresh"));
    await flush();
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ refreshing: false, ratable: true, editable: true });
    expect(t.state().shown?.intervals).toEqual(intervals("b-fresh"));
  });

  test("a reset Card deleted meanwhile is skipped with a message", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.edit();
    t.fail.intervals = "gone";
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });

    expect(t.messages).toEqual([CARD_GONE]);
    expect(t.shownId()).toBe("b");
    expect(t.calls.next.at(-1)).toMatchObject({ after: "a" });
  });

  test("a Card gone from the editor (deleted there or elsewhere) closes it and loads the next", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.session.edit();
    const gone = t.session.closeGone();
    expect(t.state()).toMatchObject({
      editing: false,
      skipping: true,
      ratable: false,
      editable: false,
    });
    await gone;

    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ skipping: false, revealed: false, editable: true });
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 0, newShown: 1, batches: 1, after: "a" });
  });

  test("a next Card that doesn't load after a delete says so, and Try again loads it", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.edit();
    t.fail.next = true;
    await t.session.closeGone();
    expect(t.state()).toMatchObject({ skipping: false, failure: NEXT_FAILED, ratable: false });

    t.fail.next = false;
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("b");
  });

  test("can't open on a Card whose Rating saved while the next one failed to load", async () => {
    const t = setUp([next("a", "review"), next("b")]);
    await t.session.start();
    t.fail.next = true;
    await revealAndRate(t, "good");
    expect(t.state()).toMatchObject({ failure: NEXT_FAILED, editable: false, ratable: false });
    expect(t.session.edit()).toBe(false);

    t.fail.next = false;
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("b");
    expect(t.state().editable).toBe(true);
  });

  test("leaves the time with the editor open, and with a reset's previews on their way, out of the Card's durationMs", async () => {
    const t = setUp([next("a", "review"), next("b")]);
    await t.session.start();
    t.wait(2000);
    t.session.edit();
    t.wait(45_000);
    const answer = deferred<IntervalPreviews>();
    t.api.intervals = () => answer.promise;
    const saving = t.session.saveEdit(edited("a", "a", false), { progressReset: true });
    t.wait(5000);
    answer.resolve(intervals("a-fresh"));
    await saving;
    t.wait(1500);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate).toEqual([{ cardId: "a", rating: "good", durationMs: 3500 }]);
  });

  test("leaves the time with the editor open out of the Card's durationMs", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.wait(2000);
    t.session.edit();
    t.wait(60_000);
    t.session.cancelEdit();
    t.wait(1000);
    t.session.reveal();
    t.session.edit();
    t.wait(30_000);
    await t.session.saveEdit(edited("a", "a2"), { progressReset: false });
    t.wait(500);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate).toEqual([{ cardId: "a", rating: "good", durationMs: 3500 }]);
  });

  test("a Progress reset makes the Card's earlier Ratings stand for good: Undo goes on to the one before, or turns off", async () => {
    const t = setUp([next("b"), next("a"), next("a", "learning"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await revealAndRate(t, "again");
    expect(t.shownId()).toBe("a");

    t.session.edit();
    await t.session.saveEdit(edited("a", "a", false), { progressReset: true });
    await t.session.undo();

    // b's Rating, not a's, which the API would refuse.
    expect(t.calls.undo).toEqual(["r1"]);
    expect(t.messages).toEqual([]);
    expect(t.state()).toMatchObject({ undoable: false, rated: 1 });
  });

  test("a reset Card an Undo took the place of still counts by its first kind when the Queue serves it again", async () => {
    // The Queue serves a again as New: the API has it New since the reset.
    const t = setUp([next("b", "review"), next("a", "review"), next("a", "new")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.session.edit();
    await t.session.saveEdit(edited("a", "a", false), { progressReset: true });

    await t.session.undo();
    expect(t.shownId()).toBe("b");
    await revealAndRate(t, "good");
    expect(t.state().shown?.kind).toBe("review");
    await revealAndRate(t, "good");

    expect(t.state().summary).toMatchObject({
      studied: 2,
      newStudied: 0,
      recall: { kept: 2, of: 2 },
    });
  });

  test("a reset Card counts by the kind it first came with, not the one it was shown with when reset", async () => {
    // a comes New, then back in its learning steps, is reset there, and the
    // Queue serves it again (New) after an Undo took b's Rating back.
    const t = setUp([next("b", "review"), next("a"), next("a", "learning"), next("a")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await revealAndRate(t, "again");
    expect(t.state().shown?.kind).toBe("learning");
    t.session.edit();
    await t.session.saveEdit(edited("a", "a", false), { progressReset: true });

    await t.session.undo();
    expect(t.shownId()).toBe("b");
    await revealAndRate(t, "good");
    expect(t.shownId()).toBe("a");
    expect(t.state().shown?.kind).toBe("new");
  });

  test("a Card back from Undo, then reset, is no longer marked as back from Undo", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await t.session.undo();
    expect(t.state().undone).toBe(true);

    t.session.edit();
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });

    expect(t.state()).toMatchObject({ undone: false, progressReset: true });
  });

  test("leaving while the editor is on its way (a frame later) does nothing", async () => {
    const later: (() => void)[] = [];
    const server = fakeApi([next("a"), next("b"), next("c")]);
    const session = createStudySession({
      studyApi: server.api,
      notify: () => {},
      transition: (update) => later.push(update),
    });
    await session.start();
    session.reveal();
    session.rate("good");
    await flush();
    expect(session.edit()).toBe(true);

    expect(session.leave()).toBe("stay");
    for (const update of later.splice(0)) update();
    expect(session.getState()).toMatchObject({ phase: "card", editing: true });
  });

  test("once stopped, a reset's answer says nothing and moves nothing", async () => {
    const transitions: number[] = [];
    const messages: string[] = [];
    const server = fakeApi([next("a"), next("b")]);
    const session = createStudySession({
      studyApi: server.api,
      notify: (message) => messages.push(message),
      transition: (update) => {
        transitions.push(1);
        update();
      },
    });
    await session.start();
    session.edit();
    const answer = deferred<"gone">();
    server.api.intervals = () => answer.promise;
    const saving = session.saveEdit(edited("a", "a"), { progressReset: true });
    session.stop();
    answer.resolve("gone");
    await saving;

    expect(messages).toEqual([]);
    expect(transitions).toEqual([1]);
  });

  test("runs opening and closing the editor through `transition`", async () => {
    const transitions: boolean[] = [];
    const session = createStudySession({
      studyApi: fakeApi([next("a")]).api,
      notify: () => {},
      transition: (update) => {
        update();
        transitions.push(session.getState().editing);
      },
    });
    await session.start();
    session.edit();
    session.cancelEdit();

    expect(transitions).toEqual([true, false]);
  });

  test("in the frame before the editor shows, a press of Space or of a Rating does nothing", async () => {
    const later: (() => void)[] = [];
    const server = fakeApi([next("a"), next("b")]);
    const session = createStudySession({
      studyApi: server.api,
      notify: () => {},
      transition: (update) => later.push(update),
    });
    await session.start();
    expect(session.edit()).toBe(true);
    session.reveal();
    expect(session.getState().revealed).toBe(false);
    for (const update of later.splice(0)) update();
    session.cancelEdit();
    for (const update of later.splice(0)) update();

    session.reveal();
    expect(session.edit()).toBe(true);
    session.rate("good");
    await flush();
    expect(server.calls.rate).toEqual([]);
    for (const update of later.splice(0)) update();
    expect(session.getState()).toMatchObject({ editing: true, revealed: true });
    expect(session.getState().shown?.card.id).toBe("a");
  });

  test("started again before the editor's frame, it doesn't open on the new first Card", async () => {
    const later: (() => void)[] = [];
    const server = fakeApi([next("a"), next("b")]);
    const session = createStudySession({
      studyApi: server.api,
      notify: () => {},
      now: () => NOW,
      transition: (update) => later.push(update),
    });
    await session.start();
    expect(session.edit()).toBe(true);
    session.stop();
    await session.start();
    expect(session.getState().shown?.card.id).toBe("b");
    for (const update of later.splice(0)) update();

    expect(session.getState()).toMatchObject({ editing: false, editable: true });
    session.reveal();
    expect(session.getState().ratable).toBe(true);
  });

  test("started again with the editor open, a first Card that can't load closes it", async () => {
    const t = setUp([next("a")]);
    await t.session.start();
    t.session.edit();
    expect(t.state().editing).toBe(true);
    t.session.stop();
    t.fail.next = true;
    await t.session.start();

    expect(t.state()).toMatchObject({ phase: "unreachable", editing: false });
  });

  test("started again while a Rating saves, a first Card that can't load leaves Try again working", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    const saved = deferred<{ reviewId: string }>();
    t.api.rate = () => saved.promise;
    await revealAndRate(t, "good");
    expect(t.state().saving).toBe("good");
    t.session.stop();
    t.fail.next = true;
    await t.session.start();
    saved.resolve({ reviewId: "r1" });
    await flush();

    expect(t.state()).toMatchObject({ phase: "unreachable", saving: undefined });
    t.fail.next = false;
    t.session.retry();
    await flush();
    expect(t.state().phase).toBe("card");
  });

  test("stopped before the editor's frame, it never opens, and a start that follows isn't held up", async () => {
    const later: (() => void)[] = [];
    const server = fakeApi([next("a"), next("b"), next("c")]);
    const session = createStudySession({
      studyApi: server.api,
      notify: () => {},
      now: () => NOW,
      transition: (update) => later.push(update),
    });
    await session.start();
    expect(session.edit()).toBe(true);
    session.stop();
    for (const update of later.splice(0)) update();
    await session.start();

    expect(session.getState()).toMatchObject({ editing: false, editable: true });
    expect(session.leave()).toBe("away");
    session.reveal();
    session.rate("good");
    await flush();
    expect(server.calls.rate).toEqual([{ cardId: "b", rating: "good", durationMs: 0 }]);
  });

  test("a transition that shows a frame later still opens the editor once, and loses no next Card", async () => {
    const later: (() => void)[] = [];
    const server = fakeApi([next("a"), next("b")]);
    const session = createStudySession({
      studyApi: server.api,
      notify: () => {},
      transition: (update) => later.push(update),
    });
    await session.start();
    expect(session.edit()).toBe(true);
    expect(session.edit()).toBe(false);
    for (const update of later.splice(0)) update();

    // The next Card comes before the closing frame does, and the editor doesn't open on it.
    await session.closeGone();
    expect(session.getState().shown?.card.id).toBe("b");
    expect(session.getState().editing).toBe(false);
    for (const update of later.splice(0)) update();
    expect(session.getState()).toMatchObject({ editing: false, skipping: false, editable: true });
  });
});

/** A Session showing `a` just reset, its fresh previews failed. */
async function resetFailed(queue: NextCard[]) {
  const t = setUp(queue);
  await t.session.start();
  t.session.edit();
  t.fail.intervals = true;
  await t.session.saveEdit(edited("a", "a"), { progressReset: true });
  expect(t.state().failure).toBe(INTERVALS_FAILED);
  return t;
}

describe("after a Progress reset", () => {
  test("Try again finding the Card deleted meanwhile skips it with a message, and loads the one after it", async () => {
    const t = await resetFailed([next("a"), next("b")]);
    t.fail.intervals = "gone";
    t.session.retry();
    expect(t.state()).toMatchObject({ refreshing: true });
    await flush();

    expect(t.messages).toEqual([CARD_GONE]);
    expect(t.shownId()).toBe("b");
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 0, newShown: 1, batches: 1, after: "a" });
    expect(t.state()).toMatchObject({ refreshing: false, skipping: false, failure: undefined });
  });

  test("Try again finding the Card deleted drops Back to New while the next one loads", async () => {
    const t = await resetFailed([next("a"), next("b")]);
    t.fail.intervals = "gone";
    const answer = deferred<NextAnswer>();
    t.api.next = () => answer.promise;
    t.session.retry();
    await flush();

    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ skipping: true, progressReset: false, failure: undefined });
    answer.resolve({ next: next("b"), newHeld: 0 });
    await flush();
    expect(t.shownId()).toBe("b");
  });

  test("a reset Card found deleted on Save, after an Undo, drops rate it again while the next one loads", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await t.session.undo();
    expect(t.state()).toMatchObject({ undone: true });
    t.session.edit();
    t.fail.intervals = "gone";
    const answer = deferred<NextAnswer>();
    t.api.next = () => answer.promise;
    const saving = t.session.saveEdit(edited("a", "a"), { progressReset: true });
    await flush();

    expect(t.state()).toMatchObject({ skipping: true, undone: false, progressReset: false });
    answer.resolve({ next: next("b"), newHeld: 0 });
    await saving;
    expect(t.shownId()).toBe("b");
  });

  test("Try again's answer changes nothing once another Card shows (started again)", async () => {
    const t = await resetFailed([next("a"), next("b")]);
    const answer = deferred<IntervalPreviews>();
    t.api.intervals = () => answer.promise;
    t.session.retry();
    t.session.stop();
    await t.session.start();
    expect(t.shownId()).toBe("b");

    answer.resolve(intervals("a-fresh"));
    await flush();
    expect(t.shownId()).toBe("b");
    expect(t.state().shown?.intervals).toEqual(intervals("b"));
    expect(t.state()).toMatchObject({ refreshing: false, progressReset: false });
  });

  test("started again with the editor open, closes it, and a Progress reset's answer for the old Card changes nothing", async () => {
    const t = setUp([next("a", "review"), next("b"), next("c")]);
    await t.session.start();
    t.session.edit();
    const answer = deferred<IntervalPreviews>();
    t.api.intervals = () => answer.promise;
    const saving = t.session.saveEdit(edited("a", "a"), { progressReset: true });
    t.session.stop();
    await t.session.start();
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ editing: false, ratable: false });
    // The editor opened again, on the new first Card.
    expect(t.session.edit()).toBe(true);

    answer.resolve(intervals("a-fresh"));
    await saving;
    expect(t.shownId()).toBe("b");
    expect(t.state().shown?.intervals).toEqual(intervals("b"));
    expect(t.state()).toMatchObject({ editing: true, progressReset: false, turning: false });
    t.session.cancelEdit();
    expect(t.state().editing).toBe(false);
  });

  test("Try again's failure or 404 changes nothing once another Card shows (started again)", async () => {
    for (const answer of ["failed", "gone"] as const) {
      const t = await resetFailed([next("a"), next("b"), next("c")]);
      const pending = deferred<"gone">();
      t.api.intervals = async () => {
        const gone = await pending.promise;
        if (answer === "failed") throw new Error("offline");
        return gone;
      };
      t.session.retry();
      t.session.stop();
      await t.session.start();
      expect(t.shownId()).toBe("b");
      expect(t.state()).toMatchObject({ refreshing: false, ratable: false });

      pending.resolve("gone");
      await flush();
      expect(t.shownId()).toBe("b");
      expect(t.state()).toMatchObject({ failure: undefined, skipping: false, editable: true });
      expect(t.messages).toEqual([]);
      t.session.reveal();
      expect(t.state().ratable).toBe(true);
    }
  });

  test("turns the Intervals over on the close that follows it only", async () => {
    const t = setUp([next("a", "review"), next("b")]);
    await t.session.start();
    t.session.edit();
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });
    expect(t.state()).toMatchObject({ progressReset: true, turning: true });

    t.session.edit();
    expect(t.state().turning).toBe(false);
    t.session.cancelEdit();
    expect(t.state()).toMatchObject({ progressReset: true, turning: false });
  });

  test("is over before the next open's transition starts, so the Intervals leave with the dock", async () => {
    // What each transition starts from: the screen as it stands before its update.
    const before: boolean[] = [];
    const session = createStudySession({
      studyApi: fakeApi([next("a", "review"), next("b")]).api,
      notify: () => {},
      transition: (update) => {
        before.push(session.getState().turning);
        update();
      },
    });
    await session.start();
    session.edit();
    await session.saveEdit(edited("a", "a"), { progressReset: true });
    expect(session.getState().turning).toBe(true);

    session.edit();
    expect(before).toEqual([false, false, false]);
  });

  test("turns nothing over when its fresh previews failed, nor once Try again loads them", async () => {
    const t = await resetFailed([next("a"), next("b")]);
    expect(t.state()).toMatchObject({ progressReset: true, turning: false });

    t.fail.intervals = false;
    t.session.retry();
    await flush();
    expect(t.state().shown?.intervals).toEqual(intervals("a-fresh"));
    expect(t.state()).toMatchObject({ progressReset: true, turning: false });
  });

  test("an Undo from the reset Card drops Back to New and the turnover with it", async () => {
    const t = setUp([next("b", "review"), next("a", "review")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.session.edit();
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });
    expect(t.state()).toMatchObject({ progressReset: true, turning: true });

    await t.session.undo();

    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ progressReset: false, turning: false });
  });

  test("an Undo from the reset Card whose previews failed drops Back to New and the failure", async () => {
    const t = setUp([next("b", "review"), next("a", "review")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.session.edit();
    t.fail.intervals = true;
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });
    expect(t.state()).toMatchObject({ progressReset: true, failure: INTERVALS_FAILED });

    await t.session.undo();

    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ progressReset: false, turning: false, failure: undefined });
    expect(t.state().ratable).toBe(true);
  });
});

describe("editing while a Rating didn't save", () => {
  test("a Save keeps it, and Try again sends it as it was", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.wait(3000);
    t.fail.rate = true;
    t.session.rate("good");
    await flush();
    expect(t.state()).toMatchObject({ failure: RATE_FAILED, editable: true });

    t.session.edit();
    await t.session.saveEdit(edited("a", "a2"), { progressReset: false });
    expect(t.state()).toMatchObject({ failure: RATE_FAILED, ratable: true });

    t.fail.rate = false;
    t.session.retry();
    await flush();
    expect(t.calls.rate).toEqual([
      { cardId: "a", rating: "good", durationMs: 3000 },
      { cardId: "a", rating: "good", durationMs: 3000 },
    ]);
    expect(t.shownId()).toBe("b");
  });

  test("a Card gone from the editor takes its failure and Try again with it while the next one loads", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.fail.rate = true;
    t.session.rate("good");
    await flush();
    t.session.edit();
    const answer = deferred<NextAnswer>();
    t.api.next = () => answer.promise;
    const gone = t.session.closeGone();

    expect(t.state()).toMatchObject({ skipping: true, failure: undefined, undone: false });
    t.session.retry();
    expect(t.calls.rate).toHaveLength(1);
    answer.resolve({ next: next("b"), newHeld: 0 });
    await gone;
    expect(t.shownId()).toBe("b");
  });

  test("a Progress reset drops it: Try again sends nothing, and the Card is rated afresh", async () => {
    const t = setUp([next("a", "review"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.fail.rate = true;
    t.session.rate("good");
    await flush();

    t.session.edit();
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });
    expect(t.state()).toMatchObject({ failure: undefined, ratable: true, progressReset: true });

    t.fail.rate = false;
    t.session.retry();
    await flush();
    expect(t.calls.rate).toHaveLength(1);
    t.session.rate("again");
    await flush();
    expect(t.calls.rate.at(-1)).toMatchObject({ cardId: "a", rating: "again" });
  });
});

describe("a stopped Session", () => {
  test("started again, its first Card failing, lets Try again run though a Try again was on its way", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.fail.next = true;
    await revealAndRate(t, "good");
    expect(t.state().failure).toBe(NEXT_FAILED);
    const pending = deferred<NextAnswer>();
    const serve = t.api.next;
    t.api.next = () => pending.promise;
    t.session.retry();
    expect(t.state().skipping).toBe(true);

    t.session.stop();
    t.api.next = serve;
    await t.session.start();
    expect(t.state()).toMatchObject({ phase: "unreachable", skipping: false, refreshing: false });

    t.fail.next = false;
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("b");
  });

  test("started again while a Rating saves, takes nothing from it: no Rating to undo, no Card loaded after it", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    const saved = deferred<{ reviewId: string }>();
    t.api.rate = () => saved.promise;
    t.session.reveal();
    t.session.rate("good");

    t.session.stop();
    await t.session.start();
    expect(t.shownId()).toBe("b");
    saved.resolve({ reviewId: "r1" });
    await flush();

    expect(t.calls.next).toHaveLength(2);
    expect(t.state()).toMatchObject({ rated: 0, undoable: false });
    expect(t.shownId()).toBe("b");
  });

  test("loads no next Card for one gone from the editor", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    t.session.edit();
    t.session.stop();
    await t.session.closeGone();

    expect(t.calls.next).toHaveLength(1);
    expect(t.shownId()).toBe("a");
  });

  test("shows no next Card that answers after it stopped", async () => {
    const t = setUp([next("a"), next("b")]);
    await t.session.start();
    const answer = deferred<{ next: NextCard; newHeld: number }>();
    t.api.next = () => answer.promise;
    t.session.edit();
    const gone = t.session.closeGone();
    t.session.stop();
    answer.resolve({ next: next("b"), newHeld: 0 });
    await gone;

    expect(t.shownId()).toBe("a");
  });

  test("started again while an Undo is on its way, isn't held up by it, and its answer replaces nothing", async () => {
    const t = setUp([next("a"), next("b"), next("c"), next("d")]);
    await t.session.start();
    await revealAndRate(t, "good");
    const back = deferred<Awaited<ReturnType<StudyApi["undo"]>>>();
    t.api.undo = () => back.promise;
    const undone = t.session.undo();
    expect(t.state().undoing).toBe(true);

    t.session.stop();
    await t.session.start();
    expect(t.shownId()).toBe("c");
    expect(t.state()).toMatchObject({ undoing: false, editable: true });

    back.resolve({ card: card("a"), intervals: intervals("a-undone") });
    await undone;
    // Its Review deleted, the Rating no longer counts, but "c" stays shown.
    expect(t.shownId()).toBe("c");
    expect(t.state()).toMatchObject({ rated: 0, undoable: false, revealed: false });
  });

  test("an Undo that answers while stopped doesn't hold up the start that follows", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    const back = deferred<Awaited<ReturnType<StudyApi["undo"]>>>();
    t.api.undo = () => back.promise;
    const undone = t.session.undo();
    t.session.stop();
    back.resolve({ card: card("a"), intervals: intervals("a-undone") });
    await undone;

    await t.session.start();
    expect(t.shownId()).toBe("c");
    expect(t.state()).toMatchObject({ undoing: false, editable: true, rated: 0 });
    t.session.reveal();
    expect(t.state().ratable).toBe(true);
  });

  test("started again while another batch loads, a first Card that can't load leaves Try again working", async () => {
    const t = await ranOut();
    const batch = deferred<NextAnswer>();
    const serve = t.api.next;
    t.api.next = () => batch.promise;
    t.session.more();
    expect(t.state().loadingMore).toBe(true);

    t.session.stop();
    t.api.next = serve;
    t.fail.next = true;
    await t.session.start();
    expect(t.state()).toMatchObject({ phase: "unreachable", loadingMore: false });
    // The old batch's answer shows nothing.
    batch.resolve({ next: next("x"), newHeld: 0 });
    await flush();
    expect(t.state().phase).toBe("unreachable");

    t.fail.next = false;
    t.queue.push(next("c"));
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("c");
  });
  test("an Undo sent again after a restart, answered gone, takes back no other Rating", async () => {
    const t = setUp([next("a"), next("b"), next("c"), next("d")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await revealAndRate(t, "good");
    const answers = [deferred<UndoAnswer>(), deferred<UndoAnswer>()];
    t.api.undo = (reviewId) => {
      t.calls.undo.push(reviewId);
      return answers[t.calls.undo.length - 1]!.promise;
    };
    void t.session.undo();
    t.session.stop();
    await t.session.start();
    void t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r2"]);

    answers[0]!.resolve({ card: card("b"), intervals: intervals("b-undone") });
    answers[1]!.resolve("gone");
    await flush();

    // a's Rating still stands, so Undo takes it back next.
    t.api.undo = async (reviewId) => {
      t.calls.undo.push(reviewId);
      return { card: card("a"), intervals: intervals("a-undone") };
    };
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r2", "r2", "r1"]);
    expect(t.shownId()).toBe("a");
  });

  test("started again before a Save's closing frame, the old Card doesn't come back over the new one", async () => {
    const later: (() => void)[] = [];
    const server = fakeApi([next("a"), next("b")]);
    const session = createStudySession({
      studyApi: server.api,
      notify: () => {},
      now: () => NOW,
      transition: (update) => later.push(update),
    });
    await session.start();
    session.edit();
    for (const update of later.splice(0)) update();
    await session.saveEdit(edited("a", "a2"), { progressReset: false });
    session.stop();
    await session.start();
    expect(session.getState().shown?.card.id).toBe("b");

    for (const update of later.splice(0)) update();

    expect(session.getState().shown?.card.id).toBe("b");
    expect(session.getState().editing).toBe(false);
  });
});

function studySaving(outcome: CardOutcome) {
  const steps: string[] = [];
  const sent: { resetProgress: boolean }[] = [];
  const session = {
    saveEdit: vi.fn(async (savedCard: Card, options: { progressReset: boolean }) => {
      steps.push(`saveEdit ${savedCard.front} ${options.progressReset}`);
    }),
  };
  const update = async (options: { resetProgress: boolean }) => {
    sent.push(options);
    return outcome;
  };
  return { steps, sent, session, update, saved: () => steps.push("saved") };
}

describe("saveStudyEdit", () => {
  const studied = edited("a", "a", true);

  test("a ticked Reset progress on a studied Card resets it, and closes the editor on it reset", async () => {
    const s = studySaving({ ok: true, card: edited("a", "a2") });
    await saveStudyEdit(s.session, studied, true, s.update, s.saved);

    expect(s.sent).toEqual([{ resetProgress: true }]);
    expect(s.steps).toEqual(["saved", "saveEdit a2 true"]);
  });

  test("unticked, or on a New Card, it only saves the edit", async () => {
    const unticked = studySaving({ ok: true, card: studied });
    await saveStudyEdit(unticked.session, studied, false, unticked.update, unticked.saved);
    expect(unticked.sent).toEqual([{ resetProgress: false }]);
    expect(unticked.steps).toEqual(["saved", "saveEdit a false"]);

    const fresh = studySaving({ ok: true, card: edited("a", "a") });
    await saveStudyEdit(fresh.session, edited("a", "a"), true, fresh.update, fresh.saved);
    expect(fresh.sent).toEqual([{ resetProgress: false }]);
    expect(fresh.steps).toEqual(["saved", "saveEdit a false"]);
  });

  test("one that didn't save leaves the editor open and answers why", async () => {
    const s = studySaving({ ok: false, notFound: true });
    expect(await saveStudyEdit(s.session, studied, true, s.update, s.saved)).toEqual({
      ok: false,
      notFound: true,
    });
    expect(s.steps).toEqual([]);
  });
});

/** A Session over `queue` with an editorOpener whose Deck's Cards arrive when the test says. */
function opening(queue: NextCard[]) {
  const t = setUp(queue);
  let cards = deferred<void>();
  const failures: string[] = [];
  const opener = editorOpener({
    session: t.session,
    ready: () => cards.promise,
    notify: (message) => failures.push(message),
  });
  return {
    ...t,
    opener,
    failures,
    /** The Cards arrive. */
    load: async () => {
      cards.resolve();
      await flush();
    },
    /** What makes the Cards the latest press waits on arrive, kept for later. */
    pending: () => {
      const waited = cards;
      return async () => {
        waited.resolve();
        await flush();
      };
    },
    /** The Cards fail to load, for the next press. */
    failing: () => {
      cards = { promise: Promise.reject(new Error("offline")), resolve: () => {} };
      cards.promise.catch(() => {});
    },
    /** The Cards are in already, for the next press. */
    cached: () => {
      cards = { promise: Promise.resolve(), resolve: () => {} };
    },
  };
}

describe("opening the editor once the Deck's Cards are in", () => {
  test("opens on the Card it was asked for once they arrive, not before", async () => {
    const t = opening([next("a"), next("b")]);
    await t.session.start();
    t.opener.open();
    expect(t.state().editing).toBe(false);

    await t.load();
    expect(t.state()).toMatchObject({ editing: true });
    expect(t.shownId()).toBe("a");
  });

  test("with them cached, opens at once", async () => {
    const t = opening([next("a")]);
    await t.session.start();
    t.cached();
    t.opener.open();
    await flush();

    expect(t.state().editing).toBe(true);
  });

  test("while the Cards hang, only the newest press watches the Session, and none once stopped", async () => {
    const t = setUp([next("a")]);
    await t.session.start();
    let watching = 0;
    const opener = editorOpener({
      session: {
        getState: () => t.session.getState(),
        edit: () => t.session.edit(),
        subscribe: (listener) => {
          watching += 1;
          const unsubscribe = t.session.subscribe(listener);
          let done = false;
          return () => {
            if (!done) watching -= 1;
            done = true;
            unsubscribe();
          };
        },
      },
      ready: () => new Promise(() => {}),
      notify: () => {},
    });
    opener.open();
    opener.open();
    opener.open();
    expect(watching).toBe(1);

    opener.stop();
    expect(watching).toBe(0);
  });

  test("Cards that don't load leave it closed, and say so", async () => {
    const t = opening([next("a")]);
    await t.session.start();
    t.failing();
    t.opener.open();
    await flush();

    expect(t.state().editing).toBe(false);
    expect(t.failures).toEqual([EDITOR_FAILED]);
  });

  test("opens nothing when the Card shown changed meanwhile", async () => {
    const t = opening([next("a"), next("b")]);
    await t.session.start();
    t.opener.open();
    await revealAndRate(t, "good");
    expect(t.shownId()).toBe("b");

    await t.load();
    expect(t.state().editing).toBe(false);
  });

  test("opens nothing when the same Card is back from a Rating and its Undo meanwhile", async () => {
    const t = opening([next("a"), next("b")]);
    await t.session.start();
    t.opener.open();
    await revealAndRate(t, "again");
    await t.session.undo();
    expect(t.shownId()).toBe("a");

    await t.load();
    expect(t.state().editing).toBe(false);
  });

  test("opens nothing when the User left for the summary meanwhile, even back again", async () => {
    const t = opening([next("a"), next("b")]);
    await t.session.start();
    await revealAndRate(t, "good");
    t.opener.open();
    expect(t.session.leave()).toBe("summary");
    t.session.resume();
    expect(t.state().phase).toBe("card");

    await t.load();
    expect(t.state().editing).toBe(false);
  });

  test("an earlier press opens nothing once another came", async () => {
    const t = opening([next("a")]);
    await t.session.start();
    t.opener.open();
    const first = t.pending();
    t.cached();
    t.opener.open();
    await flush();
    expect(t.state().editing).toBe(true);
    t.session.cancelEdit();

    await first();
    expect(t.state().editing).toBe(false);
  });

  test("once the screen went, opens nothing and says nothing", async () => {
    const t = opening([next("a")]);
    await t.session.start();
    t.opener.open();
    t.opener.stop();
    await t.load();
    expect(t.state().editing).toBe(false);

    t.failing();
    t.opener.open();
    await flush();
    expect(t.failures).toEqual([]);
  });

  test("mounted again after the screen went, opens as before", async () => {
    const t = opening([next("a")]);
    await t.session.start();
    t.opener.stop();
    t.opener.start();
    t.cached();
    t.opener.open();
    await flush();

    expect(t.state().editing).toBe(true);
  });

  test("a stopped Session doesn't open the editor", async () => {
    const t = setUp([next("a")]);
    await t.session.start();
    t.session.stop();

    expect(t.session.edit()).toBe(false);
  });
});

/**
 * The study API over a server that answers `res` to `route` (a method and
 * a path), and fails any other request, so a call to the wrong route can't pass.
 */
const answering = (route: string, res: () => Response) =>
  studyApi(
    "d1",
    createApiClient(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const request = new Request(new URL(url, "http://banki.test"), init);
        const asked = `${request.method} ${new URL(request.url).pathname}`;
        if (asked !== route) throw new Error(`Unexpected request: ${asked}`);
        return res();
      }),
    ),
  );

const UNDO_R1 = "DELETE /api/reviews/r1";
const INTERVALS_A = "GET /api/cards/a/intervals";

describe("studyApi", () => {
  test("an Undo answers the Card back with its previews, 404 as gone and 409 as settled", async () => {
    const back = { card: card("a"), intervals: intervals("a") };
    const schedule = {
      state: "new",
      due: null,
      stability: 0,
      difficulty: 0,
      reps: 0,
      lapses: 0,
      scheduledDays: 0,
      lastReview: null,
    };
    await expect(
      answering(UNDO_R1, () => Response.json({ ...back, schedule })).undo("r1"),
    ).resolves.toEqual(back);
    await expect(
      answering(UNDO_R1, () => new Response(null, { status: 404 })).undo("r1"),
    ).resolves.toBe("gone");
    await expect(
      answering(UNDO_R1, () => new Response(null, { status: 409 })).undo("r1"),
    ).resolves.toBe("settled");
    await expect(
      answering(UNDO_R1, () => new Response(null, { status: 500 })).undo("r1"),
    ).rejects.toThrow();
  });

  test("a Card's previews answer as they are, 404 as gone", async () => {
    await expect(
      answering(INTERVALS_A, () => Response.json(intervals("a"))).intervals("a"),
    ).resolves.toEqual(intervals("a"));
    await expect(
      answering(INTERVALS_A, () => new Response(null, { status: 404 })).intervals("a"),
    ).resolves.toBe("gone");
    await expect(
      answering(INTERVALS_A, () => new Response(null, { status: 500 })).intervals("a"),
    ).rejects.toThrow();
  });
});

const TIMEOUT = 30 * MINUTE;

/**
 * Sessions over one fake API and one fake storage, on one clock, as a browser
 * would run them across reloads: `session` is the one open now, and `reload`
 * stops it and opens the next, which resumes from the storage.
 */
function browsing(queue: NextCard[], storage = memoryStorage(), mode: AnswerMode = "self-rate") {
  const server = fakeApi(queue);
  const messages: string[] = [];
  let time = NOW;
  const timeout = { ms: TIMEOUT };
  /** The Deck's Answer mode, as a new Session reads it. */
  const deck: { mode: AnswerMode } = { mode };
  const open = () =>
    createStudySession({
      studyApi: server.api,
      notify: (message) => messages.push(message),
      now: () => time,
      store: sessionStore("d1", storage),
      timeoutMs: () => timeout.ms,
      answerMode: () => deck.mode,
    });
  const t = {
    ...server,
    storage,
    messages,
    timeout,
    deck,
    session: open(),
    state: () => t.session.getState(),
    shownId: () => t.session.getState().shown?.card.id,
    wait: (ms: number) => {
      time += ms;
    },
    /** The stored Session, as the next reload reads it. */
    stored: () => sessionStore("d1", storage).read(),
    /** Closes the tab (or reloads it) and opens Study again. */
    reload: async () => {
      t.session.stop();
      t.session = open();
      await t.session.start();
    },
  };
  return t;
}

/** Reveals and rates the Card shown in `t`'s open Session, waiting for the next one. */
async function rateIn(t: ReturnType<typeof browsing>, rating: Rating) {
  t.session.reveal();
  t.session.rate(rating);
  await flush();
}

describe("a saved Session", () => {
  test("survives a restart: counters, seen Cards, standing Ratings and the shown Card, revealed, with its time", async () => {
    const t = browsing([next("a", "review"), next("b", "new"), next("c", "new")]);
    await t.session.start();
    t.wait(3000);
    await rateIn(t, "good");
    t.session.reveal();
    t.wait(5000);

    await t.reload();

    // Re-read, with fresh previews.
    expect(t.calls.card).toEqual(["b"]);
    expect(t.calls.intervals).toEqual(["b"]);
    expect(t.state()).toMatchObject({
      phase: "card",
      revealed: true,
      undone: false,
      ratable: true,
      rated: 1,
      summary: { studied: 1, recall: { kept: 1, of: 1 } },
    });
    expect(t.state().shown).toEqual({
      card: card("b"),
      kind: "new",
      intervals: intervals("b-fresh"),
    });
    t.wait(1000);
    t.session.rate("easy");
    await flush();
    expect(t.calls.rate.map((rated) => rated.durationMs)).toEqual([3000, 6000]);
    // The counters and `after` went on as they were: a and b counted once each.
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 1, newShown: 1, batches: 1, after: "b" });
    expect(t.state().summary).toMatchObject({ studied: 2, newStudied: 1 });
  });

  test("stores IDs, counts and timings only, never a Card's content", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");

    const raw = t.storage.getItem("banki.session.d1") ?? "";
    expect(raw).toContain('"b"');
    expect(raw).not.toContain("front");
    expect(raw).not.toContain("back");
  });

  test("keeps its batches", async () => {
    const t = browsing([next("a", "new")]);
    t.held.count = 5;
    await t.session.start();
    await rateIn(t, "good");
    t.queue.push(next("b", "new"));
    t.session.more();
    await flush();
    expect(t.shownId()).toBe("b");

    await t.reload();
    await rateIn(t, "good");

    expect(t.calls.next.at(-1)).toMatchObject({ newShown: 2, batches: 2, after: "b" });
  });

  test("shows a Card back from an Undo as it was: revealed, to rate again, its time the undone one's plus the time since", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    t.wait(2000);
    await rateIn(t, "again");
    await t.session.undo();
    t.wait(500);

    await t.reload();
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ revealed: true, undone: true, rated: 0 });
    t.wait(1000);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate.map((rated) => rated.durationMs)).toEqual([2000, 3500]);
  });

  test("Undo after a restart takes back a Rating from before it", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "hard");

    await t.reload();
    await t.session.undo();

    expect(t.calls.undo).toEqual(["r1"]);
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ undone: true, rated: 0 });
  });

  test.each(["gone", "settled"] as const)(
    "Undo after a restart of a Review that is %s skips it with its message",
    async (answer) => {
      const t = browsing([next("a"), next("b")]);
      await t.session.start();
      await rateIn(t, "good");

      await t.reload();
      t.fail.undo = answer;
      await t.session.undo();

      expect(t.messages).toEqual([UNDO_GONE]);
      expect(t.shownId()).toBe("b");
      expect(t.state().rated).toBe(answer === "gone" ? 0 : 1);
      expect(t.session.canUndo()).toBe(false);
    },
  );

  test("skips a shown Card deleted or moved meanwhile, for the next Card after it", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    await rateIn(t, "good");
    t.missing.add("b");

    await t.reload();

    expect(t.calls.card).toEqual(["b"]);
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 0, newShown: 2, batches: 1, after: "b" });
    expect(t.shownId()).toBe("c");
    expect(t.state()).toMatchObject({ phase: "card", rated: 1 });
  });

  test("whose Queue had run out asks study/next with its counters: the next Card when one is due again", async () => {
    const t = browsing([next("a", "review")]);
    await t.session.start();
    await rateIn(t, "again");
    expect(t.state().phase).toBe("done");
    // a's learning step ended meanwhile.
    t.queue.push(next("a", "learning"));

    await t.reload();

    expect(t.calls.card).toEqual([]);
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 1, newShown: 0, batches: 1, after: "a" });
    expect(t.shownId()).toBe("a");
    // Still counted as the review Card it first came as.
    expect(t.state()).toMatchObject({
      phase: "card",
      summary: { studied: 1, recall: { kept: 0, of: 1 } },
    });
  });

  test("whose Queue had run out shows the end, with the whole Session's summary and the offer of another batch", async () => {
    const t = browsing([next("a", "new"), next("b", "review")]);
    t.held.count = 37;
    await t.session.start();
    await rateIn(t, "good");
    await rateIn(t, "good");

    await t.reload();

    expect(t.state()).toMatchObject({
      phase: "done",
      newHeld: 37,
      rated: 2,
      summary: { studied: 2, newStudied: 1 },
    });
    expect(t.session.canUndo()).toBe(true);
  });

  test("left to its summary, resumes at its Card, its time as it was when left", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(4000);
    expect(t.session.leave()).toBe("summary");
    t.wait(60_000);

    await t.reload();
    expect(t.state().phase).toBe("card");
    expect(t.shownId()).toBe("b");
    t.session.reveal();
    t.wait(1000);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate.at(-1)?.durationMs).toBe(5000);
  });

  test("that hasn't shown a Card is never stored", async () => {
    const t = browsing([]);
    await t.session.start();

    expect(t.state().phase).toBe("nothing");
    expect(t.storage.map.size).toBe(0);
  });

  test("in blocked storage still studies, without resume", async () => {
    const blocked = {
      map: new Map<string, string>(),
      get length(): number {
        throw new Error("SecurityError");
      },
      key: () => {
        throw new Error("SecurityError");
      },
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const t = browsing([next("a"), next("b"), next("c")], blocked);
    await t.session.start();
    await rateIn(t, "good");
    expect(t.shownId()).toBe("b");

    await t.reload();

    // A fresh Session: nothing resumed, nothing counted.
    expect(t.calls.card).toEqual([]);
    expect(t.calls.next.at(-1)).toEqual({
      reviewsShown: 0,
      newShown: 0,
      batches: 1,
      after: undefined,
    });
    expect(t.state()).toMatchObject({ phase: "card", rated: 0 });
  });

  test("that can't be read starts fresh", async () => {
    for (const raw of ["{not json", '{"reviewsShown":"many"}', "null"]) {
      const t = browsing([next("a")], memoryStorage({ "banki.session.d1": raw }));
      await t.session.start();

      expect(t.calls.next).toEqual([
        { reviewsShown: 0, newShown: 0, batches: 1, after: undefined },
      ]);
      expect(t.shownId()).toBe("a");
    }
  });

  test("whose Card can't be re-read says Banki can't be reached, and Try again resumes it", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.fail.card = true;

    await t.reload();
    expect(t.state().phase).toBe("unreachable");
    // The stored Card stays stored meanwhile.
    expect(t.stored()?.shown?.cardId).toBe("b");

    t.fail.card = false;
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("b");
    expect(t.state().rated).toBe(1);
  });

  test("a tab that only hides or closes leaves a Session another tab acted in since as it is", async () => {
    const storage = memoryStorage();
    const idle = browsing([next("a"), next("b")], storage);
    await idle.session.start();
    // Opened later, it resumes the stored Session at a.
    const busy = browsing([next("x"), next("y")], storage);
    busy.wait(1000);
    await busy.session.start();
    expect(busy.shownId()).toBe("a");
    await rateIn(busy, "good");
    await rateIn(busy, "good");

    idle.session.persist();
    idle.session.stop();

    expect(busy.stored()?.shown?.cardId).toBe("y");
    expect(busy.stored()?.given).toHaveLength(2);
  });

  test("whose Queue had run out and whose first Card didn't load asks again for the Card after its last", async () => {
    const t = browsing([next("a")]);
    await t.session.start();
    await rateIn(t, "good");
    t.fail.next = true;

    await t.reload();
    expect(t.state().phase).toBe("unreachable");
    t.fail.next = false;
    t.session.retry();
    await flush();

    expect(t.calls.next.at(-1)).toMatchObject({ newShown: 1, after: "a" });
  });

  test("keeps a Rating that saved though the tab closed before the next Card showed, and never shows its Card to rate again", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    const serve = t.api.next;
    t.api.next = () => new Promise(() => {});
    await rateIn(t, "good");
    expect(t.calls.rate).toHaveLength(1);

    t.api.next = serve;
    await t.reload();

    expect(t.calls.card).toEqual([]);
    expect(t.calls.next.at(-1)).toMatchObject({ newShown: 1, after: "a" });
    expect(t.shownId()).toBe("b");
    expect(t.state().rated).toBe(1);
    await t.session.undo();
    expect(t.calls.undo).toEqual(["r1"]);
  });

  test("two tabs share it, and the one acted in last wins", async () => {
    const storage = memoryStorage();
    const one = browsing([next("a"), next("b"), next("c")], storage);
    await one.session.start();
    const two = browsing([next("a"), next("x")], storage);
    await two.session.start();
    await rateIn(two, "good");
    await rateIn(one, "good");

    expect(one.stored()?.shown?.cardId).toBe("b");
    expect(one.stored()?.given.map((g) => g.reviewId)).toEqual(["r1"]);
  });

  test("keeps a Rating answered after the screen went, and never shows its Card to rate again", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    const pending = deferred<{ reviewId: string } | "gone">();
    t.api.rate = (cardId, rating, durationMs) => {
      t.calls.rate.push({ cardId, rating, durationMs });
      return pending.promise;
    };
    t.session.reveal();
    t.session.rate("good");
    expect(t.session.leave()).toBe("away");
    t.session.stop();
    pending.resolve({ reviewId: "r1" });
    await flush();

    await t.reload();

    expect(t.calls.card).toEqual([]);
    expect(t.calls.next.at(-1)).toMatchObject({ newShown: 1, after: "a" });
    expect(t.shownId()).toBe("b");
    expect(t.state().rated).toBe(1);
    expect(t.calls.rate).toHaveLength(1);
  });

  test("keeps an Undo answered after the screen went: its Card resumes back from it, the Rating gone", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    t.wait(2000);
    await rateIn(t, "good");
    const pending = deferred<UndoAnswer>();
    t.api.undo = (reviewId) => {
      t.calls.undo.push(reviewId);
      return pending.promise;
    };
    void t.session.undo();
    t.session.stop();
    pending.resolve({ card: card("a"), intervals: intervals("a-undone") });
    await flush();

    await t.reload();

    expect(t.calls.card).toEqual(["a"]);
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ revealed: true, undone: true, rated: 0, undoable: false });
    t.wait(1000);
    t.session.rate("easy");
    await flush();
    expect(t.calls.rate.map((rated) => rated.durationMs)).toEqual([2000, 3000]);
  });

  test("a stale tab leaving it doesn't make it older than another tab's activity since", async () => {
    const storage = memoryStorage();
    const stale = browsing([next("a"), next("b")], storage);
    await stale.session.start();
    await rateIn(stale, "good");
    const other = browsing([next("c"), next("d")], storage);
    other.wait(25 * MINUTE);
    await other.session.start();
    await rateIn(other, "good");

    stale.wait(26 * MINUTE);
    expect(stale.session.leave()).toBe("summary");
    expect(stale.stored()?.activeAt).toBe(NOW + 25 * MINUTE);

    // Six minutes after the other tab's Rating, it still resumes there.
    other.wait(6 * MINUTE);
    await other.reload();
    expect(other.state()).toMatchObject({ phase: "card", rated: 2 });
  });

  test("a shown Card found deleted as it resumes says so, and its Ratings stand through an Undo's 404", async () => {
    const t = browsing([next("a", "new"), next("a", "learning"), next("b")]);
    await t.session.start();
    await rateIn(t, "again");
    expect(t.shownId()).toBe("a");
    t.missing.add("a");

    await t.reload();
    expect(t.messages).toContain(CARD_GONE);
    expect(t.shownId()).toBe("b");

    t.fail.undo = "gone";
    await t.session.undo();
    expect(t.state()).toMatchObject({ rated: 1, undoable: false, summary: { studied: 1 } });
  });

  test("closed while a Rating is on its way, never shows its Card to rate again", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    t.api.rate = (cardId, rating, durationMs) => {
      t.calls.rate.push({ cardId, rating, durationMs });
      return new Promise(() => {});
    };
    t.session.reveal();
    t.session.rate("good");
    t.session.persist();
    expect(t.stored()?.shown).toBeNull();

    await t.reload();

    expect(t.calls.card).toEqual([]);
    expect(t.calls.next.at(-1)).toMatchObject({ newShown: 1, after: "a" });
    expect(t.shownId()).toBe("b");
  });

  test("keeps storing its own Ratings after the clock steps back", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(-10 * MINUTE);
    await rateIn(t, "good");
    expect(t.stored()?.given).toHaveLength(2);

    await t.reload();
    expect(t.shownId()).toBe("c");
    expect(t.state().rated).toBe(2);
  });

  test("answers its own progress for the overview, stored or not: a New Card it shows is still to come", async () => {
    const t = browsing([next("a", "new"), next("b", "new")]);
    await t.session.start();
    expect(t.session.overviewProgress()).toEqual({ newShown: 0, batches: 1 });
    await rateIn(t, "good");
    expect(t.session.overviewProgress()).toEqual({ newShown: 1, batches: 1 });
  });
});

describe("the Session timeout", () => {
  test("just under it, opening Study resumes the Session", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(TIMEOUT - 1);

    await t.reload();

    expect(t.state()).toMatchObject({ phase: "card", rated: 1 });
    expect(t.shownId()).toBe("b");
  });

  test("past it, opening Study starts a fresh Session and clears the stored one, never showing its summary", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    await rateIn(t, "good");
    t.session.stop();
    t.wait(TIMEOUT);
    t.session = createStudySession({
      studyApi: t.api,
      notify: () => {},
      now: () => NOW + 2000 + TIMEOUT,
      store: sessionStore("d1", t.storage),
      timeoutMs: () => TIMEOUT,
    });
    const reading = t.session.start();
    // Cleared as it starts, before the first Card is in.
    expect(t.storage.map.size).toBe(0);
    await reading;

    expect(t.calls.card).toEqual([]);
    expect(t.calls.next.at(-1)).toEqual({
      reviewsShown: 0,
      newShown: 0,
      batches: 1,
      after: undefined,
    });
    expect(t.state()).toMatchObject({ phase: "card", rated: 0, summary: { studied: 0 } });
  });

  test("is the Settings' as it is now", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.timeout.ms = 5 * MINUTE;
    t.wait(5 * MINUTE);

    await t.reload();

    expect(t.state().rated).toBe(0);
  });

  test("only it ends a Session: leaving, finishing and reloading resume it", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.session.leave();
    await t.reload();
    expect(t.state()).toMatchObject({ phase: "card", rated: 1 });

    await rateIn(t, "good");
    expect(t.state().phase).toBe("done");
    await t.reload();
    expect(t.state()).toMatchObject({ phase: "done", rated: 2 });
  });

  test("counts from the Session's own last activity: a reveal moves it on, time alone doesn't", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(20 * MINUTE);
    t.session.reveal();
    t.wait(20 * MINUTE);
    t.session.checkTimeout();
    expect(t.state().phase).toBe("card");

    // Saving its time as the page hides is not activity.
    t.session.persist();
    t.wait(10 * MINUTE);
    t.session.checkTimeout();
    expect(t.state().phase).toBe("ended");
  });

  test("on a screen still open with a Rating standing, ends on the summary: no Undo, Keep studying or Learn more", async () => {
    const t = browsing([next("a", "review"), next("b")]);
    t.held.count = 3;
    await t.session.start();
    await rateIn(t, "good");
    t.wait(TIMEOUT - 1);
    t.session.checkTimeout();
    expect(t.state().phase).toBe("card");
    t.wait(1);
    t.session.checkTimeout();

    expect(t.state()).toMatchObject({
      phase: "ended",
      shown: undefined,
      undoable: false,
      rated: 1,
      summary: { studied: 1, recall: { kept: 1, of: 1 } },
    });
    await t.session.undo();
    t.session.resume();
    t.session.more();
    t.session.reveal();
    await flush();
    expect(t.calls.undo).toEqual([]);
    expect(t.calls.next).toHaveLength(2);
    expect(t.state().phase).toBe("ended");
    expect(t.session.leave()).toBe("away");
  });

  test("on a stale tab, doesn't end or clear a Session another tab acted in since", async () => {
    const storage = memoryStorage();
    const stale = browsing([next("a"), next("b")], storage);
    await stale.session.start();
    await rateIn(stale, "good");
    const other = browsing([next("c")], storage);
    other.wait(20 * MINUTE);
    await other.session.start();
    await rateIn(other, "good");

    stale.wait(TIMEOUT);
    stale.session.checkTimeout();

    expect(stale.state().phase).toBe("card");
    expect(stale.stored()?.given).toHaveLength(2);
  });

  test("on a stale tab, isn't kept open by a Session another tab started since: it ends, and leaves that one alone", async () => {
    const storage = memoryStorage();
    const stale = browsing([next("a"), next("b")], storage);
    await stale.session.start();
    await rateIn(stale, "good");
    const other = browsing([next("x"), next("y")], storage);
    other.wait(40 * MINUTE);
    await other.session.start();
    expect(other.shownId()).toBe("x");
    await rateIn(other, "good");

    stale.wait(41 * MINUTE);
    stale.session.reveal();

    expect(stale.state()).toMatchObject({ phase: "ended", rated: 1 });
    expect(other.stored()?.given.map((g) => g.cardId)).toEqual(["x"]);
    expect(other.stored()?.shown?.cardId).toBe("y");
  });

  test("on a stale tab, ends on the Ratings of the tab acted in last", async () => {
    const storage = memoryStorage();
    const stale = browsing([next("a"), next("b")], storage);
    await stale.session.start();
    await rateIn(stale, "good");
    const other = browsing([next("c"), next("d"), next("e")], storage);
    other.wait(1000);
    await other.session.start();
    expect(other.shownId()).toBe("b");
    await rateIn(other, "good");
    await rateIn(other, "good");
    other.session.stop();

    stale.wait(35 * MINUTE);
    stale.session.checkTimeout();

    expect(stale.state()).toMatchObject({ phase: "ended", rated: 3, summary: { studied: 3 } });
    expect(stale.stored()).toBeUndefined();
  });

  test("never ends a Session while it resumes, right after Continue", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(TIMEOUT - 10_000);
    const pending = deferred<Card | "gone">();
    t.api.card = () => pending.promise;

    const reloading = t.reload();
    t.wait(15_000);
    t.session.checkTimeout();
    expect(t.state().phase).toBe("loading");

    pending.resolve(card("b"));
    await reloading;
    expect(t.state()).toMatchObject({ phase: "card", rated: 1 });
    expect(t.stored()?.activeAt).toBe(NOW + TIMEOUT + 5000);
  });

  test("ended on a screen still open, it is cleared: a longer timeout set later doesn't bring it back", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(TIMEOUT);
    t.session.checkTimeout();
    expect(t.state().phase).toBe("ended");
    expect(t.stored()).toBeUndefined();

    t.timeout.ms = 2 * TIMEOUT;
    await t.reload();

    expect(t.calls.card).toEqual([]);
    expect(t.calls.next.at(-1)).toEqual({
      reviewsShown: 0,
      newShown: 0,
      batches: 1,
      after: undefined,
    });
    expect(t.state()).toMatchObject({ phase: "card", rated: 0 });
  });

  test("ends a Session saying the timeout that ended it", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.timeout.ms = 45 * MINUTE;
    t.wait(45 * MINUTE);
    t.session.checkTimeout();
    expect(t.state()).toMatchObject({ phase: "ended", endedAfterMs: 45 * MINUTE });
    t.timeout.ms = 5 * MINUTE;
    expect(t.state().endedAfterMs).toBe(45 * MINUTE);
  });

  test("on a screen still open, an action past it ends the Session instead of acting", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(TIMEOUT);

    t.session.reveal();

    expect(t.state()).toMatchObject({ phase: "ended", revealed: false });
  });

  test("leaving past it shows the ended summary", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(TIMEOUT);

    expect(t.session.leave()).toBe("summary");
    expect(t.state().phase).toBe("ended");
  });

  test("an answer on its way as it ends changes nothing", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    const pending = deferred<UndoAnswer>();
    t.api.undo = () => pending.promise;
    void t.session.undo();
    t.wait(TIMEOUT);
    t.session.checkTimeout();
    pending.resolve({ card: card("a"), intervals: intervals("a") });
    await flush();

    expect(t.state().phase).toBe("ended");
  });

  test("Start a new session clears the stored one and loads a fresh Session's first Card", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    await rateIn(t, "good");
    t.wait(TIMEOUT);
    t.session.checkTimeout();

    t.session.restart();
    expect(t.stored()).toBeUndefined();
    await flush();

    expect(t.calls.next.at(-1)).toEqual({
      reviewsShown: 0,
      newShown: 0,
      batches: 1,
      after: undefined,
    });
    expect(t.state()).toMatchObject({ phase: "card", rated: 0, undoable: false });
    expect(t.shownId()).toBe("c");
    expect(t.stored()?.given).toEqual([]);
  });

  test("on a screen still open with no Rating standing, quietly starts a fresh Session at the next Card", async () => {
    const t = browsing([next("a", "review"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.wait(TIMEOUT);

    t.session.checkTimeout();
    await flush();

    expect(t.calls.next.at(-1)).toEqual({
      reviewsShown: 0,
      newShown: 0,
      batches: 1,
      after: undefined,
    });
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ phase: "card", revealed: false });
    expect(t.messages).toEqual([]);
  });

  test("leaves Cards in their learning steps scheduled as they were: nothing is undone or rated", async () => {
    const t = browsing([next("a", "new"), next("b", "learning")]);
    await t.session.start();
    // a goes into its learning steps, b is in them already.
    await rateIn(t, "again");
    t.wait(TIMEOUT);
    t.session.checkTimeout();
    t.session.restart();
    await flush();

    expect(t.calls.rate).toEqual([{ cardId: "a", rating: "again", durationMs: 0 }]);
    expect(t.calls.undo).toEqual([]);
  });

  test("isn't checked while the editor is open: saving the edit is activity", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");
    expect(t.session.edit()).toBe(true);
    t.wait(TIMEOUT);
    t.session.checkTimeout();
    expect(t.state().phase).toBe("card");

    await t.session.saveEdit(card("b"), { progressReset: false });
    t.wait(TIMEOUT - 1);
    t.session.checkTimeout();
    expect(t.state().phase).toBe("card");
  });
});

describe("the time cap", () => {
  test("caps a Card's time at 2 minutes", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.wait(5 * MINUTE);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate.map((rated) => rated.durationMs)).toEqual([REVIEW_CAP_MS]);
  });

  test("caps a re-rate after an Undo: the undone time plus the time since", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    t.session.reveal();
    t.wait(90_000);
    t.session.rate("good");
    await flush();
    await t.session.undo();
    t.wait(60_000);
    t.session.rate("good");
    await flush();

    expect(t.calls.rate.map((rated) => rated.durationMs)).toEqual([90_000, REVIEW_CAP_MS]);
  });
});

describe("the session store", () => {
  test("clears every Deck's stored Session, and only those", () => {
    const storage = memoryStorage({
      "banki.session.d1": "{}",
      "banki.session.d2": "{}",
      "banki.deckSort": "name",
    });

    clearStoredSessions(storage);

    expect([...storage.map.keys()]).toEqual(["banki.deckSort"]);
  });

  test("reads a Deck's Session as open until the timeout since its last activity, from the Settings' minutes", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    await rateIn(t, "good");

    const at = (ms: number) => openProgress("d1", 30, { now: NOW + ms, storage: t.storage });
    // b, the New Card it shows, is still to come.
    expect(at(TIMEOUT - 1)).toEqual({ newShown: 1, batches: 1 });
    expect(at(TIMEOUT)).toBeUndefined();
    expect(openProgress("d1", undefined, { now: NOW, storage: t.storage })).toBeDefined();
    expect(openProgress("d2", 30, { now: NOW, storage: t.storage })).toBeUndefined();
    // At its end, every New Card it showed is used.
    await rateIn(t, "good");
    expect(openProgress("d1", 30, { now: NOW, storage: t.storage })).toEqual({
      newShown: 2,
      batches: 1,
    });
    expect(openProgress("d1", 30, { now: NOW, storage: undefined })).toBeUndefined();
  });
});

/** Storage the browser blocks: every read and write throws. */
const blockedStorage = (): ReturnType<typeof memoryStorage> => ({
  map: new Map<string, string>(),
  get length(): number {
    throw new Error("SecurityError");
  },
  key: () => {
    throw new Error("SecurityError");
  },
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
});

/** Opens a Session on a Deck in write-and-grade. */
async function writing(queue: NextCard[], storage?: ReturnType<typeof memoryStorage>) {
  const t = browsing(queue, storage, "write");
  await t.session.start();
  return t;
}

describe("the Answer mode", () => {
  test("a Session starts in its Deck's", async () => {
    const own = browsing([next("a")]);
    await own.session.start();
    expect(own.state().mode).toBe("self-rate");

    const t = await writing([next("a")]);
    expect(t.state()).toMatchObject({ mode: "write", draft: "", checkable: false });
  });

  test("a switch holds for the shown Card and every Card after it, until switched again", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();

    t.session.setMode("write");
    expect(t.state()).toMatchObject({ mode: "write", revealed: false });
    t.session.setDraft("x");
    t.session.check();
    t.session.rate("good");
    await flush();

    expect(t.shownId()).toBe("b");
    expect(t.state().mode).toBe("write");
    t.session.setMode("self-rate");
    await rateIn(t, "good");
    expect(t.shownId()).toBe("c");
    expect(t.state().mode).toBe("self-rate");
  });

  test("switches only until the Card is revealed, by Show answer, Check or I don't know", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    t.session.reveal();
    t.session.setMode("write");
    expect(t.state()).toMatchObject({ mode: "self-rate", switchable: false });
    t.session.rate("good");
    await flush();

    // The next Card takes it.
    t.session.setMode("write");
    expect(t.state()).toMatchObject({ mode: "write", switchable: true });
    t.session.setDraft("answer");
    t.session.check();
    t.session.setMode("self-rate");
    expect(t.state()).toMatchObject({ mode: "write", switchable: false });
    t.session.rate("good");
    await flush();

    t.session.dontKnow();
    t.session.setMode("self-rate");
    expect(t.state().mode).toBe("write");
  });

  test("switching keeps the draft", async () => {
    const t = await writing([next("a")]);
    t.session.setDraft("half an answer");

    t.session.setMode("self-rate");
    expect(t.state()).toMatchObject({ mode: "self-rate", draft: "half an answer" });
    t.session.setMode("write");
    expect(t.state()).toMatchObject({ mode: "write", draft: "half an answer", checkable: true });
  });

  test("a new Session starts in the Deck's again; a resumed one keeps its own", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    t.session.setMode("write");
    await t.reload();
    expect(t.state().mode).toBe("write");

    t.wait(TIMEOUT);
    await t.reload();
    expect(t.state().mode).toBe("self-rate");
  });

  test("a Session the timeout ends on a screen still open starts the next one in the Deck's", async () => {
    const t = browsing([next("a"), next("b"), next("c")]);
    await t.session.start();
    t.session.setMode("write");
    t.session.setDraft("x");
    t.session.check();
    t.session.rate("good");
    await flush();
    t.wait(TIMEOUT);
    t.session.checkTimeout();
    expect(t.state()).toMatchObject({ phase: "ended", draft: "" });

    t.session.restart();
    await flush();
    expect(t.state()).toMatchObject({ phase: "card", mode: "self-rate", draft: "" });
  });
});

describe("write-and-grade", () => {
  test("reveals by Check, not by Show answer: Space, Enter and a tap reveal nothing", async () => {
    const t = await writing([next("a")]);

    t.session.reveal();
    expect(t.state().revealed).toBe(false);
  });

  test("Check waits for a Written answer that isn't blank, then reveals it beside the Back", async () => {
    const t = await writing([next("a"), next("b")]);
    for (const blank of ["", "   ", "\n\t "]) {
      t.session.setDraft(blank);
      expect(t.state().checkable).toBe(false);
      t.session.check();
      expect(t.state().revealed).toBe(false);
    }

    t.session.setDraft("  el desayuno $x$ ");
    expect(t.state().checkable).toBe(true);
    t.session.check();
    expect(t.state()).toMatchObject({
      revealed: true,
      written: "  el desayuno $x$ ",
      ratable: true,
      checkable: false,
    });
  });

  test("a Rating after Check saves as any, and the next Card starts blank", async () => {
    const t = await writing([next("a"), next("b")]);
    t.wait(3000);
    t.session.setDraft("an answer");
    t.session.check();
    t.session.rate("hard");
    await flush();

    expect(t.calls.rate).toEqual([{ cardId: "a", rating: "hard", durationMs: 3000 }]);
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ draft: "", written: undefined, revealed: false });
  });

  test("Undo of a write-and-grade Rating brings the Card back revealed, without its Written answer", async () => {
    const t = await writing([next("a"), next("b")]);
    t.session.setDraft("an answer");
    t.session.check();
    t.session.rate("good");
    await flush();

    await t.session.undo();
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({
      revealed: true,
      undone: true,
      ratable: true,
      draft: "",
      written: undefined,
    });
  });
});

describe("I don't know", () => {
  test("saves Again at once, discards the draft, and shows the Back until Next", async () => {
    const t = await writing([next("a"), next("b")]);
    t.wait(4000);
    t.session.setDraft("no idea");
    t.session.dontKnow();
    expect(t.state()).toMatchObject({ revealed: true, dontKnow: true, saving: "again", draft: "" });
    await flush();

    expect(t.calls.rate).toEqual([{ cardId: "a", rating: "again", durationMs: 4000 }]);
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({
      revealed: true,
      dontKnow: true,
      saving: undefined,
      ratable: false,
      editable: false,
      rated: 1,
    });
    // Its Back shows: no Rating, no other Rating, no next Card till Next.
    t.session.rate("good");
    await flush();
    expect(t.calls.rate).toHaveLength(1);
    expect(t.calls.next).toHaveLength(1);

    t.session.next();
    expect(t.state().skipping).toBe(true);
    await flush();
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ dontKnow: false, revealed: false, mode: "write" });
    expect(t.calls.next.at(-1)).toMatchObject({ after: "a" });
  });

  test("is write-and-grade's only: in self-rate it does nothing", async () => {
    const t = browsing([next("a")]);
    await t.session.start();
    t.session.dontKnow();
    await flush();
    expect(t.calls.rate).toEqual([]);
    expect(t.state().revealed).toBe(false);
  });

  test("a Rating that didn't save says so, with Try again, and Next waits for it", async () => {
    const t = await writing([next("a"), next("b")]);
    t.fail.rate = true;
    t.session.dontKnow();
    await flush();
    expect(t.state()).toMatchObject({ failure: RATE_FAILED, dontKnow: true, rated: 0 });

    t.session.next();
    await flush();
    expect(t.shownId()).toBe("a");

    t.fail.rate = false;
    t.session.retry();
    await flush();
    expect(t.calls.rate.map((rated) => rated.rating)).toEqual(["again", "again"]);
    // Saved, it still waits for Next.
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ failure: undefined, dontKnow: true, rated: 1 });
    t.session.next();
    await flush();
    expect(t.shownId()).toBe("b");
  });

  test("a Card deleted elsewhere says so and goes on to the next one", async () => {
    const t = await writing([next("a"), next("b")]);
    t.fail.rate = "gone";
    t.session.dontKnow();
    await flush();

    expect(t.messages).toEqual([CARD_GONE]);
    expect(t.shownId()).toBe("b");
    expect(t.state()).toMatchObject({ dontKnow: false, rated: 0 });
  });

  test("a next Card that doesn't load says so, and Try again loads it", async () => {
    const t = await writing([next("a"), next("b")]);
    t.session.dontKnow();
    await flush();
    t.fail.next = true;
    t.session.next();
    await flush();
    expect(t.state()).toMatchObject({ failure: NEXT_FAILED, skipping: false });

    t.fail.next = false;
    t.session.retry();
    await flush();
    expect(t.shownId()).toBe("b");
  });

  test("Undo takes it back like any Rating: the Card comes back revealed, to rate", async () => {
    const t = await writing([next("a"), next("b")]);
    t.session.setDraft("no idea");
    t.session.dontKnow();
    await flush();

    await t.session.undo();
    expect(t.calls.undo).toEqual(["r1"]);
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({
      revealed: true,
      undone: true,
      dontKnow: false,
      ratable: true,
      rated: 0,
      draft: "",
      written: undefined,
    });
  });

  test("waits while an Undo or the editor is on its way", async () => {
    const t = await writing([next("a")]);
    expect(t.session.edit()).toBe(true);
    t.session.dontKnow();
    await flush();
    expect(t.calls.rate).toEqual([]);
  });
});

describe("the draft, kept with the Session", () => {
  test("is stored as it changes, with the mode, and a reload resumes the Card with it", async () => {
    const t = await writing([next("a"), next("b")]);
    t.session.setDraft("half of $x^2$");

    expect(t.stored()).toMatchObject({
      mode: "write",
      shown: { cardId: "a", draft: "half of $x^2$" },
    });
    await t.reload();

    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({
      mode: "write",
      revealed: false,
      draft: "half of $x^2$",
      checkable: true,
    });
  });

  test("a reload after Check resumes the Card revealed, with its Written answer", async () => {
    const t = await writing([next("a"), next("b")]);
    t.session.setDraft("an answer");
    t.session.check();

    await t.reload();
    expect(t.state()).toMatchObject({ revealed: true, written: "an answer", ratable: true });
  });

  test("in self-rate, a switched Session resumes in self-rate with the draft kept", async () => {
    const t = await writing([next("a")]);
    t.session.setDraft("kept");
    t.session.setMode("self-rate");

    await t.reload();
    expect(t.state()).toMatchObject({ mode: "self-rate", draft: "kept" });
  });

  test("goes when its Card is rated: after Check, or by I don't know", async () => {
    const t = await writing([next("a"), next("b"), next("c")]);
    t.session.setDraft("first");
    t.session.check();
    t.session.rate("good");
    await flush();
    expect(t.stored()?.shown).toMatchObject({ cardId: "b", draft: "" });

    t.session.setDraft("second");
    t.session.dontKnow();
    await flush();
    // Rated, its Card is stored as none: a reload goes on to the next.
    expect(t.stored()?.shown).toBeNull();
    expect(JSON.stringify(t.stored())).not.toContain("second");
    await t.reload();
    expect(t.shownId()).toBe("c");
    expect(t.state().draft).toBe("");
  });

  test("goes when the Session ends, and on sign-out", async () => {
    const t = await writing([next("a"), next("b")]);
    t.session.setDraft("draft");
    t.wait(TIMEOUT);
    await t.reload();
    expect(t.state().draft).toBe("");

    t.session.setDraft("another");
    // Signing out leaves the study screen first.
    t.session.stop();
    clearStoredSessions(t.storage);
    expect(t.stored()).toBeUndefined();
    await t.reload();
    expect(t.state().draft).toBe("");
  });

  test("a Session stored before Answer modes resumes in the Deck's, with no draft", async () => {
    const t = browsing([next("a"), next("b")]);
    await t.session.start();
    t.session.stop();
    const raw = JSON.parse(t.storage.getItem("banki.session.d1") ?? "{}");
    delete raw.mode;
    delete raw.shown.draft;
    delete raw.shown.checked;
    t.storage.setItem("banki.session.d1", JSON.stringify(raw));
    t.deck.mode = "write";

    await t.reload();
    expect(t.shownId()).toBe("a");
    expect(t.state()).toMatchObject({ mode: "write", draft: "", written: undefined });
  });

  test("in blocked storage, write-and-grade still studies, without a draft kept", async () => {
    const t = await writing([next("a"), next("b"), next("c")], blockedStorage());
    t.session.setDraft("draft");
    expect(t.state().draft).toBe("draft");
    t.session.check();
    t.session.rate("good");
    await flush();
    expect(t.shownId()).toBe("b");
    t.session.dontKnow();
    await flush();
    t.session.next();
    await flush();
    expect(t.shownId()).toBe("c");

    await t.reload();
    expect(t.state()).toMatchObject({ draft: "", mode: "write" });
  });
});

describe("keyAction in write-and-grade", () => {
  test("before the reveal, Space and Enter reveal nothing; E and Esc work as ever", () => {
    const writingCard = { showing: true, revealed: false, focus: undefined, writing: true };
    for (const key of [" ", "Enter"]) {
      expect(keyAction(press(key), writingCard)).toEqual({ type: "none" });
    }
    expect(keyAction(press("e"), writingCard)).toEqual({ type: "edit" });
    expect(keyAction(press("Escape"), writingCard)).toEqual({ type: "leave" });
  });

  test("after I don't know, Space and Enter press Next, and 1 to 4 rate nothing", () => {
    const waiting = { showing: true, revealed: true, focus: undefined, waiting: true };
    for (const key of [" ", "Enter"]) {
      expect(keyAction(press(key), waiting)).toEqual({ type: "next" });
      expect(keyAction(press(key), { ...waiting, focus: "control" as const })).toEqual({
        type: "none",
      });
    }
    for (const key of ["1", "2", "3", "4"]) {
      expect(keyAction(press(key), waiting)).toEqual({ type: "none" });
    }
    expect(keyAction({ ...press("z"), ctrlKey: true }, waiting)).toEqual({ type: "undo" });
  });

  test("after Check, 1 to 4 rate as ever", () => {
    expect(
      keyAction(press("3"), { showing: true, revealed: true, focus: undefined, writing: false }),
    ).toEqual({ type: "rate", rating: "good" });
  });
});
