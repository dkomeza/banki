import type { Queryable } from "../db/database";
import { createSettingsRepository } from "../repositories/settings";

export { SEED_IDS } from "./seed-ids";

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

/** The seed User's Timezone. The `ui` script pins its browser to the same zone. */
export const SEED_TIMEZONE = "Europe/Warsaw";

/** Writes the Seed data for `userId` through the repositories, timed relative to `now`. */
export function writeSeedData({ db, userId }: { db: Queryable; userId: string; now: Date }): void {
  // The Day start stays the default.
  createSettingsRepository(db).update(userId, { timezone: SEED_TIMEZONE });
}

/**
 * Whether the User owns any content, in which case `banki seed` refuses: so far
 * only stored Settings, which seeding would overwrite.
 */
export function userHasContent(db: Queryable, userId: string): boolean {
  return createSettingsRepository(db).exist(userId);
}
