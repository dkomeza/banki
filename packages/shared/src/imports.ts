import { z } from "zod";
import { CardFileCard } from "./card-file";
import { type CardFileProblem, formatProblems } from "./card-file-parser";

// An Import (CONTEXT.md, ADR-0026): the API reads a Card file into an
// unconfirmed Import, the preview shows it, and confirming it adds the ticked
// Cards and keeps its report.

/** The largest a Card file's JSON may be, pasted, a `.json`, or the one in a zip: 20 MB. */
export const IMPORT_JSON_MAX_BYTES = 20 * 1024 * 1024;

/** The largest an upload may be, and a zip's unpacked contents in total: 500 MB. */
export const IMPORT_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

/** The most entries a Card file's `cards` may hold, valid or not, for one Import. */
export const IMPORT_CARDS_MAX = 1_000;

/** How an Import's file came: a `.json`, a `.zip` with its Images, or pasted text. */
export const IMPORT_SOURCES = ["json", "zip", "paste"] as const;
export const ImportSource = z.enum(IMPORT_SOURCES);
export type ImportSource = z.infer<typeof ImportSource>;

const Problem = z.object({ text: z.string() });

/** A Card read from the file, with its 1-based number in the file's `cards`. */
export const ImportCard = z.object({
  number: z.number().int(),
  front: z.string(),
  back: z.string(),
  tags: z.array(z.string()),
  gradingNotes: z.string().nullable(),
});
export type ImportCard = z.infer<typeof ImportCard>;

/**
 * What a Card of the file is a Duplicate of, as the API read it: one of the
 * Deck's live Cards (`cardId`), or an earlier Card of the file (`number`).
 */
export const ImportDuplicateOf = z.union([
  z.object({ cardId: z.string(), front: z.string() }),
  z.object({ number: z.number().int(), front: z.string() }),
]);
export type ImportDuplicateOf = z.infer<typeof ImportDuplicateOf>;

/** A Card of the preview: as read, with what it is a Duplicate of, or null. */
export const PreviewCard = ImportCard.extend({ duplicateOf: ImportDuplicateOf.nullable() });
export type PreviewCard = z.infer<typeof PreviewCard>;

/** A Card the file has that isn't valid: its number, and every problem with it. */
export const ImportInvalidCard = z.object({ number: z.number().int(), problems: z.array(Problem) });
export type ImportInvalidCard = z.infer<typeof ImportInvalidCard>;

/**
 * What the Import does with one of the file's Macros that the Deck doesn't
 * have as it is: `added` to the Deck's own; `kept`, the Deck defining it
 * differently (`deckDefinition`), which stays; or `not_added`, the Deck
 * unable to take it (`reason`). One the Deck has with the identical
 * definition isn't listed.
 */
export const MacroPlanEntry = z.discriminatedUnion("outcome", [
  z.object({ name: z.string(), definition: z.string(), outcome: z.literal("added") }),
  z.object({
    name: z.string(),
    definition: z.string(),
    outcome: z.literal("kept"),
    deckDefinition: z.string(),
  }),
  z.object({
    name: z.string(),
    definition: z.string(),
    outcome: z.literal("not_added"),
    reason: z.string(),
  }),
]);
export type MacroPlanEntry = z.infer<typeof MacroPlanEntry>;

/** Why an image a Card refers to won't come with it. */
export const IMAGE_PROBLEMS = ["missing", "too_large", "unsupported"] as const;

/**
 * An image a Card refers to that won't come with it: the Card's number, the
 * reference as written (`images/<file>`), and what is wrong. The Card still
 * imports, its reference as written.
 */
export const ImageProblem = z.object({
  card: z.number().int(),
  reference: z.string(),
  problem: z.enum(IMAGE_PROBLEMS),
  message: z.string(),
});
export type ImageProblem = z.infer<typeof ImageProblem>;

/** What every Import's page knows of it, previewed or confirmed. */
const ImportBase = z.object({
  id: z.string(),
  deckId: z.string(),
  fileName: z.string(),
  source: ImportSource,
  /** How many entries the file's `cards` holds, valid or not. */
  total: z.number().int(),
  invalid: z.array(ImportInvalidCard),
  createdAt: z.iso.datetime(),
});

/**
 * An unconfirmed Import, as its preview reads it: every valid Card in file
 * order, marked with its Duplicate as the Deck is now, the Macro plan and the image problems as they stand against the Deck
 * now, and the files of the zip's Images the Cards refer to, served from the
 * staged Import at `GET /api/imports/:id/images/<file>`.
 */
export const ImportPreviewResponse = ImportBase.extend({
  status: z.literal("unconfirmed"),
  cards: z.array(PreviewCard),
  macros: z.array(MacroPlanEntry),
  images: z.array(ImageProblem),
  stagedImages: z.array(z.string()),
});
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponse>;

/** A Card an Import skipped as a Duplicate: its number and its Front. */
export const SkippedDuplicate = z.object({ number: z.number().int(), front: z.string() });
export type SkippedDuplicate = z.infer<typeof SkippedDuplicate>;

/** A confirmed Import: its report, kept for good. */
export const ImportReportResponse = ImportBase.extend({
  status: z.literal("confirmed"),
  confirmedAt: z.iso.datetime(),
  /** How many Cards it added. */
  imported: z.number().int(),
  /** How many valid Cards the User left out, unticked. */
  leftOut: z.number().int(),
  duplicates: z.array(SkippedDuplicate),
  macros: z.array(MacroPlanEntry),
  images: z.array(ImageProblem),
  /** How many Images it added, from the zip. */
  imageCount: z.number().int(),
});
export type ImportReportResponse = z.infer<typeof ImportReportResponse>;

/** The body of `GET /api/imports/:id`: its preview, or once confirmed, its report. */
export const ImportResponse = z.discriminatedUnion("status", [
  ImportPreviewResponse,
  ImportReportResponse,
]);
export type ImportResponse = z.infer<typeof ImportResponse>;

/** The body `POST /api/decks/:deckId/imports` answers 201: the new Import's ID. */
export const CreateImportResponse = z.object({ id: z.string() });
export type CreateImportResponse = z.infer<typeof CreateImportResponse>;

/** The body of a refused upload's 422: `import_refused`, and the file's problems. */
export const ImportRefusedResponse = z.object({
  error: z.object({ code: z.literal("import_refused"), message: z.string() }),
  problems: z.array(Problem),
});
export type ImportRefusedResponse = z.infer<typeof ImportRefusedResponse>;

/**
 * The body of `POST /api/imports/:id/confirm`: the ticked Cards, edited or
 * not, each by its number in the file, by the Card file's Card rules.
 */
export const ConfirmImportRequest = z.strictObject({
  cards: z
    .array(CardFileCard.extend({ number: z.number().int().min(1) }))
    .max(1_000)
    .refine(
      (cards) => new Set(cards.map((card) => card.number)).size === cards.length,
      "A card is sent twice",
    ),
});
export type ConfirmImportRequest = z.input<typeof ConfirmImportRequest>;

/** A sentence as it goes on after a colon: lowercased at its start. */
const reason = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** A Macro plan entry as a line, before the Import (`will`) or after it. */
export function macroPlanLine(entry: MacroPlanEntry, done = false): string {
  if (entry.outcome === "added") {
    return done
      ? `${entry.name} was added to the Deck's macros.`
      : `${entry.name} will be added to the Deck's macros.`;
  }
  if (entry.outcome === "kept") {
    return done
      ? `${entry.name} was defined differently in the Deck; the Deck's definition was kept.`
      : `${entry.name} is defined differently in this Deck; the Deck's definition is kept.`;
  }
  return done
    ? `${entry.name} wasn't added: ${reason(entry.reason)}`
    : `${entry.name} can't be added: ${reason(entry.reason)}`;
}

/** An image problem as a line, naming its Card. */
export const imageProblemLine = (image: ImageProblem) =>
  `card ${image.card}: ${image.reference}: ${image.message}`;

/**
 * Problems and warnings, one per line, for pasting back to an LLM: the
 * problems as `formatProblems` writes them, then each warning (the Macro plan,
 * then the image problems by Card).
 */
export function formatProblemsWithWarnings(
  problems: readonly CardFileProblem[],
  macros: readonly MacroPlanEntry[],
  images: readonly ImageProblem[],
  done = false,
): string {
  return [
    formatProblems(problems),
    ...macros.map((entry) => `warning: ${macroPlanLine(entry, done)}`),
    ...images.map((image) => `warning: ${imageProblemLine(image)}`),
  ]
    .filter((line) => line !== "")
    .join("\n");
}
