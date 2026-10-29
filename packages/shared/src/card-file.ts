import { z } from "zod";
import { CARD_SIDE_MAX_LENGTH, CardSide } from "./cards";
import { CARD_TAGS_MAX, CardTags, TAG_MAX_LENGTH } from "./tags";

/** The longest a Card's grading notes may be. BAN-37 adopts the same limit. */
export const GRADING_NOTES_MAX_LENGTH = 2_000;

/** The only version of the Card file there is; Banki reads it for good. */
export const CARD_FILE_VERSION = 1;

/** Where the API serves the Card file's JSON Schema, without signing in. */
export const CARD_FILE_SCHEMA_PATH = "/api/schemas/card-file-v1.json";

/** Why a file whose `format` isn't `"banki"` is refused. */
export const NOT_A_CARD_FILE_MESSAGE =
  'This is not a Card file: one is an object whose "format" is "banki"';

/** Why a file of a version above 1 is refused. */
export const NEWER_BANKI_MESSAGE = `This Card file was made by a newer Banki: this one reads version ${CARD_FILE_VERSION}`;

/**
 * A key's error for an input that left it out, saying so rather than that
 * `undefined` is the wrong type; any other input keeps its usual message.
 */
const missing = (key: string) => (issue: { input?: unknown }) =>
  issue.input === undefined ? `"${key}" is missing` : undefined;

/** An object's error for keys it doesn't have, naming them, and for an input that isn't an object. */
const objectError =
  (what: string, notAnObject: string) => (issue: { code?: string; keys?: string[] }) =>
    issue.code === "unrecognized_keys"
      ? `${(issue.keys ?? []).map((key) => `"${key}"`).join(", ")} ${(issue.keys ?? []).length === 1 ? "is not a key" : "are not keys"} of ${what}`
      : notAnObject;

/** `\` and letters, or `\` and one other character: how a TeX command is named. */
const MACRO_NAME = /^\\(?:[A-Za-z]+|[^A-Za-z])$/u;

/** One macro the Cards' Formulas were written with: its name, and what it stands for. */
export const CardFileMacro = z
  .strictObject(
    {
      name: z
        .string({ error: missing("name") })
        .refine(
          (name) => MACRO_NAME.test(name),
          "A macro's name is \\ and letters, such as \\R, or \\ and one other character",
        )
        .describe(
          "The macro's name, with its backslash: \\ followed by letters (such as \\R or \\norm), or \\ followed by one character that isn't a letter. No name appears twice in a file.",
        ),
      definition: z
        .string({ error: missing("definition") })
        .refine((definition) => definition.trim() !== "", "Write what the macro stands for")
        .describe(
          "What the macro stands for, in KaTeX's syntax, with #1 to #9 for its arguments (such as \\left\\| #1 \\right\\|). Not blank.",
        ),
    },
    { error: objectError("a macro", "A macro is an object with a name and a definition") },
  )
  .meta({ title: "Macro", description: "A macro the Cards' Formulas were written with." });
export type CardFileMacro = z.infer<typeof CardFileMacro>;

/** One Card of a Card file: its Front and Back, its Tags and its grading notes. */
export const CardFileCard = z
  .strictObject(
    {
      front: z
        .string({ error: missing("front") })
        .pipe(CardSide)
        .describe(
          `The Card's Front: Markdown with LaTeX ($…$ inline, $$…$$ for display), not blank, up to ${CARD_SIDE_MAX_LENGTH.toLocaleString("en-GB")} characters. Kept exactly as written. An image is ![](images/<file>).`,
        ),
      back: z
        .string({ error: missing("back") })
        .pipe(CardSide)
        .describe(
          `The Card's Back, by the same rules as the front: Markdown with LaTeX, not blank, up to ${CARD_SIDE_MAX_LENGTH.toLocaleString("en-GB")} characters, kept exactly as written.`,
        ),
      tags: z
        .array(z.string(), { error: missing("tags") })
        .pipe(CardTags)
        .describe(
          `The Card's Tags, [] for none: each one word of letters, digits, - and _, up to ${TAG_MAX_LENGTH} characters, and at most ${CARD_TAGS_MAX} of them. They are lowercased, and duplicates are dropped.`,
        ),
      gradingNotes: z
        .string({ error: missing("gradingNotes") })
        .refine(
          (notes) => notes.trim() === "" || notes.length <= GRADING_NOTES_MAX_LENGTH,
          `Keep grading notes to ${GRADING_NOTES_MAX_LENGTH.toLocaleString("en-GB")} characters`,
        )
        .nullable()
        .transform((notes) => (notes === null || notes.trim() === "" ? null : notes))
        .describe(
          `Notes for grading an answer to this Card: Markdown with LaTeX up to ${GRADING_NOTES_MAX_LENGTH.toLocaleString("en-GB")} characters, or null for none. Blank counts as null.`,
        ),
    },
    {
      error: objectError(
        "a Card",
        "A Card is an object with a front, a back, tags and gradingNotes",
      ),
    },
  )
  .meta({ title: "Card", description: "One Card." });
export type CardFileCard = z.infer<typeof CardFileCard>;

/**
 * A Card file, version 1: Banki's own format for Cards and the macros their
 * Formulas use, which an import reads, an export writes and the LLM prompt
 * asks for. Every key is required, and an unknown key is refused (ADR-0023).
 * Its JSON Schema, `CARD_FILE_JSON_SCHEMA`, is generated from it.
 */
export const CardFile = z
  .strictObject(
    {
      $schema: z
        .string({ error: missing("$schema") })
        .nullable()
        .describe(
          "The URL of this JSON Schema, or null. Banki never fetches or checks it; an export writes its own.",
        ),
      format: z
        .literal("banki", {
          error: (issue) => missing("format")(issue) ?? NOT_A_CARD_FILE_MESSAGE,
        })
        .describe('Always "banki": it marks a Card file.'),
      version: z
        .literal(CARD_FILE_VERSION, {
          error: (issue) =>
            missing("version")(issue) ??
            (typeof issue.input === "number" &&
            Number.isInteger(issue.input) &&
            issue.input > CARD_FILE_VERSION
              ? NEWER_BANKI_MESSAGE
              : `"version" is ${CARD_FILE_VERSION}`),
        })
        .describe(
          `The format's version: the integer ${CARD_FILE_VERSION}. A higher one is a file made by a newer Banki.`,
        ),
      macros: z
        .array(CardFileMacro, { error: missing("macros") })
        .superRefine((macros, ctx) => {
          const seen = new Set<string>();
          for (const [index, { name }] of macros.entries()) {
            if (seen.has(name)) {
              ctx.addIssue({
                code: "custom",
                message: `${name} is defined more than once`,
                path: [index, "name"],
              });
            }
            seen.add(name);
          }
        })
        .describe(
          "The macros the Cards' Formulas were written with, [] for none. No name appears twice. A Card may use a macro that isn't listed.",
        ),
      cards: z.array(CardFileCard, { error: missing("cards") }).describe("The Cards, [] for none."),
    },
    { error: objectError("a Card file", NOT_A_CARD_FILE_MESSAGE) },
  )
  .meta({
    title: "Banki Card file, version 1",
    description:
      "Cards for Banki, a spaced-repetition app, with the macros their Formulas use. Every key is required on every object, and no other key is allowed: write none as null or [].",
  });
export type CardFile = z.infer<typeof CardFile>;

/**
 * The Card file's JSON Schema, generated from `CardFile` and shaped for every
 * provider's structured-outputs strict mode (ADR-0023): the limits `CardFile`
 * enforces are written in descriptions, not as keywords.
 */
export const CARD_FILE_JSON_SCHEMA = z.toJSONSchema(CardFile, {
  io: "input",
  // A number literal comes out as `"type": "number"`; the version is an integer.
  override: ({ zodSchema, jsonSchema }) => {
    if (zodSchema === CardFile.shape.version) jsonSchema.type = "integer";
  },
});
