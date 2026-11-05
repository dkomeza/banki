import type { CardFileProblem, Macro } from "@banki/shared";

// Prototype only (BAN-32): the Imports the import screens show, made up in the
// browser, as the API would read them. Every Variant draws the same ones, so
// they differ only in how they look.

/** A Card read from the file, with its number in the file's `cards`. */
export type FileCard = {
  number: number;
  front: string;
  back: string;
  tags: readonly string[];
  gradingNotes: string | null;
};

/** What the Macro plan does with one of the file's Macros. */
export type MacroPlan = Macro &
  (
    | { outcome: "added" }
    | { outcome: "kept"; deckDefinition: string }
    | { outcome: "not-added"; reason: string }
  );

/** An image a Card refers to that won't come with it. */
export type ImageProblem = {
  card: number;
  file: string;
  problem: "missing" | "too-big" | "type";
  detail: string;
};

export type InvalidCard = { number: number; problems: readonly CardFileProblem[] };

/** An unconfirmed Import, as the preview reads it. */
export type ImportPreview = {
  id: string;
  fileName: string;
  source: "zip" | "json" | "paste";
  /** How many entries the file's `cards` holds, valid or not. */
  total: number;
  cards: readonly FileCard[];
  invalid: readonly InvalidCard[];
  macros: readonly MacroPlan[];
  images: readonly ImageProblem[];
  /** How many Images came in the zip that some Card refers to. */
  imageCount: number;
  /** Cards the User has unticked, for the prototype's mixed state. */
  unticked: readonly number[];
};

/** A confirmed Import's report. */
export type ImportReport = {
  id: string;
  fileName: string;
  source: "zip" | "json" | "paste";
  confirmedAt: string;
  imported: number;
  imageCount: number;
  leftOut: number;
  duplicates: readonly { number: number; front: string }[];
  invalid: readonly InvalidCard[];
  macros: readonly MacroPlan[];
  images: readonly ImageProblem[];
};

/** The Deck the prototype imports into: the seed Deck, Spanish vocabulary. */
export const IMPORT_DECK_ID = "5eed0000-0000-4000-8000-000000000001";

const SEED_IMAGE = "images/5eed0000-0000-4000-8000-00000000a001.png";

const card = (
  number: number,
  front: string,
  back: string,
  tags: readonly string[] = [],
  gradingNotes: string | null = null,
): FileCard => ({ number, front, back, tags, gradingNotes });

const problems = (...texts: string[]): CardFileProblem[] => texts.map((text) => ({ text }));

/** The mixed preview: a zip of market and café words for Spanish vocabulary. */
export const PREVIEW: ImportPreview = {
  id: "5eed0000-0000-4000-8000-0000000001a2",
  fileName: "mercado-y-cafe.zip",
  source: "zip",
  total: 26,
  imageCount: 2,
  cards: [
    card(1, "el mercado", "the market $\\m$\nVamos al mercado los sábados.", [
      "a2",
      "shopping",
      "noun",
    ]),
    card(2, "la frutería $\\f$", "the fruit shop", ["a2", "shopping", "noun"]),
    card(3, "pesar", "to weigh\n¿Me lo pesa, por favor?", ["a2", "verb"]),
    card(4, "la cuenta", "the bill\n¿La cuenta, por favor?", ["a1", "restaurant", "noun"]),
    card(5, "un kilo de", "a kilo of\nUn kilo de tomates, por favor.", ["a2", "shopping"]),
    card(
      6,
      "la paella $\\f$",
      `a rice dish from Valencia, cooked in a wide pan\n\n![A paella pan](${SEED_IMAGE})`,
      ["a2", "food", "noun"],
      "The pan is also called *paella*; either meaning is fine.",
    ),
    card(7, "el puesto $\\m$", "the stall (at a market)", ["a2", "shopping", "noun"]),
    card(8, "¿Algo más?", "Anything else?\nThe stallholder's question before you pay.", [
      "a2",
      "phrase",
    ]),
    card(10, "barato / caro", "cheap / expensive", ["a1", "adjective"]),
    card(
      11,
      "los churros $\\m$",
      "fried dough sticks, often dipped in chocolate\n\n![Churros](images/churros.jpg)",
      ["a2", "food", "noun"],
    ),
    card(12, "la propina $\\f$", "the tip (for service)", ["a2", "restaurant", "noun"]),
    card(13, "Madrugar", "to get up early, at dawn", ["b1", "verb"]),
    card(14, "el cortado $\\m$", "an espresso with a dash of milk", ["a2", "cafe", "noun"]),
    card(15, "la tapa $\\f$", "a small dish served with a drink", ["a2", "food", "noun"]),
    card(
      16,
      "el mostrador $\\m$",
      "the counter\n\n![The counter at a market stall](images/mostrador.png)",
      ["b1", "shopping", "noun"],
    ),
    card(17, "pagar en efectivo", "to pay in cash", ["a2", "phrase"]),
    card(18, "el mercado", "the market (again, from another list)", ["a2", "noun"]),
    card(19, "pedir", "to order; to ask for\nPedimos dos cafés.", ["a1", "verb", "irregular"]),
    card(20, "la bolsa $\\f$", "the bag\n¿Quiere bolsa?", ["a2", "shopping", "noun"]),
    card(22, "maduro", "ripe\nEstos plátanos están maduros.", ["b1", "adjective"]),
    card(23, "el menú $\\m$", "the menu\n\n![The chalkboard menu](images/menu.heic)", [
      "a1",
      "restaurant",
      "noun",
    ]),
    card(24, "la merienda $\\f$", "an afternoon snack", ["a2", "food", "noun"]),
    card(25, "el precio $\\m$", "the price\n¿Qué precio tiene?", ["a1", "shopping", "noun"]),
    card(26, "$\\eps$ de diferencia", "a tiny difference (a joke card from the maths class)", [
      "b1",
    ]),
  ],
  invalid: [
    {
      number: 9,
      problems: problems(
        'card 9, "back": "back" is missing',
        'card 9, "tags" #2: "fresh produce": A tag is one word of letters, digits, - and _',
      ),
    },
    { number: 21, problems: problems('card 21, "front": The front is blank') },
  ],
  macros: [
    { name: "\\m", definition: "\\textsf{\\small m.}", outcome: "added" },
    { name: "\\f", definition: "\\textsf{\\small f.}", outcome: "added" },
    { name: "\\eps", definition: "\\epsilon", outcome: "kept", deckDefinition: "\\varepsilon" },
    {
      name: "\\conj",
      definition: `\\begin{array}{l|l} ${"yo & tú \\\\ ".repeat(60)}\\end{array}`,
      outcome: "not-added",
      reason: "Its definition is over 1,000 characters.",
    },
  ],
  images: [
    {
      card: 11,
      file: "images/churros.jpg",
      problem: "missing",
      detail: "The zip has no images/churros.jpg.",
    },
    {
      card: 16,
      file: "images/mostrador.png",
      problem: "too-big",
      detail: "It is 7.4 MB; an Image is at most 5 MB.",
    },
    {
      card: 23,
      file: "images/menu.heic",
      problem: "type",
      detail: "It is HEIC; an Image is png, jpeg, webp or gif.",
    },
  ],
  unticked: [20, 24],
};

// The 1,000-Card preview: adjectives on nouns, every one a different Front.

const NOUNS: readonly [string, string, "m" | "f"][] = [
  ["casa", "house", "f"],
  ["perro", "dog", "m"],
  ["mesa", "table", "f"],
  ["libro", "book", "m"],
  ["coche", "car", "m"],
  ["calle", "street", "f"],
  ["ciudad", "city", "f"],
  ["río", "river", "m"],
  ["puerta", "door", "f"],
  ["ventana", "window", "f"],
  ["camisa", "shirt", "f"],
  ["vaso", "glass", "m"],
  ["silla", "chair", "f"],
  ["jardín", "garden", "m"],
  ["playa", "beach", "f"],
  ["tren", "train", "m"],
  ["plato", "plate", "m"],
  ["cama", "bed", "f"],
  ["árbol", "tree", "m"],
  ["llave", "key", "f"],
  ["barco", "boat", "m"],
  ["taza", "cup", "f"],
  ["pueblo", "village", "m"],
  ["montaña", "mountain", "f"],
  ["cuchara", "spoon", "f"],
  ["sombrero", "hat", "m"],
  ["puente", "bridge", "m"],
  ["iglesia", "church", "f"],
  ["maleta", "suitcase", "f"],
  ["reloj", "watch", "m"],
  ["lámpara", "lamp", "f"],
  ["espejo", "mirror", "m"],
  ["gato", "cat", "m"],
  ["flor", "flower", "f"],
  ["carta", "letter", "f"],
  ["pájaro", "bird", "m"],
  ["nube", "cloud", "f"],
  ["huevo", "egg", "m"],
  ["isla", "island", "f"],
  ["abrigo", "coat", "m"],
];

const ADJECTIVES: readonly [string, string, string][] = [
  ["blanco", "blanca", "white"],
  ["negro", "negra", "black"],
  ["rojo", "roja", "red"],
  ["nuevo", "nueva", "new"],
  ["viejo", "vieja", "old"],
  ["pequeño", "pequeña", "small"],
  ["grande", "grande", "big"],
  ["bonito", "bonita", "pretty"],
  ["feo", "fea", "ugly"],
  ["limpio", "limpia", "clean"],
  ["sucio", "sucia", "dirty"],
  ["barato", "barata", "cheap"],
  ["caro", "cara", "expensive"],
  ["largo", "larga", "long"],
  ["corto", "corta", "short"],
  ["alto", "alta", "tall"],
  ["bajo", "baja", "low"],
  ["vacío", "vacía", "empty"],
  ["lleno", "llena", "full"],
  ["roto", "rota", "broken"],
  ["tranquilo", "tranquila", "quiet"],
  ["oscuro", "oscura", "dark"],
  ["claro", "clara", "light"],
  ["antiguo", "antigua", "ancient"],
  ["moderno", "moderna", "modern"],
];

const MANY_INVALID = [87, 233, 412, 598, 777, 913];
const MANY_DUPLICATES = new Map([
  [140, "la cuenta"],
  [508, "el desayuno"],
  [866, "la casa blanca"],
]);

function manyCards(): FileCard[] {
  const cards: FileCard[] = [];
  for (let number = 1; number <= 1000; number++) {
    if (MANY_INVALID.includes(number)) continue;
    const repeat = MANY_DUPLICATES.get(number);
    if (repeat !== undefined) {
      cards.push(card(number, repeat, "(repeated)", ["a1"]));
      continue;
    }
    const i = number - 1;
    const [noun, nounEn, gender] = NOUNS[i % NOUNS.length]!;
    const [m, f, adjEn] = ADJECTIVES[Math.floor(i / NOUNS.length) % ADJECTIVES.length]!;
    const article = gender === "m" ? "el" : "la";
    cards.push(
      card(number, `${article} ${noun} ${gender === "m" ? m : f}`, `the ${adjEn} ${nounEn}`, [
        "a1",
        "noun",
        "adjective",
      ]),
    );
  }
  return cards;
}

export const MANY: ImportPreview = {
  id: "5eed0000-0000-4000-8000-0000000001a3",
  fileName: "mil-frases.json",
  source: "json",
  total: 1000,
  imageCount: 0,
  cards: manyCards(),
  invalid: MANY_INVALID.map((number) => ({
    number,
    problems: problems(`card ${number}, "tags": "tags" is missing`),
  })),
  macros: [],
  images: [],
  unticked: [],
};

/** The seeded Import's report: the mixed preview, confirmed. */
export const REPORT: ImportReport = {
  id: "5eed0000-0000-4000-8000-0000000001a1",
  fileName: "mercado-y-cafe.zip",
  source: "zip",
  confirmedAt: "2026-10-26T11:42:00.000Z",
  imported: 19,
  imageCount: 1,
  leftOut: 2,
  duplicates: [
    { number: 4, front: "la cuenta" },
    { number: 13, front: "Madrugar" },
    { number: 18, front: "el mercado" },
  ],
  invalid: PREVIEW.invalid,
  macros: PREVIEW.macros,
  images: PREVIEW.images,
};

/** A report with nothing skipped and nothing to warn of. */
export const REPORT_CLEAN: ImportReport = {
  id: "5eed0000-0000-4000-8000-0000000001a4",
  fileName: "pasted JSON",
  source: "paste",
  confirmedAt: "2026-10-26T11:58:00.000Z",
  imported: 40,
  imageCount: 0,
  leftOut: 0,
  duplicates: [],
  invalid: [],
  macros: [],
  images: [],
};

/** A pasted reply from an LLM, fenced, as `refused` shows it. */
export const FENCED_PASTE = [
  "```json",
  "{",
  '  "format": "banki-cards",',
  '  "version": 1,',
  '  "macros": [],',
  '  "cards": [',
  '    { "front": "el andén", "back": "the platform", "tags": ["a2"], "gradingNotes": null }',
  "  ]",
  "}",
  "```",
].join("\n");

/** A good paste, as `paste` shows it. */
export const GOOD_PASTE = [
  "{",
  '  "format": "banki-cards",',
  '  "version": 1,',
  '  "macros": [],',
  '  "cards": [',
  '    { "front": "la estación", "back": "the station", "tags": ["a2", "travel"], "gradingNotes": null },',
  '    { "front": "el billete", "back": "the ticket\\n¿Un billete de ida y vuelta?", "tags": ["a2", "travel"], "gradingNotes": null },',
  '    { "front": "el retraso", "back": "the delay", "tags": ["b1", "travel"], "gradingNotes": null }',
  "  ]",
  "}",
].join("\n");

export const REFUSED_PROBLEMS: readonly CardFileProblem[] = problems(
  "file: Not valid JSON: Unexpected token '`', \"```json\n{\n\"... is not valid JSON",
);

/** The kinds of file the source takes. */
export const ACCEPT = ".json,.zip,application/json,application/zip";
