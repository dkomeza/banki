import {
  type CardFileMacro,
  type CardFileProblem,
  IMAGE_FORMAT_MESSAGE,
  IMAGE_MAX_BYTES,
  IMPORT_CARDS_MAX,
  IMPORT_JSON_MAX_BYTES,
  IMPORT_UPLOAD_MAX_BYTES,
  type ImageProblem,
  type ImportInvalidCard,
  type ImportSource,
  MACRO_DEFINITION_MAX_LENGTH,
  MACROS_MAX,
  type Macro,
  type MacroPlanEntry,
  type NumberedCard,
  frontKey,
  imageFormatOf,
  imageReferencesIn,
  imageTooLargeMessage,
  parseCardFile,
} from "@banki/shared";
import { ZipError, looksLikeZip, zipEntries, zipEntryBytes } from "./zip";

// Reading an Import's file (ADR-0026): the upload as it came, a `.json`, a
// `.zip` with its Images, or pasted text, into the Cards, invalid Cards and
// Macros `parseCardFile` reads, and the zip's images the Cards refer to; then
// what the Import would do with them in a Deck as it is: its Macro plan, its
// image problems and its Duplicates. Nothing here touches the database.

/** A zip's image a Card refers to: its bytes to stage, or why it can't come. */
export type ZipImage =
  | { status: "ok"; bytes: Uint8Array }
  | { status: "too_large"; message: string }
  | { status: "unsupported"; message: string };

/** A file read, before it meets a Deck. */
export type ReadFile = {
  source: ImportSource;
  /** How many entries its `cards` holds, valid or not. */
  total: number;
  cards: NumberedCard[];
  invalid: ImportInvalidCard[];
  macros: CardFileMacro[];
  /** The zip's images a Card refers to, by their file name in `images/`; empty for a `.json` or a paste. */
  images: Map<string, ZipImage>;
};

/** A file refused as a whole, with its problems. */
export type Refused = { problems: CardFileProblem[] };

const problem = (message: string): CardFileProblem => ({ text: `file: ${message}` });

/** "20.0 MB"-style, rounded up so a size over a limit never reads as it. */
const megabytes = (bytes: number) =>
  `${(Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;

/** The refusal of an upload of `bytes`, over 500 MB. */
export const uploadTooLarge = (bytes: number): Refused => ({
  problems: [
    problem(
      `The upload is ${megabytes(bytes)}, and an import can be up to ${megabytes(IMPORT_UPLOAD_MAX_BYTES)}`,
    ),
  ],
});

const jsonTooLarge = (bytes: number): Refused => ({
  problems: [
    problem(
      `The Card file is ${megabytes(bytes)}, and one can be up to ${megabytes(IMPORT_JSON_MAX_BYTES)}`,
    ),
  ],
});

/** Text as it is, a BOM kept, so `parseCardFile` refuses one as it would in a paste. */
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

/** Whether a zip path is one to ignore: under `__MACOSX/`, or a dotfile, or in a dot-folder. */
const ignored = (path: string) =>
  path.split("/").some((part) => part === "__MACOSX" || part.startsWith("."));

/** The file names a Card's three fields refer to as Images, `images/<file>`. */
export const referencedFiles = (card: {
  front: string;
  back: string;
  gradingNotes: string | null;
}): string[] =>
  [card.front, card.back, card.gradingNotes ?? ""].flatMap((text) =>
    imageReferencesIn(text).map((reference) => reference.file),
  );

/** The text of a Card file into what `parseCardFile` reads, or refused, over 1,000 Cards too. */
function readText(text: string, source: ImportSource): Omit<ReadFile, "images"> | Refused {
  const parsed = parseCardFile(text);
  if ("problems" in parsed) return parsed;
  const total = parsed.cards.length + parsed.invalid.length;
  if (total > IMPORT_CARDS_MAX) {
    return {
      problems: [
        problem(
          `"cards" holds ${total.toLocaleString("en-GB")} cards, and an import can take up to ${IMPORT_CARDS_MAX.toLocaleString("en-GB")}: split the file`,
        ),
      ],
    };
  }
  return { source, total, cards: parsed.cards, invalid: parsed.invalid, macros: parsed.macros };
}

/**
 * Reads an upload: `paste` for pasted text, `file` for a chosen or dropped
 * file, which is a zip when its bytes start as one and a `.json` otherwise.
 * Refused, with its problems, when it is over the limits, isn't a Card file,
 * or is a zip with no `.json` or several.
 */
export function readUpload(bytes: Uint8Array, kind: "paste" | "file"): ReadFile | Refused {
  if (bytes.length > IMPORT_UPLOAD_MAX_BYTES) return uploadTooLarge(bytes.length);
  if (kind === "file" && looksLikeZip(bytes)) return readZip(bytes);
  if (bytes.length > IMPORT_JSON_MAX_BYTES) return jsonTooLarge(bytes.length);
  const read = readText(decode(bytes), kind === "paste" ? "paste" : "json");
  return "problems" in read ? read : { ...read, images: new Map() };
}

function readZip(bytes: Uint8Array): ReadFile | Refused {
  try {
    const entries = zipEntries(bytes);
    const unpacked = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (unpacked > IMPORT_UPLOAD_MAX_BYTES) {
      return {
        problems: [
          problem(
            `The zip unpacks to ${megabytes(unpacked)}, and an import can be up to ${megabytes(IMPORT_UPLOAD_MAX_BYTES)}`,
          ),
        ],
      };
    }
    // Some Windows tools write \ between folders, where the format says /.
    const kept = entries
      .map((entry) => ({ ...entry, name: entry.name.replaceAll("\\", "/") }))
      .filter((entry) => !ignored(entry.name));
    const json = kept.filter((entry) => entry.name.toLowerCase().endsWith(".json"));
    if (json.length === 0) return { problems: [problem("The zip holds no .json Card file")] };
    if (json.length > 1) {
      return {
        problems: [
          problem(
            `The zip holds ${json.length} .json files, and an import reads one: ${json.map((entry) => entry.name).join(", ")}`,
          ),
        ],
      };
    }
    const [file] = json;
    if (file === undefined) return { problems: [problem("The zip holds no .json Card file")] };
    if (file.size > IMPORT_JSON_MAX_BYTES) return jsonTooLarge(file.size);
    const read = readText(decode(zipEntryBytes(bytes, file)), "zip");
    if ("problems" in read) return read;

    // `images/<file>` resolves against an `images/` folder beside the `.json`.
    const folder = `${file.name.slice(0, file.name.lastIndexOf("/") + 1)}images/`;
    const byFile = new Map(
      kept
        .filter(
          (entry) =>
            entry.name.startsWith(folder) && !entry.name.slice(folder.length).includes("/"),
        )
        .map((entry) => [entry.name.slice(folder.length), entry]),
    );
    const images = new Map<string, ZipImage>();
    for (const name of new Set(read.cards.flatMap(referencedFiles))) {
      const entry = byFile.get(name);
      if (entry === undefined || images.has(name)) continue;
      if (entry.size > IMAGE_MAX_BYTES) {
        images.set(name, { status: "too_large", message: imageTooLargeMessage(entry.size) });
        continue;
      }
      const image = zipEntryBytes(bytes, entry);
      images.set(
        name,
        imageFormatOf(image) === undefined
          ? { status: "unsupported", message: IMAGE_FORMAT_MESSAGE }
          : { status: "ok", bytes: image },
      );
    }
    return { ...read, images };
  } catch (error) {
    if (error instanceof ZipError) return { problems: [problem(error.message)] };
    throw error;
  }
}

/**
 * The Macro plan of a file's Macros for a Deck with `own` Macros, in the
 * file's order, against its own alone and never Settings': one its own has
 * with the identical definition is left out; one its own lacks is added to
 * them, unless that would take them past 100 or the definition is over 1,000
 * characters; one its own defines differently keeps the Deck's. So a file
 * Macro that only Settings has, however defined, is added, and a Deck's
 * override of a Settings Macro survives an export and re-import.
 */
export function planMacros(
  file: readonly CardFileMacro[],
  own: readonly Macro[],
): MacroPlanEntry[] {
  const mine = new Map(own.map((macro) => [macro.name, macro]));
  let room = MACROS_MAX - own.length;
  const plan: MacroPlanEntry[] = [];
  for (const { name, definition } of file) {
    const has = mine.get(name);
    if (has !== undefined) {
      if (has.definition !== definition) {
        plan.push({ name, definition, outcome: "kept", deckDefinition: has.definition });
      }
      continue;
    }
    if (definition.length > MACRO_DEFINITION_MAX_LENGTH) {
      plan.push({
        name,
        definition,
        outcome: "not_added",
        reason: `Its definition is over ${MACRO_DEFINITION_MAX_LENGTH.toLocaleString("en-GB")} characters.`,
      });
    } else if (room <= 0) {
      plan.push({
        name,
        definition,
        outcome: "not_added",
        reason: `The Deck already has ${MACROS_MAX} macros of its own.`,
      });
    } else {
      plan.push({ name, definition, outcome: "added" });
      room -= 1;
    }
  }
  return plan;
}

/** What a zip's image is to an Import: staged and coming, or a problem. */
export type ImageStatus = "staged" | { problem: "too_large" | "unsupported"; message: string };

/**
 * The image problems of `cards`, each Card's in the order it refers to them:
 * a reference to an image the zip doesn't hold (`zipped` false for a `.json`
 * or a paste), one over 5 MB, or one that isn't a PNG, JPEG, WebP or GIF. A
 * reference to an Image of the User's (`hasImage`) is fine when the zip
 * doesn't hold it.
 */
export function imageProblems(
  cards: readonly NumberedCard[],
  images: ReadonlyMap<string, ImageStatus>,
  zipped: boolean,
  hasImage: (file: string) => boolean,
): ImageProblem[] {
  const problems: ImageProblem[] = [];
  for (const card of cards) {
    for (const file of new Set(referencedFiles(card))) {
      const reference = `images/${file}`;
      const status = images.get(file);
      if (status === "staged") continue;
      if (status !== undefined) {
        problems.push({ card: card.number, reference, ...status });
      } else if (!hasImage(file)) {
        problems.push({
          card: card.number,
          reference,
          problem: "missing",
          message: zipped
            ? `The zip has no ${reference}.`
            : "No such image: only a .zip brings images with it.",
        });
      }
    }
  }
  return problems;
}

/** What a Card is a Duplicate of: one of the Deck's live Cards, or an earlier Card of the file. */
export type DuplicateOf = { cardId: string; front: string } | { number: number; front: string };

/**
 * Each Card's Duplicate, by `frontKey`, against the Deck's live Cards and the
 * file's earlier Cards that aren't Duplicates themselves (the first one wins);
 * null for one that is none. In `cards`' order.
 */
export function duplicatesOf(
  cards: readonly NumberedCard[],
  deckCards: readonly { id: string; front: string }[],
): (DuplicateOf | null)[] {
  const inDeck = new Map<string, { id: string; front: string }>();
  for (const card of deckCards) {
    const key = frontKey(card.front);
    if (key !== "" && !inDeck.has(key)) inDeck.set(key, card);
  }
  const seen = new Map<string, NumberedCard>();
  return cards.map((card) => {
    const key = frontKey(card.front);
    if (key === "") return null;
    const deck = inDeck.get(key);
    if (deck !== undefined) return { cardId: deck.id, front: deck.front };
    const earlier = seen.get(key);
    if (earlier !== undefined) return { number: earlier.number, front: earlier.front };
    seen.set(key, card);
    return null;
  });
}
