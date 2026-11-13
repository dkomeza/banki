import {
  DAILY_MINUTES_DAYS_MAX,
  RATINGS,
  type Rating,
  type Statistics,
  type StatisticsRange,
  type StudyDay,
  addStudyDays,
  calendarStartOf,
  mondayOf,
  studyDayBounds,
  studyDayOf,
  studyDaysBetween,
} from "@banki/shared";
import { type SQL, and, asc, count, eq, gte, isNull, sql } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, deck, review } from "../db/schema";
import { isLiveDeck } from "./cards";
import { schedulingSettingsOf } from "./reviews";

export type StatisticsRepository = ReturnType<typeof createStatisticsRepository>;

type Agreement = { kept: number; higher: number; lower: number };

const rank = (rating: Rating) => RATINGS.indexOf(rating);

/**
 * Each Study day from `first` to `last`, with the instant it starts, sorted:
 * a Review belongs to the last day starting at or before it. Working the
 * Day starts out once and searching them keeps Intl out of the per-Review loop.
 */
function dayStarts(
  first: StudyDay,
  last: StudyDay,
  settings: Parameters<typeof studyDayBounds>[1],
) {
  const days: StudyDay[] = [];
  const starts: number[] = [];
  for (let day = first; day <= last; day = addStudyDays(day, 1)) {
    days.push(day);
    starts.push(studyDayBounds(day, settings).start.getTime());
  }
  /** The index in `days` of the Study day `ms` falls on; -1 before the first. */
  const indexOf = (ms: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((starts[mid] ?? Infinity) <= ms) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  return { days, indexOf };
}

/**
 * The statistics of the Reviews `where` picks among the User's, and of the
 * live Cards `cardsWhere` picks, over `range` up to the Study day of `now`.
 * `desiredRetentionOf` gives each counted Review's Desired retention, by its
 * Deck, for Actual retention's weighted one.
 */
function statisticsOf(
  tx: Queryable,
  userId: string,
  range: StatisticsRange,
  now: Date,
  where: SQL | undefined,
  cardsWhere: SQL | undefined,
  desiredRetentionOf: (deckId: string) => number,
  fallbackRetention: number,
): Statistics {
  const { studyDay } = schedulingSettingsOf(tx, userId);
  const today = studyDayOf(now, studyDay);
  const calendarFrom = calendarStartOf(today);
  const tomorrow = studyDayBounds(today, studyDay).end.getTime();

  const scoped = and(eq(review.userId, userId), where);
  let from: StudyDay;
  if (range === "all") {
    const first = tx
      .select({ at: sql<number | null>`min(${review.reviewedAt})` })
      .from(review)
      .where(scoped)
      .get()?.at;
    from = first === null || first === undefined ? today : studyDayOf(new Date(first), studyDay);
    if (from > today) from = today;
  } else from = addStudyDays(today, -(Number(range) - 1));

  const first = from < calendarFrom ? from : calendarFrom;
  const { days, indexOf } = dayStarts(first, today, studyDay);
  const rows = tx
    .select({
      reviewedAt: review.reviewedAt,
      durationMs: review.durationMs,
      rating: review.rating,
      kind: review.kind,
      suggestedRating: review.suggestedRating,
      model: review.model,
      deckId: review.deckId,
      state: sql<string>`json_extract(${review.cardBefore}, '$.state')`,
    })
    .from(review)
    .where(and(scoped, gte(review.reviewedAt, studyDayBounds(first, studyDay).start)))
    .orderBy(asc(review.reviewedAt))
    .all();

  const reviewsOn = Array.from({ length: days.length }, () => 0);
  const msOn = Array.from({ length: days.length }, () => 0);
  let recalled = 0;
  let learned = 0;
  let retentionSum = 0;
  const agreement: Agreement = { kept: 0, higher: 0, lower: 0 };
  const byModel = new Map<string, Agreement>();
  for (const row of rows) {
    const at = row.reviewedAt.getTime();
    // A Review stamped after today, by a clock ahead of the server's, waits for its day.
    if (at >= tomorrow) continue;
    const i = indexOf(at);
    const day = days[i];
    if (day === undefined) continue;
    reviewsOn[i] = (reviewsOn[i] ?? 0) + 1;
    msOn[i] = (msOn[i] ?? 0) + row.durationMs;
    if (day < from) continue;
    if (row.state === "review") {
      learned += 1;
      if (row.rating !== "again") recalled += 1;
      retentionSum += desiredRetentionOf(row.deckId);
    }
    if (row.kind === "graded" && row.suggestedRating !== null && row.model !== null) {
      const by = rank(row.rating) - rank(row.suggestedRating);
      const key = by === 0 ? "kept" : by > 0 ? "higher" : "lower";
      agreement[key] += 1;
      let model = byModel.get(row.model);
      if (model === undefined) {
        model = { kept: 0, higher: 0, lower: 0 };
        byModel.set(row.model, model);
      }
      model[key] += 1;
    }
  }

  const calendar: Statistics["calendar"] = [];
  days.forEach((day, i) => {
    const reviews = reviewsOn[i] ?? 0;
    if (day >= calendarFrom && reviews > 0) calendar.push({ day, reviews, ms: msOn[i] ?? 0 });
  });

  const weekly = range === "all" && studyDaysBetween(from, today) > DAILY_MINUTES_DAYS_MAX;
  const points: { start: StudyDay; ms: number }[] = [];
  days.forEach((day, i) => {
    if (day < from) return;
    const start = weekly ? mondayOf(day) : day;
    const last = points.at(-1);
    if (last !== undefined && last.start === start) last.ms += msOn[i] ?? 0;
    else points.push({ start, ms: msOn[i] ?? 0 });
  });

  const stages = tx
    .select({ state: card.state, count: count() })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(
      and(
        eq(card.userId, userId),
        isNull(card.deletedAt),
        eq(deck.userId, userId),
        isNull(deck.deletedAt),
        cardsWhere,
      ),
    )
    .groupBy(card.state)
    .all();
  const cards = { new: 0, learning: 0, learned: 0 };
  for (const { state, count: n } of stages) {
    if (state === "new") cards.new += n;
    else if (state === "review") cards.learned += n;
    else cards.learning += n;
  }

  return {
    range,
    from,
    to: today,
    calendar,
    minutes: { bucket: weekly ? "week" : "day", points },
    actualRetention: {
      recalled,
      total: learned,
      desiredRetention: learned === 0 ? fallbackRetention : retentionSum / learned,
    },
    cards,
    graderAgreement: {
      ...agreement,
      models: [...byModel.entries()]
        .map(([model, split]) => ({ model, ...split }))
        .toSorted(
          (a, b) =>
            b.kept + b.higher + b.lower - (a.kept + a.higher + a.lower) ||
            a.model.localeCompare(b.model),
        ),
    },
  };
}

/**
 * The User's statistics (BAN-53), worked out from their Reviews on each
 * request. Every query is scoped by the User (ADR-0001).
 */
export function createStatisticsRepository(db: Queryable) {
  return {
    /**
     * The statistics of every Review of the User's over `range`, whatever its
     * Card or Deck became, and of their live Cards in live Decks. Actual
     * retention compares with its Reviews' Decks' Desired retention, weighted
     * by those Reviews; a Removed Deck's are Settings'. `now` is for tests.
     */
    overall(
      userId: string,
      range: StatisticsRange,
      { now = new Date() }: { now?: Date } = {},
    ): Statistics {
      return db.transaction((tx) => {
        const settings = schedulingSettingsOf(tx, userId).desiredRetention;
        const own = new Map(
          tx
            .select({ id: deck.id, desiredRetention: deck.desiredRetention })
            .from(deck)
            .where(eq(deck.userId, userId))
            .all()
            .map((d) => [d.id, d.desiredRetention ?? settings]),
        );
        return statisticsOf(
          tx,
          userId,
          range,
          now,
          undefined,
          undefined,
          (deckId) => own.get(deckId) ?? settings,
          settings,
        );
      });
    },

    /**
     * The statistics of the Reviews whose Deck is the User's Deck `deckId`
     * (its Cards' latest, ADR-0021, Removed Cards' included), over `range`,
     * and of its live Cards, compared with its Desired retention. "not_found"
     * for a deleted Deck, an unknown one and another User's. `now` is for tests.
     */
    deck(
      userId: string,
      deckId: string,
      range: StatisticsRange,
      { now = new Date() }: { now?: Date } = {},
    ): Statistics | "not_found" {
      return db.transaction((tx) => {
        if (!isLiveDeck(tx, userId, deckId)) return "not_found";
        const own = tx
          .select({ desiredRetention: deck.desiredRetention })
          .from(deck)
          .where(and(eq(deck.userId, userId), eq(deck.id, deckId)))
          .get()?.desiredRetention;
        const retention = own ?? schedulingSettingsOf(tx, userId).desiredRetention;
        return statisticsOf(
          tx,
          userId,
          range,
          now,
          eq(review.deckId, deckId),
          eq(card.deckId, deckId),
          () => retention,
          retention,
        );
      });
    },
  };
}
