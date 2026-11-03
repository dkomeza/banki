import { describe, expect, test } from "bun:test";
import { DefaultScheduler } from "ts-fsrs";
import { predictedRecall } from "./fsrs";
import { type QueueCard, type QueueLimits, type QueueProgress, nextInQueue } from "./queue";

const NOW = new Date("2026-05-20T12:00:00Z");
/** The next Day start after NOW. */
const TOMORROW = new Date("2026-05-21T04:00:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const from = (ms: number) => new Date(NOW.getTime() + ms);
const START: QueueProgress = { reviewsShown: 0, newShown: 0, batches: 1 };
/** Limits too loose to hold back any New card in the tests that aren't about them. */
const LOOSE: QueueLimits = { newCardBatch: 100, learningLimit: 50 };

/** A new Card written `minutesAgo` minutes before now. */
const fresh = (id: string, minutesAgo = 0): QueueCard => ({
  id,
  state: "new",
  dueAt: null,
  stability: 0,
  lastReviewAt: null,
  createdAt: ago(minutesAgo * MINUTE + DAY),
});

/** A Card past its learning steps, last reviewed `daysAgo` days before now, due at `dueAt`. */
const review = (
  id: string,
  {
    stability = 10,
    daysAgo = 10,
    dueAt = ago(0),
  }: { stability?: number; daysAgo?: number; dueAt?: Date } = {},
): QueueCard => ({
  id,
  state: "review",
  dueAt,
  stability,
  lastReviewAt: ago(daysAgo * DAY),
  createdAt: ago(100 * DAY),
});

/** A Card in its learning steps, due at `dueAt`. */
const learning = (
  id: string,
  dueAt: Date,
  state: "learning" | "relearning" = "learning",
): QueueCard => ({
  id,
  state,
  dueAt,
  stability: 1,
  lastReviewAt: ago(MINUTE),
  createdAt: ago(DAY),
});

/** `count` Cards in their learning steps, none due yet, the first due soonest. */
const pile = (count: number, state: "learning" | "relearning" = "learning") =>
  Array.from({ length: count }, (_, i) =>
    learning(`${state}${i}`, from((i + 1) * 10 * MINUTE), state),
  );

/** Three new Cards and a review: with no pause, the first new Card is at position 0. */
const rest = () => [fresh("n1", 3), fresh("n2", 2), fresh("n3", 1), review("r")];

/** `count` new Cards, `n000` written first. */
const news = (count: number) =>
  Array.from({ length: count }, (_, i) => fresh(`n${String(i).padStart(3, "0")}`, count - i));

/** The Card the Queue shows next, or null, under `limits`. */
const pick = (cards: readonly QueueCard[], progress: QueueProgress, limits = LOOSE) =>
  nextInQueue(cards, progress, limits, NOW, TOMORROW).next;

/**
 * Walks the Queue as a Session would, without Ratings: each Card shown leaves
 * it, and counts by its kind. Answers the IDs in order.
 */
function walk(cards: QueueCard[], limits = LOOSE): string[] {
  const left = [...cards];
  const progress = { ...START };
  const shown: string[] = [];
  for (;;) {
    const next = pick(left, progress, limits);
    if (next === null) return shown;
    shown.push(next.id);
    left.splice(
      left.findIndex((c) => c.id === next.id),
      1,
    );
    if (next.kind === "review") progress.reviewsShown += 1;
    if (next.kind === "new") progress.newShown += 1;
  }
}

describe("predictedRecall", () => {
  test("is ts-fsrs's own retrievability for a memory state, at the fractional days since the last Review", async () => {
    const scheduler = await DefaultScheduler({ version: "FSRS-6" });
    const memory = { stability: 7.3, difficulty: 5 };

    for (const days of [0.25, 1, 3.5, 7.3, 40]) {
      const lastReviewAt = ago(days * DAY);
      expect(predictedRecall({ stability: memory.stability, lastReviewAt }, NOW)).toBe(
        scheduler.model.forgettingCurve(memory, days),
      );
    }
    // FSRS's own definition: at elapsed days equal to the stability, recall is 90%.
    expect(predictedRecall({ stability: 7.3, lastReviewAt: ago(7.3 * DAY) }, NOW)).toBeCloseTo(
      0.9,
      6,
    );
  });

  test("is 1 just after a Review, and falls as time passes", () => {
    expect(predictedRecall({ stability: 5, lastReviewAt: NOW }, NOW)).toBe(1);
    expect(predictedRecall({ stability: 5, lastReviewAt: null }, NOW)).toBe(1);
    expect(predictedRecall({ stability: 5, lastReviewAt: ago(DAY) }, NOW)).toBeGreaterThan(
      predictedRecall({ stability: 5, lastReviewAt: ago(2 * DAY) }, NOW),
    );
  });
});

describe("nextInQueue", () => {
  test("answers null for an empty Deck", () => {
    expect(pick([], START)).toBeNull();
  });

  test("answers null when no Card is due and none is in learning", () => {
    expect(pick([review("r1", { dueAt: from(DAY) })], START)).toBeNull();
  });

  describe("due reviews", () => {
    test("go lowest Predicted recall first", () => {
      const cards = [
        review("steady", { stability: 30, daysAgo: 10 }),
        review("shaky", { stability: 2, daysAgo: 10 }),
        review("middling", { stability: 10, daysAgo: 10 }),
      ];

      expect(walk(cards)).toEqual(["shaky", "middling", "steady"]);
    });

    test("count the fractional days since the last Review", () => {
      const cards = [
        review("a", { stability: 5, daysAgo: 6.2 }),
        review("b", { stability: 5, daysAgo: 6.4 }),
      ];

      expect(walk(cards)).toEqual(["b", "a"]);
    });

    test("tie on Predicted recall go the earlier due first, then by ID", () => {
      const cards = [
        review("c", { dueAt: ago(DAY) }),
        review("b", { dueAt: ago(2 * DAY) }),
        review("a", { dueAt: ago(DAY) }),
      ];

      expect(walk(cards)).toEqual(["b", "a", "c"]);
    });

    test("leave out reviews due from the next Day start", () => {
      const cards = [review("tomorrow", { stability: 1, dueAt: TOMORROW }), review("now")];

      expect(walk(cards)).toEqual(["now"]);
    });

    test("count a review due later today, before the next Day start (ADR-0024)", () => {
      // Where a change of Day start or Timezone since its Review leaves it.
      const later = new Date(TOMORROW.getTime() - MINUTE);

      expect(pick([review("r", { dueAt: later })], START)).toEqual({ id: "r", kind: "review" });
    });

    test("count a review due at this very moment", () => {
      expect(pick([review("r", { dueAt: NOW })], START)).toEqual({
        id: "r",
        kind: "review",
      });
    });
  });

  describe("new Cards", () => {
    test("go in creation order, then by ID", () => {
      const cards = [fresh("c", 10), fresh("b", 20), fresh("a", 10), fresh("d", 30)];

      expect(walk(cards)).toEqual(["d", "b", "a", "c"]);
    });

    test("sit at evenly spaced, centered positions among the reviews", () => {
      // 2 new of 6: positions ⌊0.5·6/2⌋ = 1 and ⌊1.5·6/2⌋ = 4.
      const cards = [
        fresh("n1", 2),
        fresh("n2", 1),
        review("r1", { stability: 1 }),
        review("r2", { stability: 2 }),
        review("r3", { stability: 3 }),
        review("r4", { stability: 4 }),
      ];

      expect(walk(cards)).toEqual(["r1", "n1", "r2", "r3", "n2", "r4"]);
    });

    test("one new Card among reviews sits in the middle", () => {
      // 1 new of 5: position ⌊0.5·5/1⌋ = 2.
      const cards = [fresh("n"), ...[1, 2, 3, 4].map((s) => review(`r${s}`, { stability: s }))];

      expect(walk(cards)).toEqual(["r1", "r2", "n", "r3", "r4"]);
    });

    test("more new Cards than reviews interleave, centered", () => {
      // 3 new of 4: positions 0, 2 and 3.
      const cards = [fresh("n1", 3), fresh("n2", 2), fresh("n3", 1), review("r")];

      expect(walk(cards)).toEqual(["n1", "r", "n2", "n3"]);
    });

    test("follow once the reviews run out", () => {
      // 2 new of 4 at positions 1 and 3, but the reviews run out after position 1.
      const progress = { ...START, reviewsShown: 1, newShown: 1 };
      const cards = [fresh("n2"), fresh("n3")];

      expect(pick(cards, progress)).toEqual({ id: "n2", kind: "new" });
    });

    test("go one after another with no reviews", () => {
      expect(walk([fresh("b", 1), fresh("a", 2)])).toEqual(["a", "b"]);
    });

    test("take their positions from what the Session has shown", () => {
      // 4 reviews and 2 new Cards in all; 2 reviews and 1 new shown, so the next
      // position is 3, and the second new Card's is ⌊1.5·6/2⌋ = 4.
      const n2 = fresh("n2");
      const r4 = review("r4", { stability: 2 });

      expect(
        pick([n2, review("r3", { stability: 1 }), r4], { ...START, reviewsShown: 2, newShown: 1 }),
      ).toEqual({
        id: "r3",
        kind: "review",
      });
      expect(pick([n2, r4], { ...START, reviewsShown: 3, newShown: 1 })).toEqual({
        id: "n2",
        kind: "new",
      });
    });
  });

  describe("learning Cards", () => {
    test("whose step is over go next, ahead of reviews and new Cards", () => {
      const cards = [fresh("n"), review("r", { stability: 1 }), learning("l", ago(MINUTE))];

      expect(pick(cards, START)).toEqual({ id: "l", kind: "learning" });
    });

    test("relearning Cards count as learning", () => {
      const cards = [review("r"), learning("l", ago(MINUTE), "relearning")];

      expect(pick(cards, START)).toEqual({ id: "l", kind: "learning" });
    });

    test("go the one due longest ago first", () => {
      const cards = [learning("recent", ago(MINUTE)), learning("long", ago(5 * MINUTE))];

      expect(pick(cards, START)?.id).toBe("long");
    });

    test("are held back while their step isn't over", () => {
      const cards = [learning("l", from(MINUTE)), review("r")];

      expect(pick(cards, START)).toEqual({ id: "r", kind: "review" });
    });

    test("never come straight after themselves while another Card is left", () => {
      const cards = [learning("l", ago(MINUTE)), review("r")];

      expect(pick(cards, { ...START, after: "l" })).toEqual({
        id: "r",
        kind: "review",
      });
    });

    test("give way to another due learning Card after themselves", () => {
      const cards = [learning("l1", ago(5 * MINUTE)), learning("l2", ago(MINUTE))];

      expect(pick(cards, { ...START, after: "l1" })?.id).toBe("l2");
    });

    test("give way to a learning Card shown early, rather than come straight after themselves", () => {
      const cards = [learning("l1", ago(MINUTE)), learning("l2", from(10 * MINUTE))];

      expect(pick(cards, { ...START, after: "l1" })).toEqual({
        id: "l2",
        kind: "learning",
      });
    });

    test("come straight after themselves when no other Card is left", () => {
      const cards = [learning("l", ago(MINUTE))];

      expect(pick(cards, { ...START, after: "l" })).toEqual({
        id: "l",
        kind: "learning",
      });
    });

    test("an `after` that is no Card in the Deck changes nothing", () => {
      const cards = [learning("l", ago(MINUTE)), review("r")];

      expect(pick(cards, { ...START, after: "gone" })?.id).toBe("l");
    });
  });

  describe("early show", () => {
    test("shows the learning Card with the earliest due time when nothing else is left", () => {
      const cards = [learning("later", from(10 * MINUTE)), learning("sooner", from(MINUTE))];

      expect(pick(cards, START)).toEqual({ id: "sooner", kind: "learning" });
    });

    test("waits while a review or a new Card is left", () => {
      expect(pick([learning("l", from(MINUTE)), fresh("n")], START)?.id).toBe("n");
      expect(pick([learning("l", from(MINUTE)), review("r")], START)?.id).toBe("r");
    });

    test("ignores reviews not yet due", () => {
      const cards = [learning("l", from(MINUTE)), review("r", { dueAt: from(DAY) })];

      expect(pick(cards, START)).toEqual({ id: "l", kind: "learning" });
    });

    test("shows the Card just shown when it is the only one left", () => {
      const cards = [learning("l", from(10 * MINUTE))];

      expect(pick(cards, { ...START, after: "l" })?.id).toBe("l");
    });
  });

  describe("the Learning limit", () => {
    const limits: QueueLimits = { newCardBatch: 100, learningLimit: 5 };

    test("introduces New cards while fewer of the Deck's Cards than it are in learning", () => {
      expect(pick([...pile(4), ...rest()], START, limits)).toEqual({ id: "n1", kind: "new" });
    });

    test("pauses New cards once that many are in learning: a due review comes instead", () => {
      expect(pick([...pile(5), ...rest()], START, limits)).toEqual({ id: "r", kind: "review" });
      expect(pick([...pile(6), ...rest()], START, limits)).toEqual({ id: "r", kind: "review" });
    });

    test("counts relearning Cards, and learning ones from earlier Sessions not yet due", () => {
      const cards = [...pile(3), ...pile(2, "relearning"), ...rest()];

      expect(pick(cards, START, limits)?.id).toBe("r");
    });

    test("still lets a learning Card whose step is over go first", () => {
      const cards = [...pile(4), learning("due", ago(MINUTE)), ...rest()];

      expect(pick(cards, START, limits)).toEqual({ id: "due", kind: "learning" });
    });

    test("with nothing else left, shows the learning Card due soonest early, never a New card", () => {
      const cards = [...pile(5), fresh("n")];

      expect(pick(cards, START, limits)).toEqual({ id: "learning0", kind: "learning" });
    });

    test("introduces New cards again once the count drops below it", () => {
      const cards = [...pile(5), fresh("n")];
      expect(pick(cards, START, limits)?.kind).toBe("learning");

      // One of them graduated.
      expect(pick(cards.slice(1), START, limits)).toEqual({ id: "n", kind: "new" });
    });

    test("holds after another batch", () => {
      const cards = [...pile(5), fresh("n")];
      const progress = { ...START, newShown: 5, batches: 2 };

      expect(pick(cards, progress, { newCardBatch: 5, learningLimit: 5 })?.kind).toBe("learning");
    });

    test("never empties the Queue: no New card is held when it answers none", () => {
      expect(nextInQueue([...pile(5), fresh("n")], START, limits, NOW, TOMORROW).newHeld).toBe(0);
    });
  });

  describe("the New-card batch", () => {
    const limits: QueueLimits = { newCardBatch: 5, learningLimit: 50 };

    test("introduces that many New cards, then no more", () => {
      expect(walk(news(8), limits)).toEqual(["n000", "n001", "n002", "n003", "n004"]);
    });

    test("once reached, only due reviews and learning Cards come, learning shown early", () => {
      const done = { ...START, newShown: 5 };
      const cards = [...news(3), review("r"), learning("l", from(MINUTE))];

      expect(pick(cards, done, limits)).toEqual({ id: "r", kind: "review" });
      expect(
        pick(
          cards.filter((c) => c.id !== "r"),
          done,
          limits,
        ),
      ).toEqual({
        id: "l",
        kind: "learning",
      });
    });

    test("once reached, answers no Card with the New cards it held", () => {
      const answer = nextInQueue(news(37), { ...START, newShown: 5 }, limits, NOW, TOMORROW);

      expect(answer).toEqual({ next: null, newHeld: 37 });
    });

    test("holds none back while it shows a Card, or when no New card is left", () => {
      expect(nextInQueue(news(8), START, limits, NOW, TOMORROW).newHeld).toBe(0);
      expect(
        nextInQueue([review("r")], { ...START, newShown: 5 }, limits, NOW, TOMORROW).newHeld,
      ).toBe(0);
      expect(nextInQueue([], { ...START, newShown: 5 }, limits, NOW, TOMORROW)).toEqual({
        next: null,
        newHeld: 0,
      });
    });

    test("another batch allows the next `batch` New cards", () => {
      const cards = news(12).slice(5);
      const second = { ...START, newShown: 5, batches: 2 };

      expect(pick(cards, second, limits)).toEqual({ id: "n005", kind: "new" });
      expect(
        nextInQueue(cards.slice(5), { ...second, newShown: 10 }, limits, NOW, TOMORROW),
      ).toEqual({
        next: null,
        newHeld: 2,
      });
    });

    test("counts what the Session has shown, even past a batch made smaller meanwhile", () => {
      const answer = nextInQueue(news(3), { ...START, newShown: 12 }, limits, NOW, TOMORROW);

      expect(answer).toEqual({ next: null, newHeld: 3 });
    });

    test("spaces its New cards among the reviews by what it allows, not by every New card", () => {
      // 100 due reviews and 500 New cards: the batch's 20 spread across the 100 reviews,
      // new Card `k` at ⌊(k+½)·120/20⌋ = 6k + 3.
      const reviews = Array.from({ length: 100 }, (_, i) =>
        review(`r${String(i).padStart(3, "0")}`),
      );
      const shown = walk([...news(500), ...reviews], { newCardBatch: 20, learningLimit: 50 });

      expect(shown).toHaveLength(120);
      const positions = shown.flatMap((id, i) => (id.startsWith("n") ? [i] : []));
      expect(positions).toEqual(Array.from({ length: 20 }, (_, k) => 6 * k + 3));
    });
  });
});
