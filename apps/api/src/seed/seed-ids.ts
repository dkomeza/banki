// The Seed data's fixed IDs and values, in a module of their own that imports nothing, so
// the `ui` script's route manifest (scripts/ui/routes.ts), which Node runs
// straight from TypeScript, can build concrete paths to the seeded screens.

/**
 * The Seed data's fixed IDs, for building concrete paths to its screens.
 * `deck` is the one the route manifest shoots the deck page at, `folder`
 * the folder page, and `card` the edit-card page: a Calculus 2 Card with a
 * Front of two lines and a Back of several, which refers to the one seeded
 * Image, `image`, so the page shows its thumbnail.
 */
export const SEED_IDS = {
  deck: "5eed0000-0000-4000-8000-000000000001",
  card: "5eed0000-0000-4000-8000-0000000c0205",
  image: "5eed0000-0000-4000-8000-00000000a001",
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
  /** Each seeded Deck's Cards, oldest first; Calculus 10 has none. */
  cards: {
    spanish: [
      "5eed0000-0000-4000-8000-0000000c0101",
      "5eed0000-0000-4000-8000-0000000c0102",
      "5eed0000-0000-4000-8000-0000000c0103",
      "5eed0000-0000-4000-8000-0000000c0104",
      "5eed0000-0000-4000-8000-0000000c0105",
      "5eed0000-0000-4000-8000-0000000c0106",
      "5eed0000-0000-4000-8000-0000000c0107",
      "5eed0000-0000-4000-8000-0000000c0108",
    ],
    calculus2: [
      "5eed0000-0000-4000-8000-0000000c0200",
      "5eed0000-0000-4000-8000-0000000c0201",
      "5eed0000-0000-4000-8000-0000000c0202",
      "5eed0000-0000-4000-8000-0000000c0203",
      "5eed0000-0000-4000-8000-0000000c0204",
      "5eed0000-0000-4000-8000-0000000c0205",
    ],
    kanji: [
      "5eed0000-0000-4000-8000-0000000c0300",
      "5eed0000-0000-4000-8000-0000000c0301",
      "5eed0000-0000-4000-8000-0000000c0302",
      "5eed0000-0000-4000-8000-0000000c0303",
    ],
    chemistry: [
      "5eed0000-0000-4000-8000-0000000c0400",
      "5eed0000-0000-4000-8000-0000000c0401",
      "5eed0000-0000-4000-8000-0000000c0402",
    ],
  },
  /**
   * The Deletions Recently deleted shows, one of each case (`deletedSeed`, in
   * seed-data.ts), newest first.
   */
  deletions: {
    physics: "5eed0000-0000-4000-8000-0000000de001",
    madrugada: "5eed0000-0000-4000-8000-0000000de002",
    statistics: "5eed0000-0000-4000-8000-0000000de003",
    spanish: "5eed0000-0000-4000-8000-0000000de004",
    oldSemester: "5eed0000-0000-4000-8000-0000000de005",
    linearAlgebra: "5eed0000-0000-4000-8000-0000000de006",
    german: "5eed0000-0000-4000-8000-0000000de007",
    termin: "5eed0000-0000-4000-8000-0000000de008",
    calculus1: "5eed0000-0000-4000-8000-0000000de009",
  },
} as const;

/**
 * The seed User's Timezone. The `ui` script pins its browser to the same zone,
 * so the Settings page never shows the mismatch hint in its shots.
 */
export const SEED_TIMEZONE = "Europe/Warsaw";

/**
 * The seed time the `ui` script's stacks seed at (`BANKI_SEED_NOW`), and the
 * fixed clock its browsers run on, so the times and days the deck page shows
 * its Cards under are the same on every run: a Monday, 13:00 in the seed
 * Timezone.
 */
export const SEED_NOW = "2026-10-26T12:00:00.000Z";
