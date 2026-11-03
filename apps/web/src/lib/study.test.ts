import type { IntervalPreviews, QueueKind, Rating } from "@banki/shared";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import type { Card, CardOutcome } from "./cards";
import {
  CARD_GONE,
  EDITOR_FAILED,
  INTERVALS_FAILED,
  MORE_FAILED,
  NEXT_FAILED,
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
  };
  let reviews = 0;
  const fail = {
    next: false,
    rate: false as boolean | "gone",
    undo: false as boolean | "gone" | "kept",
    intervals: false as boolean | "gone",
  };
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
      if (fail.undo === "gone" || fail.undo === "kept") return fail.undo;
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
  };
  return { api, calls, fail, held, queue };
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

  test("an Undo refused for good (a Progress reset since) keeps its Rating standing, and the next goes on to the one before", async () => {
    const t = setUp([next("a"), next("b"), next("c")]);
    await t.session.start();
    await revealAndRate(t, "good");
    await revealAndRate(t, "good");

    t.fail.undo = "kept";
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

    // Only the kept one is left: nothing to undo.
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
    t.session.edit();
    t.fail.intervals = true;
    await t.session.saveEdit(edited("a", "a"), { progressReset: true });

    expect(t.state()).toMatchObject({ editing: false, ratable: false, failure: INTERVALS_FAILED });
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

  test("an earlier press opens nothing once another came", async () => {
    const t = opening([next("a")]);
    await t.session.start();
    t.opener.open();
    const first = t.load;
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

/** The study API over HTTP, answered by `res`. */
const answering = (res: () => Response) =>
  studyApi("d1", createApiClient(vi.fn(async () => res())));

describe("studyApi", () => {
  test("an Undo answers the Card back with its previews, 404 as gone and 409 as kept", async () => {
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
    await expect(answering(() => Response.json({ ...back, schedule })).undo("r1")).resolves.toEqual(
      back,
    );
    await expect(answering(() => new Response(null, { status: 404 })).undo("r1")).resolves.toBe(
      "gone",
    );
    await expect(answering(() => new Response(null, { status: 409 })).undo("r1")).resolves.toBe(
      "kept",
    );
    await expect(answering(() => new Response(null, { status: 500 })).undo("r1")).rejects.toThrow();
  });

  test("a Card's previews answer as they are, 404 as gone", async () => {
    await expect(answering(() => Response.json(intervals("a"))).intervals("a")).resolves.toEqual(
      intervals("a"),
    );
    await expect(answering(() => new Response(null, { status: 404 })).intervals("a")).resolves.toBe(
      "gone",
    );
    await expect(
      answering(() => new Response(null, { status: 500 })).intervals("a"),
    ).rejects.toThrow();
  });
});
