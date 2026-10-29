import type { IntervalPreviews, QueueKind, Rating } from "@banki/shared";
import { describe, expect, test } from "vitest";
import type { Card } from "./cards";
import {
  CARD_GONE,
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
  formatInterval,
  keyAction,
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
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
});

const next = (id: string, kind: QueueKind = "new"): NextCard => ({
  card: card(id),
  kind,
  intervals: intervals(id),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A fake study API over a Queue of Cards, answering each call at once unless
 * the test makes it fail, and recording every call.
 */
function fakeApi(queue: NextCard[]) {
  const calls = {
    next: [] as Progress[],
    rate: [] as { cardId: string; rating: Rating; durationMs: number }[],
    undo: [] as string[],
  };
  let reviews = 0;
  const fail = { next: false, rate: false as boolean | "gone", undo: false as boolean | "gone" };
  const api: StudyApi = {
    next: async (progress) => {
      calls.next.push(progress);
      if (fail.next) throw new Error("offline");
      return queue.shift() ?? null;
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
      if (fail.undo === "gone") return "gone";
      if (fail.undo) throw new Error("offline");
      const cardId = calls.rate.find((_, i) => `r${i + 1}` === reviewId)?.cardId ?? "?";
      return { card: card(cardId), intervals: intervals(`${cardId}-undone`) };
    },
  };
  return { api, calls, fail };
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
      { reviewsShown: 0, newShown: 0, after: undefined },
      { reviewsShown: 1, newShown: 0, after: "a" },
      { reviewsShown: 1, newShown: 1, after: "b" },
      // a came back from its learning step, and c was a learning Card from before: neither counts.
      { reviewsShown: 1, newShown: 1, after: "a" },
      { reviewsShown: 1, newShown: 1, after: "c" },
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
    expect(t.calls.next.at(-1)).toEqual({ reviewsShown: 1, newShown: 1, after: "a" });
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
      expect(keyAction(press(key), { revealed: false })).toEqual({ type: "reveal" });
      expect(keyAction(press(key), { revealed: true })).toEqual({ type: "none" });
    }
  });

  test("1 to 4 rate Again, Hard, Good and Easy, only once revealed", () => {
    const ratings = ["again", "hard", "good", "easy"];
    ["1", "2", "3", "4"].forEach((key, i) => {
      expect(keyAction(press(key), { revealed: true })).toEqual({
        type: "rate",
        rating: ratings[i],
      });
      expect(keyAction(press(key), { revealed: false })).toEqual({ type: "none" });
    });
    expect(keyAction(press("5"), { revealed: true })).toEqual({ type: "none" });
    expect(keyAction(press("1", { ctrlKey: true }), { revealed: true })).toEqual({ type: "none" });
  });

  test("Ctrl+Z and ⌘+Z undo, revealed or not", () => {
    for (const revealed of [false, true]) {
      expect(keyAction(press("z", { ctrlKey: true }), { revealed })).toEqual({ type: "undo" });
      expect(keyAction(press("z", { metaKey: true }), { revealed })).toEqual({ type: "undo" });
      expect(keyAction(press("Z", { metaKey: true }), { revealed })).toEqual({ type: "undo" });
    }
    expect(keyAction(press("z"), { revealed: true })).toEqual({ type: "none" });
  });

  test("Esc leaves", () => {
    expect(keyAction(press("Escape"), { revealed: false })).toEqual({ type: "leave" });
    expect(keyAction(press("Escape"), { revealed: true })).toEqual({ type: "leave" });
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
