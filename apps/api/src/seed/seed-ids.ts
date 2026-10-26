// The Seed data's fixed IDs and values, in a module of their own that imports nothing, so
// the `ui` script's route manifest (scripts/ui/routes.ts), which Node runs
// straight from TypeScript, can build concrete paths to the seeded screens.

/**
 * The Seed data's fixed IDs, for building concrete paths to its screens.
 * `deck` is the one the route manifest shoots the deck page at, and `folder`
 * the folder page, and `card` the edit-card page (a Card with a multi-line
 * Front and Back).
 */
export const SEED_IDS = {
  deck: "5eed0000-0000-4000-8000-000000000001",
  card: "5eed0000-0000-4000-8000-0000000c0201",
  folder: "5eed0000-0000-4000-8000-0000000000f3",
  folders: {
    languages: "5eed0000-0000-4000-8000-0000000000f1",
    maths: "5eed0000-0000-4000-8000-0000000000f2",
    analysis: "5eed0000-0000-4000-8000-0000000000f3",
    archive: "5eed0000-0000-4000-8000-0000000000f4",
  },
  decks: {
    spanish: "5eed0000-0000-4000-8000-000000000001",
    calculus2: "5eed0000-0000-4000-8000-000000000002",
    calculus10: "5eed0000-0000-4000-8000-000000000003",
    chemistry: "5eed0000-0000-4000-8000-000000000004",
    kanji: "5eed0000-0000-4000-8000-000000000005",
  },
} as const;

/**
 * The seed User's Timezone. The `ui` script pins its browser to the same zone,
 * so the Settings page never shows the mismatch hint in its shots.
 */
export const SEED_TIMEZONE = "Europe/Warsaw";
