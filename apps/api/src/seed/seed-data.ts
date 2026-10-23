import type { Queryable } from "../db/database";
import { createSettingsRepository } from "../repositories/settings";

import { SEED_TIMEZONE } from "./seed-ids";

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

/** Writes the Seed data for `userId` through the repositories, timed relative to `now`. */
export function writeSeedData({ db, userId }: { db: Queryable; userId: string; now: Date }): void {
  // Only while no Timezone is stored, as the first fill does: a signed-in load
  // before seeding may already have stored the browser's zone, or the User may
  // have chosen one. The Day start stays the default.
  createSettingsRepository(db).setInitialTimezone(userId, SEED_TIMEZONE);
}

/**
 * Whether the User owns any content (folders, decks, cards, reviews), in which
 * case `banki seed` refuses. There are no content tables yet, so never.
 * Settings aren't content: seeding leaves a stored choice alone instead.
 */
export function userHasContent(_db: Queryable, _userId: string): boolean {
  return false;
}
