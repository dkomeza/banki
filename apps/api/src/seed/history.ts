import {
  MODELS,
  REVIEW_CAP_MS,
  type Rating,
  addStudyDays,
  studyDayBounds,
  studyDayOf,
} from "@banki/shared";
import type { Queryable } from "../db/database";
import { createCardRepository } from "../repositories/cards";
import { removeDeletion } from "../repositories/deletions";
import { type ReviewRepository, schedulingSettingsOf } from "../repositories/reviews";
import { CAPITAL_CARDS, SEED_IDS, capitalCardId } from "./seed-ids";

// World capitals' history (BAN-53): about 120 days of Reviews, generated from
// a PRNG with a fixed seed, so it is the same on every run. Each Study day
// that has a Session rates the Cards FSRS made due by then, and a few New
// ones, through the review repository, so every memory state follows from
// the Reviews before it, as the Statistics pages and Tuning read them.

/** How many days before the seed time World capitals' history starts. */
export const HISTORY_DAYS = 120;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

/** The two Models that graded some of its Reviews: the first mostly kept, the second often changed. */
export const HISTORY_MODELS = [MODELS[0]?.id ?? "", MODELS[1]?.id ?? ""] as const;

/** How often each Model's suggestion was kept. */
const KEPT_ODDS = [0.9, 0.45] as const;

/** How many New cards a Session introduces. */
const NEW_PER_SESSION = 3;

/** How many Cards today's Session studies, at least, due or not. */
const STUDIED_AHEAD = 5;

/** How many days ago the last but one Card was deleted, then Removed. */
const REMOVED_DAYS_AGO = 70;
/** How many hours ago the last Card was deleted, a Deletion Recently deleted shows. */
const DELETED_HOURS_AGO = 300;

const CAPITALS = [
  ["France", "Paris"],
  ["Germany", "Berlin"],
  ["Italy", "Rome"],
  ["Spain", "Madrid"],
  ["Portugal", "Lisbon"],
  ["Poland", "Warsaw"],
  ["Czechia", "Prague"],
  ["Austria", "Vienna"],
  ["Hungary", "Budapest"],
  ["Sweden", "Stockholm"],
  ["Norway", "Oslo"],
  ["Finland", "Helsinki"],
  ["Denmark", "Copenhagen"],
  ["Ireland", "Dublin"],
  ["Greece", "Athens"],
  ["Romania", "Bucharest"],
  ["Bulgaria", "Sofia"],
  ["Croatia", "Zagreb"],
  ["Slovenia", "Ljubljana"],
  ["Slovakia", "Bratislava"],
  ["Lithuania", "Vilnius"],
  ["Latvia", "Riga"],
  ["Estonia", "Tallinn"],
  ["Canada", "Ottawa"],
  ["Australia", "Canberra"],
  ["Japan", "Tokyo"],
  ["Kenya", "Nairobi"],
  ["Peru", "Lima"],
  ["Mongolia", "Ulaanbaatar"],
  ["Bhutan", "Thimphu"],
] as const;

/** A PRNG with a fixed seed (mulberry32): the same numbers on every run. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATING_ORDER: readonly Rating[] = ["again", "hard", "good", "easy"];

/** A Rating by odds, for a Card in `state`. */
function ratingFor(state: string, roll: number): Rating {
  const odds: readonly (readonly [Rating, number])[] =
    state === "review"
      ? [
          ["again", 0.1],
          ["hard", 0.18],
          ["good", 0.88],
        ]
      : state === "new"
        ? [
            ["again", 0.15],
            ["hard", 0.2],
            ["good", 0.82],
          ]
        : [
            ["again", 0.12],
            ["hard", 0.18],
            ["good", 0.97],
          ];
  return odds.find(([, upTo]) => roll < upTo)?.[0] ?? "easy";
}

/**
 * Writes World capitals' Cards and their history, timed relative to `now`.
 * `before(at)` is called ahead of each Session at `at`, so the Seed data's
 * other Reviews can take their places in the Write order among these.
 */
export function historySeed(
  db: Queryable,
  userId: string,
  now: Date,
  reviews: ReviewRepository,
  before: (at: Date) => void,
): void {
  const cards = createCardRepository(db);
  const createdAt = now.getTime() - (HISTORY_DAYS + 4) * DAY_MS;
  for (const [i, [country, capital]] of CAPITALS.slice(0, CAPITAL_CARDS).entries()) {
    const id = capitalCardId(i + 1);
    const created = cards.create(
      userId,
      SEED_IDS.decks.capitals,
      { front: `The capital of ${country}?`, back: capital },
      { id, now: new Date(createdAt + i) },
    );
    if (typeof created === "string") throw new Error(`The seed Card ${id} is ${created}`);
    if ("deckFull" in created) throw new Error(`The seed Card ${id} finds its Deck full`);
  }

  const rand = mulberry32(53);
  /** Each introduced Card's state and due moment, as its last Rating left them. */
  const known = new Map<string, { state: string; due: number }>();
  let introduced = 0;
  const removed = capitalCardId(CAPITAL_CARDS - 1);
  const deleted = capitalCardId(CAPITAL_CARDS);
  const removedAt = now.getTime() - REMOVED_DAYS_AGO * DAY_MS;
  const deletedAt = now.getTime() - DELETED_HOURS_AGO * HOUR_MS;
  let reviewsWritten = 0;
  let removedDone = false;
  let deletedDone = false;

  const rate = (cardId: string, at: number, state: string) => {
    const rating = ratingFor(state, rand());
    const durationMs = Math.min(
      REVIEW_CAP_MS,
      Math.round((rating === "again" ? 14_000 : 5_000) + rand() * 12_000),
    );
    // Two in five of the Reviews after the first month were graded.
    let graded: { suggestedRating: Rating; model: string } | undefined;
    if (at > now.getTime() - (HISTORY_DAYS - 30) * DAY_MS && rand() < 0.4) {
      const which = rand() < 0.6 ? 0 : 1;
      const index = RATING_ORDER.indexOf(rating);
      let suggested = index;
      if (rand() >= KEPT_ODDS[which]) {
        suggested = index + (rand() < 0.5 ? -1 : 1);
        if (suggested < 0 || suggested > 3) suggested = index + (index === 0 ? 1 : -1);
      }
      graded = { suggestedRating: RATING_ORDER[suggested] ?? rating, model: HISTORY_MODELS[which] };
    }
    const rated = reviews.rate(
      userId,
      cardId,
      { rating, durationMs, ...graded },
      { id: historyReviewId(reviewsWritten), now: new Date(at) },
    );
    if (rated === "not_found") throw new Error(`The seed Review of ${cardId} found no Card`);
    reviewsWritten += 1;
    const due = rated.schedule.due === null ? Infinity : new Date(rated.schedule.due).getTime();
    known.set(cardId, { state: rated.schedule.state, due });
    return durationMs;
  };

  const { studyDay } = schedulingSettingsOf(db, userId);
  const today = studyDayOf(now, studyDay);
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    // Today always has a Session; other days most often on weekdays.
    const day = addStudyDays(today, -back);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const odds = weekday === 0 || weekday === 6 ? 0.55 : 0.85;
    if (back > 0 && rand() > odds) continue;
    // In the afternoon or evening of its Study day; today's, before the seed time.
    const start = studyDayBounds(day, studyDay).start.getTime();
    let at = start + Math.round((10 + rand() * 6) * HOUR_MS);
    if (back === 0) {
      const latest = now.getTime() - 30 * MINUTE_MS;
      if (latest <= start) continue;
      at = Math.min(at, start + Math.round(rand() * (latest - start)));
    }

    if (!removedDone && at > removedAt) {
      const deletion = cards.softDelete(userId, removed, new Date(removedAt), REMOVED_DELETION);
      if (deletion === undefined || !removeDeletion(db, userId, deletion))
        throw new Error("The seed Removal removed nothing");
      known.delete(removed);
      removedDone = true;
    }
    if (!deletedDone && at > deletedAt) {
      if (
        cards.softDelete(userId, deleted, new Date(deletedAt), SEED_IDS.deletions.capital) ===
        undefined
      )
        throw new Error("The seed Deletion deleted nothing");
      known.delete(deleted);
      deletedDone = true;
    }

    before(new Date(at));
    const end = Math.min(at + HOUR_MS, now.getTime());
    // Today's Session also studies ahead, so the history always reaches today.
    const due = [...known.entries()]
      .toSorted(([, a], [, b]) => a.due - b.due)
      .filter(([, card], i) => card.due <= at || (back === 0 && i < STUDIED_AHEAD))
      .map(([id, card]) => [id, card.state] as const);
    for (const [id, state] of due) {
      if (at >= end) break;
      at += rate(id, at, state) + 2_000;
    }
    for (let n = 0; n < NEW_PER_SESSION && introduced < CAPITAL_CARDS && at < end; n++) {
      const id = capitalCardId(++introduced);
      if ((id === removed && removedDone) || (id === deleted && deletedDone)) continue;
      at += rate(id, at, "new") + 2_000;
    }
    // Then the learning steps due within the Session, waiting for each.
    for (let pass = 0; pass < 4; pass++) {
      const steps = [...known.entries()]
        .filter(([, card]) => card.state !== "review" && card.due <= at + 15 * MINUTE_MS)
        .toSorted(([, a], [, b]) => a.due - b.due);
      if (steps.length === 0) break;
      for (const [id, card] of steps) {
        at = Math.max(at, card.due);
        if (at >= end) break;
        at += rate(id, at, card.state) + 2_000;
      }
    }
  }
}

/** The fixed ID of World capitals' Removed Card's Deletion, which its Removal takes away. */
const REMOVED_DELETION = "5eed0000-0000-4000-8000-0000000de0ff";

/** The fixed ID of World capitals' `n`th Review, from 0. */
const historyReviewId = (n: number) =>
  `5eed0000-0000-4000-8000-${(0xe1000000000 + n).toString(16).padStart(12, "0")}`;
