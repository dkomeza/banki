import { z } from "zod";
import { CARD_FILE_JSON_SCHEMA, type CardFile } from "./card-file";
import { GRADING_NOTES_MAX_LENGTH } from "./cards";
import { IMPORT_CARDS_MAX } from "./imports";
import type { Macro } from "./macros";

// The Card prompt (CONTEXT.md): what the User copies into any LLM, with their
// material, so it writes one Card file to import. Built in the browser from a
// Deck's options for it, its effective Macros and the installation's schema URL.

/** How deep the Card prompt's questions go. */
export const CARD_PROMPT_DIFFICULTIES = ["introductory", "intermediate", "advanced"] as const;
export const CardPromptDifficulty = z.enum(CARD_PROMPT_DIFFICULTIES);
export type CardPromptDifficulty = z.infer<typeof CardPromptDifficulty>;

/** The longest card language, after trimming. */
export const CARD_PROMPT_LANGUAGE_MAX_LENGTH = 50;

/** The most cards the Card prompt asks for: as many as one import takes. */
export const CARD_PROMPT_COUNT_MAX = IMPORT_CARDS_MAX;

/** The longest extra instructions. */
export const CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH = 2000;

/**
 * A Deck's options for the Card prompt. `language` is trimmed, "" for the
 * language of the material. `count` is a whole number from 1 to 1,000, or
 * null for as many as the material needs. `instructions` are kept exactly as
 * typed, "" for none.
 */
export const CardPromptOptions = z.strictObject({
  language: z
    .string()
    .trim()
    .max(
      CARD_PROMPT_LANGUAGE_MAX_LENGTH,
      `Keep the language to ${CARD_PROMPT_LANGUAGE_MAX_LENGTH} characters`,
    ),
  count: z
    .number()
    .int("A whole number of cards")
    .min(1, "At least 1 card")
    .max(CARD_PROMPT_COUNT_MAX, `At most ${CARD_PROMPT_COUNT_MAX.toLocaleString("en-GB")} cards`)
    .nullable(),
  difficulty: CardPromptDifficulty,
  instructions: z
    .string()
    .max(
      CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH,
      `Keep the instructions to ${CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-GB")} characters`,
    ),
});
export type CardPromptOptions = z.infer<typeof CardPromptOptions>;

/** The options of a Deck that has never set them, a new one too. */
export const DEFAULT_CARD_PROMPT_OPTIONS: CardPromptOptions = {
  language: "",
  count: null,
  difficulty: "intermediate",
  instructions: "",
};

/** The one sentence each difficulty adds to the prompt. */
const DIFFICULTY_SENTENCES = {
  introductory:
    "Keep the questions introductory: definitions, names and the core facts a beginner needs first.",
  intermediate:
    "Pitch the questions at an intermediate level: how the ideas connect, when each one applies, and why.",
  advanced:
    "Make the questions advanced: edge cases, derivations, conditions that are easy to forget, and how results compare.",
} as const satisfies Record<CardPromptDifficulty, string>;

/** Where the example's `$schema` goes, until the schema URL replaces it. */
const SCHEMA_URL = "<schema-url>";

/**
 * The prompt's example Card file, with Formulas and Tags, one Card with
 * Grading notes and one without. `parseCardFile` reads it with no invalid
 * Cards, which a test checks.
 */
export const cardPromptExample = (schemaUrl: string): CardFile => ({
  $schema: schemaUrl,
  format: "banki",
  version: 1,
  macros: [],
  cards: [
    {
      front:
        "What does the ratio test say about $\\sum a_n$ when $\\lim_{n \\to \\infty} \\left| \\frac{a_{n+1}}{a_n} \\right| = L < 1$?",
      back: "The series converges **absolutely**.",
      tags: ["series", "convergence"],
      gradingNotes:
        "Must say the series converges absolutely; plain “converges” is incomplete. Any wording of that is fine.",
    },
    {
      front: "What is the derivative of $\\sin x$?",
      back: "$$\\frac{d}{dx} \\sin x = \\cos x$$",
      tags: ["derivatives"],
      gradingNotes: null,
    },
  ],
});

/**
 * The Card prompt for a Deck's `options`, its effective `macros` and the
 * installation's absolute `schemaUrl`: the task, good flashcard practice,
 * the Grading notes, Markdown, LaTeX and JSON rules, the Macros (left out
 * when there are none), the JSON Schema word for word, an example Card file,
 * the options and the output rule, in that order. In English, whatever the
 * card language.
 */
export function buildCardPrompt(
  options: CardPromptOptions,
  macros: readonly Macro[],
  schemaUrl: string,
): string {
  const language = options.language.trim();
  const lines = [
    "# Write flashcards for Banki",
    "",
    "Banki is a spaced-repetition app. Write flashcards from the material I paste after this prompt or attach to it, as one Card file: the JSON document described below.",
    "",
    "## Good flashcards",
    "",
    "- One fact per Card.",
    "- No yes/no Fronts.",
    "- Keep Backs short.",
    '- Every Front makes sense on its own: never "according to the text".',
    "- Split a list into several Cards.",
    "- No two Cards have the same Front.",
    "- Give each Card a few lowercase one-word Tags, taken from the topic.",
    "",
    "## Grading notes",
    "",
    `For a Card whose answer has key elements, or can be phrased in several ways, write \`gradingNotes\`: what an answer must include, and what it may vary in. Otherwise set it to \`null\`. Notes are at most ${GRADING_NOTES_MAX_LENGTH.toLocaleString("en-GB")} characters and are never shown while studying.`,
    "",
    "## Markdown and LaTeX",
    "",
    "- Fronts, Backs and Grading notes are CommonMark, with GFM tables and strikethrough.",
    "- `$…$` for inline math, `$$…$$` for display math, and `\\$` for a dollar sign.",
    "- No raw HTML and no images.",
    "- Only LaTeX that KaTeX supports: no packages, no `\\newcommand`, no TikZ.",
    "",
    "## JSON",
    "",
    "- Every key is present on every object, never left out: write none as `null` or `[]`. No other keys.",
    "- Write every LaTeX backslash as `\\\\`, and every line break as `\\n`.",
    "- Keep to the limits in the schema's descriptions.",
    `- Set \`"$schema"\` to \`"${schemaUrl}"\`.`,
    '- Set `"macros": []`.',
  ];
  if (macros.length > 0) {
    lines.push(
      "",
      "## Macros",
      "",
      "Formulas may use these macros, as `name` → `definition`. Use them where they fit, and define no new ones.",
      "",
      ...macros.map(({ name, definition }) => `- \`${name}\` → \`${definition}\``),
    );
  }
  lines.push(
    "",
    "## The JSON Schema",
    "",
    "```json",
    JSON.stringify(CARD_FILE_JSON_SCHEMA, null, 2),
    "```",
    "",
    "## An example Card file",
    "",
    "```json",
    JSON.stringify(cardPromptExample(SCHEMA_URL), null, 2).replace(SCHEMA_URL, schemaUrl),
    "```",
    "",
    "## These Cards",
    "",
    `- Card language: ${language === "" ? "the language of the material" : language}.`,
    `- Number of cards: ${options.count === null ? "as many as the material needs" : options.count.toLocaleString("en-GB")}. Write fewer complete Cards rather than stop partway through the JSON.`,
    `- ${DIFFICULTY_SENTENCES[options.difficulty]}`,
  );
  if (options.instructions.trim() !== "") {
    lines.push("", "## Extra instructions", "", options.instructions);
  }
  lines.push(
    "",
    "## Output",
    "",
    "Reply with only the Card file, as one ```json code block, with nothing before or after it.",
  );
  return lines.join("\n");
}
