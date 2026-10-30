import { describe, expect, test } from "bun:test";
import type { Rating } from "@banki/shared";
import { DefaultScheduler, type Grade } from "ts-fsrs";
import {
  type MemoryState,
  NEW_MEMORY_STATE,
  dueOnStudyDay,
  previewIntervals,
  rate,
  reschedule,
  restore,
  schedulerConfig,
} from "./fsrs";

const at = (iso: string) => new Date(iso);
const UTC4 = { timezone: "UTC", dayStartHour: 4 };
const WARSAW = { timezone: "Europe/Warsaw", dayStartHour: 4 };
const MINUTE = 60_000;

/** Rates a Card through `ratings`, each at `when` (its due moment if not given), at 90%. */
function history(
  cardId: string,
  ratings: readonly Rating[],
  start: Date,
  studyDay = UTC4,
): { memory: MemoryState; last: { reviewedAt: Date; rating: Rating; before: MemoryState } } {
  let memory = NEW_MEMORY_STATE;
  let now = start;
  let last: { reviewedAt: Date; rating: Rating; before: MemoryState } | undefined;
  for (const rating of ratings) {
    const before = memory;
    memory = rate(cardId, before, rating, { now, desiredRetention: 90, studyDay });
    last = { reviewedAt: now, rating, before };
    now = memory.dueAt ?? now;
  }
  if (last === undefined) throw new Error("No ratings");
  return { memory, last };
}

describe("the scheduler", () => {
  test("is ts-fsrs's FSRS-6 default scheduler, with fuzz on", async () => {
    const preset = await DefaultScheduler({ version: "FSRS-6", enableFuzz: true });
    const ours = schedulerConfig(90);

    expect(ours.weights).toEqual([...preset.config.weights]);
    expect([...preset.config.learningSteps]).toEqual(ours.learningSteps);
    expect([...preset.config.relearningSteps]).toEqual(ours.relearningSteps);
    expect(ours.maximumInterval).toBe(36_500);
    expect(ours.enableFuzz).toBe(true);
    expect(preset.config.maximumInterval).toBe(36_500);

    // And schedules alike: the same Ratings give the same intervals and memory state.
    let card = preset.newCard({ now: at("2026-05-01T10:00:00Z"), cardId: "c1" });
    let memory = NEW_MEMORY_STATE;
    let now = at("2026-05-01T10:00:00Z");
    const grades: Record<Rating, Grade> = { again: 1, hard: 2, good: 3, easy: 4 };
    for (const rating of ["good", "good", "good", "again", "good", "easy", "hard"] as const) {
      card = preset.review({ card, grade: grades[rating], now }).card;
      memory = rate("c1", memory, rating, { now, desiredRetention: 90, studyDay: UTC4 });
      expect(memory.scheduledDays).toBe(card.scheduledDays);
      expect(memory.stability).toBe(card.stability);
      expect(memory.difficulty).toBe(card.difficulty);
      now = new Date(Math.max(now.getTime(), card.dueAt.getTime()));
    }
  });
});

describe("rate", () => {
  test("a new Card is new until its first Review, then in its learning steps: 1 min, then 10 min", () => {
    const now = at("2026-05-12T10:00:00Z");
    const settings = { now, desiredRetention: 90, studyDay: UTC4 };

    const again = rate("c1", NEW_MEMORY_STATE, "again", settings);
    expect(again.state).toBe("learning");
    expect(again.dueAt).toEqual(new Date(now.getTime() + MINUTE));
    expect(again.reps).toBe(1);
    expect(again.lastReviewAt).toEqual(now);

    const good = rate("c1", NEW_MEMORY_STATE, "good", settings);
    expect(good.state).toBe("learning");
    expect(good.dueAt).toEqual(new Date(now.getTime() + 10 * MINUTE));
  });

  test("a lapsed Card relearns at 10 min, due at that exact moment", () => {
    const { memory } = history("c1", ["good", "good"], at("2026-05-12T10:00:00Z"));
    expect(memory.state).toBe("review");
    const now = memory.dueAt ?? at("2026-05-20T10:00:00Z");

    const lapsed = rate("c1", memory, "again", { now, desiredRetention: 90, studyDay: UTC4 });

    expect(lapsed.state).toBe("relearning");
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.dueAt).toEqual(new Date(now.getTime() + 10 * MINUTE));
  });

  test("past its learning steps, a Card is due from the Day start of the Study day N days after the Review", () => {
    // 23:30 in Warsaw on 12 May is in the Study day of the 12th (Day start 4:00).
    const learning = rate("c1", NEW_MEMORY_STATE, "good", {
      now: at("2026-05-12T21:20:00Z"),
      desiredRetention: 90,
      studyDay: WARSAW,
    });
    const reviewedAt = at("2026-05-12T21:30:00Z");

    const graduated = rate("c1", learning, "good", {
      now: reviewedAt,
      desiredRetention: 90,
      studyDay: WARSAW,
    });

    expect(graduated.state).toBe("review");
    expect(graduated.scheduledDays).toBeGreaterThanOrEqual(1);
    // 4:00 in Warsaw (UTC+2 in May) on the 12th plus N days.
    const n = graduated.scheduledDays;
    expect(graduated.dueAt).toEqual(new Date(Date.UTC(2026, 4, 12 + n, 2, 0)));
  });

  test("a Review before the Day start counts toward the Study day before", () => {
    // 1:00 on the 13th is still the 12th's Study day: one day out is the 13th, at 4:00.
    expect(dueOnStudyDay(at("2026-05-13T01:00:00Z"), 1, UTC4)).toEqual(at("2026-05-13T04:00:00Z"));
    expect(dueOnStudyDay(at("2026-05-13T05:00:00Z"), 1, UTC4)).toEqual(at("2026-05-14T04:00:00Z"));
    expect(dueOnStudyDay(at("2026-05-13T05:00:00Z"), 3, UTC4)).toEqual(at("2026-05-16T04:00:00Z"));
  });

  test("the same Card from the same state gets the same fuzzed interval whenever it is rated", () => {
    const { memory } = history("c1", ["good", "good", "good", "good"], at("2026-05-01T10:00:00Z"));
    const due = memory.dueAt ?? at("2026-06-01T10:00:00Z");
    const settings = { desiredRetention: 90, studyDay: UTC4 };

    const first = rate("c1", memory, "good", { ...settings, now: due });
    const later = rate("c1", memory, "good", { ...settings, now: new Date(due.getTime() + 7_000) });

    expect(later.scheduledDays).toBe(first.scheduledDays);
    expect(later.stability).toBe(first.stability);
  });

  test("the fuzz is on: Cards in the same state get spread-out intervals", () => {
    const start = at("2026-05-01T10:00:00Z");
    const intervals = new Set(
      Array.from({ length: 20 }, (_, i) => {
        const { memory } = history("x", ["good", "good", "good", "good"], start);
        const now = memory.dueAt ?? start;
        return rate(`card-${i}`, memory, "good", { now, desiredRetention: 90, studyDay: UTC4 })
          .scheduledDays;
      }),
    );

    expect(intervals.size).toBeGreaterThan(1);
  });

  test("a lower Desired retention schedules further out", () => {
    const { memory } = history("c1", ["good", "good", "good"], at("2026-05-01T10:00:00Z"));
    const now = memory.dueAt ?? at("2026-06-01T10:00:00Z");
    const at70 = rate("c1", memory, "good", { now, desiredRetention: 70, studyDay: UTC4 });
    const at97 = rate("c1", memory, "good", { now, desiredRetention: 97, studyDay: UTC4 });

    expect(at70.scheduledDays).toBeGreaterThan(at97.scheduledDays);
  });

  test("refuses a Desired retention outside 70–97", () => {
    const settings = { now: at("2026-05-01T10:00:00Z"), studyDay: UTC4 };
    expect(() =>
      rate("c1", NEW_MEMORY_STATE, "good", { ...settings, desiredRetention: 69 }),
    ).toThrow();
    expect(() =>
      rate("c1", NEW_MEMORY_STATE, "good", { ...settings, desiredRetention: 98 }),
    ).toThrow();
  });
});

describe("reschedule", () => {
  const start = at("2026-05-01T10:00:00Z");

  test("moves a Card past its learning steps to its last Review plus the interval at the new retention", () => {
    const { memory, last } = history("c1", ["good", "good", "good"], start);
    const now = last.reviewedAt;

    const at80 = reschedule("c1", memory, last, { now, desiredRetention: 80, studyDay: UTC4 });
    const direct = rate("c1", last.before, last.rating, {
      now: last.reviewedAt,
      desiredRetention: 80,
      studyDay: UTC4,
    });

    expect(at80.scheduledDays).toBe(direct.scheduledDays);
    expect(at80.scheduledDays).toBeGreaterThan(memory.scheduledDays);
    expect(at80.dueAt).toEqual(dueOnStudyDay(last.reviewedAt, at80.scheduledDays, UTC4));
    // The memory state itself doesn't change.
    expect(at80.stability).toBe(memory.stability);
    expect(at80.reps).toBe(memory.reps);
    expect(at80.lastReviewAt).toEqual(memory.lastReviewAt);
  });

  test("going back to the retention it had puts the due date back", () => {
    const { memory, last } = history("c1", ["good", "good", "good"], start);
    const settings = { now: last.reviewedAt, studyDay: UTC4 };

    const moved = reschedule("c1", memory, last, { ...settings, desiredRetention: 75 });
    const back = reschedule("c1", moved, last, { ...settings, desiredRetention: 90 });

    expect(back.dueAt).toEqual(memory.dueAt);
    expect(back.scheduledDays).toBe(memory.scheduledDays);
  });

  test("a due date already past is due now", () => {
    const { memory, last } = history("c1", ["good", "good", "good"], start);
    const now = at("2027-01-01T12:00:00Z");

    const at97 = reschedule("c1", memory, last, { now, desiredRetention: 97, studyDay: UTC4 });

    expect(at97.dueAt).toEqual(now);
  });

  test("leaves a Card in its learning steps as it is", () => {
    const { memory, last } = history("c1", ["good"], start);
    expect(memory.state).toBe("learning");

    expect(
      reschedule("c1", memory, last, { now: start, desiredRetention: 70, studyDay: UTC4 }),
    ).toBe(memory);
  });
});

describe("previewIntervals", () => {
  const start = at("2026-05-01T10:00:00Z");

  test("previews each Rating as exactly what it gives", () => {
    const { memory } = history("c1", ["good", "good", "good"], start);
    const settings = { now: memory.dueAt ?? start, desiredRetention: 90, studyDay: UTC4 };

    const previews = previewIntervals("c1", memory, settings);

    for (const rating of ["again", "hard", "good", "easy"] as const) {
      const after = rate("c1", memory, rating, settings);
      expect(previews[rating]).toEqual({
        state: after.state,
        scheduledDays: after.scheduledDays,
        due: after.dueAt?.toISOString() ?? "",
      });
    }
    expect(previews.again.state).toBe("relearning");
    expect(previews.good.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  test("previews a new Card's learning steps as moments minutes out", () => {
    const previews = previewIntervals("c1", NEW_MEMORY_STATE, {
      now: start,
      desiredRetention: 90,
      studyDay: UTC4,
    });

    expect(previews.again).toEqual({
      state: "learning",
      scheduledDays: 0,
      due: new Date(start.getTime() + MINUTE).toISOString(),
    });
    expect(previews.good.due).toBe(new Date(start.getTime() + 10 * MINUTE).toISOString());
    expect(previews.easy.state).toBe("review");
  });
});

describe("restore", () => {
  const start = at("2026-05-01T10:00:00Z");

  /** A Card rated Good three times, then once more: the state before that last Review, and the one before it. */
  function undoable() {
    const { memory: before, last: previous } = history("c1", ["good", "good", "good"], start);
    return { before, previous, now: before.dueAt ?? start };
  }

  test("puts back the state the undone Review kept, with no change of retention", () => {
    const { before, previous, now } = undoable();

    expect(restore("c1", before, previous, { now, desiredRetention: 90, studyDay: UTC4 })).toEqual(
      before,
    );
  });

  test("reschedules it at the current retention when that changed since", () => {
    const { before, previous, now } = undoable();
    const settings = { now, desiredRetention: 80, studyDay: UTC4 };

    const restored = restore("c1", before, previous, settings);

    expect(restored).toEqual(reschedule("c1", before, previous, settings));
    expect(restored.scheduledDays).toBeGreaterThan(before.scheduledDays);
  });

  test("a state that was already rescheduled for the current retention stays as it is", () => {
    const { before, previous, now } = undoable();
    const at80 = { now: previous.reviewedAt, desiredRetention: 80, studyDay: UTC4 };
    const moved = reschedule("c1", before, previous, at80);

    expect(restore("c1", moved, previous, { ...at80, now })).toEqual(moved);
  });

  test("a new Card, or one in its learning steps, comes back as it was", () => {
    const settings = { now: start, desiredRetention: 80, studyDay: UTC4 };
    expect(restore("c1", NEW_MEMORY_STATE, undefined, settings)).toEqual(NEW_MEMORY_STATE);
    const { memory, last } = history("c1", ["good"], start);
    expect(restore("c1", memory, last, settings)).toEqual(memory);
  });
});
