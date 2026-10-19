import type { Queryable } from "../db/database";

// The Seed data: the fixed sample content `banki seed` writes for a Preview or
// a developer's local copy (ADR-0007). It is the same on every run, so two
// builds can be compared screen by screen: fixed IDs and content, written
// through the repositories so a schema change that breaks it fails the
// typecheck, with timestamps relative to the seed time so cards stay due.
//
// An issue that adds something the UI shows adds Seed data for it here, with
// any new fixed IDs in SEED_IDS, and extends `userHasContent` to any new
// User-owned table.

/** The Seed data's fixed IDs, for building concrete paths to its screens. None yet. */
export const SEED_IDS = {} as const;

/** Writes the Seed data for `userId` through the repositories, timed relative to `now`. */
export function writeSeedData(_seed: { db: Queryable; userId: string; now: Date }): void {
  // Nothing yet: the first content issue (M2) adds the first Seed data.
}

/**
 * Whether the User owns any content, in which case `banki seed` refuses. There
 * are no content tables yet, so never.
 */
export function userHasContent(_db: Queryable, _userId: string): boolean {
  return false;
}
