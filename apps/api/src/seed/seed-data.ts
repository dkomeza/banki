import type { Queryable } from "../db/database";
import { createDeckRepository } from "../repositories/decks";
import { setInitialTimezone } from "../repositories/settings";

import { SEED_IDS, SEED_TIMEZONE } from "./seed-ids";

export { SEED_IDS, SEED_TIMEZONE } from "./seed-ids";

// The Seed data: the fixed sample content `banki seed` writes for a Preview or
// a developer's local copy (ADR-0007). It is the same on every run, so two
// builds can be compared screen by screen: fixed IDs and content, written
// through the repositories so a schema change that breaks it fails the
// typecheck, with timestamps relative to the seed time so cards stay due.
//
// An issue that adds something the UI shows adds Seed data for it here, with
// any new fixed IDs in SEED_IDS (seed-ids.ts), and extends `userHasContent` to
// any new User-owned table. A screen whose route has params also gets an entry
// in the `ui` script's route manifest, scripts/ui/routes.ts.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The five Decks, each created this many days before the seed time, so the
 * Alphabetical and Newest sorts differ: some with a description and some
 * without, one description with line breaks, one name close to the 100
 * characters a name may have, and "Calculus 2" before "Calculus 10" only in
 * natural order.
 */
const DECKS = [
  {
    id: SEED_IDS.decks.spanish,
    daysAgo: 41,
    name: "Spanish vocabulary",
    description:
      "Everyday words from class and the café down the street.\nSpanish on the front, English on the back.\n\nOne word per card, with an example sentence.",
  },
  {
    id: SEED_IDS.decks.calculus2,
    daysAgo: 30,
    name: "Calculus 2",
    description: "Integrals, sequences and series: the second semester.",
  },
  {
    id: SEED_IDS.decks.kanji,
    daysAgo: 20,
    name: "Japanese kanji (JLPT N4)",
    description: "Readings on the back, with one example word each.",
  },
  {
    id: SEED_IDS.decks.chemistry,
    daysAgo: 12,
    name: "Organic chemistry: reaction mechanisms, named reactions and the reagents behind each of the steps",
    description: null,
  },
  { id: SEED_IDS.decks.calculus10, daysAgo: 2, name: "Calculus 10", description: null },
] as const;

/** Writes the Seed data for `userId` through the repositories, timed relative to `now`. */
export function writeSeedData({
  db,
  userId,
  now,
}: {
  db: Queryable;
  userId: string;
  now: Date;
}): void {
  // Only while no Timezone is stored, as the first fill does: a signed-in load
  // before seeding may already have stored the browser's zone, or the User may
  // have chosen one. The Day start stays the default.
  // It stores no API key: a Preview starts with none, and the default Model.
  setInitialTimezone(db, userId, SEED_TIMEZONE);

  const decks = createDeckRepository(db);
  for (const { id, daysAgo, name, description } of DECKS) {
    const created = decks.create(
      userId,
      { name, description },
      { id, now: new Date(now.getTime() - daysAgo * DAY_MS) },
    );
    if (created === "taken") throw new Error(`The seed Deck ${name} is taken`);
  }
}

/**
 * Whether the User owns any content (folders, decks, cards, reviews), in which
 * case `banki seed` refuses. Deleted Decks count too: they are still the
 * User's until they are purged. Settings aren't content: seeding leaves a
 * stored choice alone instead.
 */
export function userHasContent(db: Queryable, userId: string): boolean {
  return createDeckRepository(db).any(userId);
}
