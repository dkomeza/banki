import type { Queryable } from "../db/database";
import { createCardRepository } from "../repositories/cards";
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

const { spanish, calculus2, kanji, chemistry } = SEED_IDS.cards;

/**
 * The Cards, each written this many hours before the seed time (after its
 * Deck), so the deck page's newest-first order and its days show: short word
 * Cards in Spanish vocabulary, some Backs with an example sentence on a
 * second line; LaTeX source in Calculus 2, one a derivation over several
 * lines (`SEED_IDS.card`); a few in Japanese kanji and Organic chemistry, one
 * of them very long. Calculus 10 stays empty, for the empty state.
 */
const CARDS: readonly {
  id: string;
  deckId: string;
  hoursAgo: number;
  front: string;
  back: string;
}[] = [
  {
    id: spanish[0],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 980,
    front: "el desayuno",
    back: "breakfast\nTomo el desayuno a las ocho.",
  },
  {
    id: spanish[1],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 960,
    front: "la cuenta",
    back: "the bill, the check\n¿Nos trae la cuenta, por favor?",
  },
  {
    id: spanish[2],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 700,
    front: "madrugar",
    back: "to get up early",
  },
  {
    id: spanish[3],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 650,
    front: "el andén",
    back: "the (railway) platform",
  },
  {
    id: spanish[4],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 400,
    front: "quedar",
    back: "to meet up; to be left; to suit\n¿Quedamos a las seis?",
  },
  {
    id: spanish[5],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 220,
    front: "la sobremesa",
    back: "the time spent chatting at the table after a meal",
  },
  {
    id: spanish[6],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 90,
    front: "estar de acuerdo",
    back: "to agree\nEstoy de acuerdo contigo.",
  },
  {
    id: spanish[7],
    deckId: SEED_IDS.decks.spanish,
    hoursAgo: 2,
    front: "el ayuntamiento",
    back: "the town hall",
  },
  {
    id: calculus2[0],
    deckId: SEED_IDS.decks.calculus2,
    hoursAgo: 700,
    front: "Integration by parts",
    back: "$\\int u\\,dv = uv - \\int v\\,du$",
  },
  {
    id: calculus2[1],
    deckId: SEED_IDS.decks.calculus2,
    hoursAgo: 500,
    front: "Derive the Maclaurin series of $\\ln(1+x)$.\n\nFor which $x$ does it converge?",
    back: [
      "Start from the geometric series:",
      "$$\\frac{1}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n t^n, \\quad |t| < 1$$",
      "Integrate both sides from $0$ to $x$:",
      "$$\\ln(1+x) = \\int_0^x \\frac{dt}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n \\frac{x^{n+1}}{n+1}$$",
      "so",
      "$$\\ln(1+x) = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\frac{x^4}{4} + \\cdots$$",
      "It converges for $-1 < x \\le 1$: at $x = 1$ by the alternating series test (giving $\\ln 2$), and it diverges at $x = -1$ (the harmonic series).",
    ].join("\n"),
  },
  {
    id: calculus2[2],
    deckId: SEED_IDS.decks.calculus2,
    hoursAgo: 300,
    front: "Ratio test",
    back: "If $\\lim_{n\\to\\infty} \\left|\\frac{a_{n+1}}{a_n}\\right| = L < 1$, then $\\sum a_n$ converges absolutely; $L > 1$ diverges; $L = 1$ says nothing.",
  },
  {
    id: calculus2[3],
    deckId: SEED_IDS.decks.calculus2,
    hoursAgo: 120,
    front: "$\\int \\sec x \\, dx$",
    back: "$\\ln\\lvert \\sec x + \\tan x \\rvert + C$",
  },
  {
    id: calculus2[4],
    deckId: SEED_IDS.decks.calculus2,
    hoursAgo: 30,
    front: "When does $\\sum \\frac{1}{n^p}$ converge?",
    back: "For $p > 1$ (the $p$-series test).",
  },
  {
    id: kanji[0],
    deckId: SEED_IDS.decks.kanji,
    hoursAgo: 450,
    front: "駅",
    back: "えき (eki): station\n駅前 (えきまえ): in front of the station",
  },
  {
    id: kanji[1],
    deckId: SEED_IDS.decks.kanji,
    hoursAgo: 300,
    front: "質",
    back: "シツ, シチ: quality, matter\n質問 (しつもん): question",
  },
  {
    id: kanji[2],
    deckId: SEED_IDS.decks.kanji,
    hoursAgo: 150,
    front: "借",
    back: "か(りる), シャク: borrow\n借りる (かりる): to borrow",
  },
  {
    id: kanji[3],
    deckId: SEED_IDS.decks.kanji,
    hoursAgo: 60,
    front: "construct a sentence with 急に",
    back: "急に雨が降り出した。\nIt suddenly started to rain.",
  },
  {
    id: chemistry[0],
    deckId: SEED_IDS.decks.chemistry,
    hoursAgo: 280,
    front: "SN1 vs SN2: which is favoured by a tertiary substrate?",
    back: "SN1: the tertiary carbocation is stabilised, and the backside attack of SN2 is blocked.",
  },
  {
    id: chemistry[1],
    deckId: SEED_IDS.decks.chemistry,
    hoursAgo: 200,
    front:
      "Walk through the mechanism of the aldol condensation under basic conditions, naming each intermediate.",
    back: [
      "1. Hydroxide removes an α-hydrogen from the aldehyde, giving a resonance-stabilised enolate.",
      "2. The enolate's α-carbon attacks the carbonyl carbon of a second aldehyde molecule, giving an alkoxide.",
      "3. The alkoxide takes a proton from water, giving the β-hydroxy aldehyde (the aldol) and regenerating hydroxide.",
      "4. On heating, hydroxide removes another α-hydrogen, giving an enolate again.",
      "5. The enolate pushes out hydroxide from the β-carbon (E1cB), giving the α,β-unsaturated aldehyde.",
      "",
      "The condensation step is driven by conjugation: the C=C ends up conjugated with the C=O, which is why heating pushes the equilibrium to the enal. With two different carbonyl partners you get a crossed aldol, and a mixture unless one partner has no α-hydrogens (benzaldehyde, formaldehyde) or one is preformed as its enolate with LDA at −78 °C.",
    ].join("\n"),
  },
  {
    id: chemistry[2],
    deckId: SEED_IDS.decks.chemistry,
    hoursAgo: 100,
    front: "Grignard reagent + ketone gives…",
    back: "a tertiary alcohol (after an acidic workup)",
  },
];

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

  const cards = createCardRepository(db);
  for (const { id, deckId, hoursAgo, front, back } of CARDS) {
    const created = cards.create(
      userId,
      deckId,
      { front, back },
      { id, now: new Date(now.getTime() - hoursAgo * HOUR_MS) },
    );
    if (typeof created === "string") throw new Error(`The seed Card ${id} is ${created}`);
  }
}

/**
 * Whether the User owns any content (folders, decks, cards, reviews), in which
 * case `banki seed` refuses. Deleted Folders, Decks and Cards count too: they
 * are still the User's until they are purged. Settings aren't content: seeding leaves a
 * stored choice alone instead.
 */
export function userHasContent(db: Queryable, userId: string): boolean {
  return (
    createDeckRepository(db).any(userId) ||
    createFolderRepository(db).any(userId) ||
    createCardRepository(db).any(userId)
  );
}
