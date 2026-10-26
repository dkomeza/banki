import type { Queryable } from "../db/database";
import { createDeckRepository } from "../repositories/decks";
import { createFolderRepository } from "../repositories/folders";
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
 * The four Folders, each created this many days before the seed time, so the
 * two sorts differ: Languages and Maths with decks in them, Analysis inside
 * Maths, and Archive empty. Parents come before what's inside them.
 */
const FOLDERS = [
  { id: SEED_IDS.folders.languages, daysAgo: 45, name: "Languages", parentId: null },
  { id: SEED_IDS.folders.maths, daysAgo: 33, name: "Maths", parentId: null },
  {
    id: SEED_IDS.folders.analysis,
    daysAgo: 31,
    name: "Analysis",
    parentId: SEED_IDS.folders.maths,
  },
  { id: SEED_IDS.folders.archive, daysAgo: 6, name: "Archive", parentId: null },
] as const;

/**
 * The five Decks, in their Folders (Organic chemistry at the Root), each created this many days before the seed time, so the
 * Alphabetical and Newest sorts differ: some with a description and some
 * without, one description with line breaks, one name close to the 100
 * characters a name may have, and "Calculus 2" before "Calculus 10" only in
 * natural order.
 */
const DECKS = [
  {
    id: SEED_IDS.decks.spanish,
    folderId: SEED_IDS.folders.languages,
    daysAgo: 41,
    name: "Spanish vocabulary",
    description:
      "Everyday words from class and the café down the street.\nSpanish on the front, English on the back.\n\nOne word per card, with an example sentence.",
  },
  {
    id: SEED_IDS.decks.calculus2,
    folderId: SEED_IDS.folders.analysis,
    daysAgo: 30,
    name: "Calculus 2",
    description: "Integrals, sequences and series: the second semester.",
  },
  {
    id: SEED_IDS.decks.kanji,
    folderId: SEED_IDS.folders.languages,
    daysAgo: 20,
    name: "Japanese kanji (JLPT N4)",
    description: "Readings on the back, with one example word each.",
  },
  {
    id: SEED_IDS.decks.chemistry,
    folderId: null,
    daysAgo: 12,
    name: "Organic chemistry: reaction mechanisms, named reactions and the reagents behind each of the steps",
    description: null,
  },
  {
    id: SEED_IDS.decks.calculus10,
    folderId: SEED_IDS.folders.analysis,
    daysAgo: 2,
    name: "Calculus 10",
    description: null,
  },
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

  const folders = createFolderRepository(db);
  for (const { id, daysAgo, name, parentId } of FOLDERS) {
    const created = folders.create(
      userId,
      { name, parentId },
      { id, now: new Date(now.getTime() - daysAgo * DAY_MS) },
    );
    if (typeof created === "string") throw new Error(`The seed Folder ${name} is ${created}`);
  }

  const decks = createDeckRepository(db);
  for (const { id, folderId, daysAgo, name, description } of DECKS) {
    const created = decks.create(
      userId,
      { name, description, folderId },
      { id, now: new Date(now.getTime() - daysAgo * DAY_MS) },
    );
    if (typeof created === "string") throw new Error(`The seed Deck ${name} is ${created}`);
  }
}

/**
 * Whether the User owns any content (folders, decks, cards, reviews), in which
 * case `banki seed` refuses. Deleted Folders and Decks count too: they are still the
 * User's until they are purged. Settings aren't content: seeding leaves a
 * stored choice alone instead.
 */
export function userHasContent(db: Queryable, userId: string): boolean {
  return createDeckRepository(db).any(userId) || createFolderRepository(db).any(userId);
}
