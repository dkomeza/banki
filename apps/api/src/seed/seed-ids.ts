// The Seed data's fixed IDs and values, in a module of their own that imports nothing, so
// the `ui` script's route manifest (scripts/ui/routes.ts), which Node runs
// straight from TypeScript, can build concrete paths to the seeded screens.

/**
 * The Seed data's fixed IDs, for building concrete paths to its screens.
 * `deck` is the one the route manifest shoots the deck page at, `folder`
 * the folder page, and `card` the edit-card page: a Calculus 2 Card with a
 * Front of two lines and a Back of several, which refers to the one seeded
 * Image, `image`, so the page shows its thumbnail. It has a Review, so the
 * page shows the Reset progress row.
 */
export const SEED_IDS = {
  deck: "5eed0000-0000-4000-8000-000000000001",
  card: "5eed0000-0000-4000-8000-0000000c0205",
  image: "5eed0000-0000-4000-8000-00000000a001",
  folder: "5eed0000-0000-4000-8000-0000000000f3",
  /**
   * The confirmed Import into the seed Deck, whose report /imports/$importId
   * shows: a zip of market and café words, with a Duplicate, an invalid Card,
   * one left out, Macros added and kept, and an image the zip didn't hold.
   */
  import: "5eed0000-0000-4000-8000-0000000001a1",
  /**
   * An older confirmed Import into the seed Deck, undone since (ADR-0030), so
   * Past imports shows an undone entry and Recently deleted an Import's.
   */
  undoneImport: "5eed0000-0000-4000-8000-0000000001a2",
  /** The one Tuning log row: an automatic Tuning that applied FSRS-6's defaults, so Settings shows Scheduling tuned. */
  tuning: "5eed0000-0000-4000-8000-0000000007a1",
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
  /**
   * Each seeded Deck's Cards, oldest first; Calculus 10 has none. Calculus 2's
   * last three use Macros: Settings' `\norm`, `\abs` and `\eps`, and its own `\d`
   * and `\eps`.
   */
  cards: {
    spanish: [
      "5eed0000-0000-4000-8000-0000000c0101",
      "5eed0000-0000-4000-8000-0000000c0102",
      "5eed0000-0000-4000-8000-0000000c0103",
      "5eed0000-0000-4000-8000-0000000c0104",
      "5eed0000-0000-4000-8000-0000000c0105",
      "5eed0000-0000-4000-8000-0000000c0109",
      "5eed0000-0000-4000-8000-0000000c0106",
      "5eed0000-0000-4000-8000-0000000c0110",
      "5eed0000-0000-4000-8000-0000000c0107",
      "5eed0000-0000-4000-8000-0000000c0111",
      "5eed0000-0000-4000-8000-0000000c0108",
    ],
    calculus2: [
      "5eed0000-0000-4000-8000-0000000c0200",
      "5eed0000-0000-4000-8000-0000000c0201",
      "5eed0000-0000-4000-8000-0000000c0206",
      "5eed0000-0000-4000-8000-0000000c0202",
      "5eed0000-0000-4000-8000-0000000c0207",
      "5eed0000-0000-4000-8000-0000000c0203",
      "5eed0000-0000-4000-8000-0000000c0208",
      "5eed0000-0000-4000-8000-0000000c0209",
      "5eed0000-0000-4000-8000-0000000c0204",
      "5eed0000-0000-4000-8000-0000000c0205",
      "5eed0000-0000-4000-8000-0000000c0210",
      "5eed0000-0000-4000-8000-0000000c0211",
      "5eed0000-0000-4000-8000-0000000c0212",
    ],
    kanji: [
      "5eed0000-0000-4000-8000-0000000c0300",
      "5eed0000-0000-4000-8000-0000000c0301",
      "5eed0000-0000-4000-8000-0000000c0302",
      "5eed0000-0000-4000-8000-0000000c0303",
    ],
    /** The Cards the Import added to Spanish vocabulary, by their number in its file. */
    imported: {
      1: "5eed0000-0000-4000-8000-0000000c0501",
      2: "5eed0000-0000-4000-8000-0000000c0502",
      5: "5eed0000-0000-4000-8000-0000000c0505",
      6: "5eed0000-0000-4000-8000-0000000c0506",
      8: "5eed0000-0000-4000-8000-0000000c0508",
    },
    /** The Cards the undone Import added to Spanish vocabulary, by their number in its file. */
    undoneImport: {
      1: "5eed0000-0000-4000-8000-0000000c0601",
      2: "5eed0000-0000-4000-8000-0000000c0602",
      3: "5eed0000-0000-4000-8000-0000000c0603",
      4: "5eed0000-0000-4000-8000-0000000c0604",
      5: "5eed0000-0000-4000-8000-0000000c0605",
      6: "5eed0000-0000-4000-8000-0000000c0606",
    },
    chemistry: [
      "5eed0000-0000-4000-8000-0000000c0400",
      "5eed0000-0000-4000-8000-0000000c0401",
      "5eed0000-0000-4000-8000-0000000c0403",
      "5eed0000-0000-4000-8000-0000000c0402",
      "5eed0000-0000-4000-8000-0000000c0404",
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
    /** The undone Import's Undo. */
    verbos: "5eed0000-0000-4000-8000-0000000de00a",
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
