import { describe, expect, test } from "bun:test";
import { CARD_FILE_JSON_SCHEMA } from "./card-file";
import { parseCardFile } from "./card-file-parser";
import {
  buildCardPrompt,
  type CardPromptOptions,
  CardPromptOptions as CardPromptOptionsSchema,
  cardPromptExample,
  DEFAULT_CARD_PROMPT_OPTIONS,
} from "./card-prompt";
import type { Macro } from "./macros";

const URL = "https://banki.example.com/api/schemas/card-file-v1.json";
const MACROS: Macro[] = [
  { name: "\\R", definition: "\\mathbb{R}" },
  { name: "\\norm", definition: "\\left\\| #1 \\right\\|" },
];

const prompt = (options: Partial<CardPromptOptions> = {}, macros: readonly Macro[] = MACROS) =>
  buildCardPrompt({ ...DEFAULT_CARD_PROMPT_OPTIONS, ...options }, macros, URL);

/** The first problem `CardPromptOptions` finds in `options`, or null. */
function problem(options: Partial<Record<keyof CardPromptOptions, unknown>>): string | null {
  const parsed = CardPromptOptionsSchema.safeParse({ ...DEFAULT_CARD_PROMPT_OPTIONS, ...options });
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "?");
}

/** The ```json blocks of `text`, in order. */
const jsonBlocks = (text: string) =>
  [...text.matchAll(/^```json\n([\s\S]*?)\n```$/gm)].map((match) => match[1] ?? "");

describe("CardPromptOptions", () => {
  test("takes the defaults and every option set within its limits", () => {
    expect(problem({})).toBeNull();
    expect(
      problem({
        language: "x".repeat(50),
        count: 1000,
        difficulty: "advanced",
        instructions: "y".repeat(2000),
      }),
    ).toBeNull();
    expect(problem({ count: 1 })).toBeNull();
    expect(problem({ difficulty: "introductory" })).toBeNull();
  });

  test("refuses a language over 50 characters, after trimming", () => {
    expect(problem({ language: ` ${"x".repeat(50)} ` })).toBeNull();
    expect(problem({ language: "x".repeat(51) })).not.toBeNull();
  });

  test("refuses a number of cards that isn't a whole number from 1 to 1,000", () => {
    for (const count of [0, -1, 1001, 2.5, "40", Number.NaN]) {
      expect(problem({ count })).not.toBeNull();
    }
  });

  test("refuses another difficulty, and instructions over 2,000 characters", () => {
    expect(problem({ difficulty: "expert" })).not.toBeNull();
    expect(problem({ instructions: "y".repeat(2001) })).not.toBeNull();
  });

  test("refuses a missing option and one it doesn't know", () => {
    const { language: _, ...rest } = DEFAULT_CARD_PROMPT_OPTIONS;
    expect(CardPromptOptionsSchema.safeParse(rest).success).toBe(false);
    expect(
      CardPromptOptionsSchema.safeParse({ ...DEFAULT_CARD_PROMPT_OPTIONS, topic: "x" }).success,
    ).toBe(false);
  });

  test("trims the language and keeps the instructions as typed", () => {
    expect(
      CardPromptOptionsSchema.parse({
        ...DEFAULT_CARD_PROMPT_OPTIONS,
        language: "  Polish ",
        instructions: "  two spaces\n",
      }),
    ).toMatchObject({ language: "Polish", instructions: "  two spaces\n" });
  });
});

describe("buildCardPrompt", () => {
  test("holds the Card file's JSON Schema word for word", () => {
    expect(jsonBlocks(prompt())[0]).toBe(JSON.stringify(CARD_FILE_JSON_SCHEMA, null, 2));
  });

  test("starts with the task", () => {
    expect(prompt()).toStartWith("# Write flashcards for Banki\n");
    expect(prompt()).toContain(
      "Banki is a spaced-repetition app. Write flashcards from the material I paste after this prompt or attach to it, as one Card file",
    );
  });

  test("holds the rules of good flashcard practice", () => {
    for (const rule of [
      "One fact per Card.",
      "No yes/no Fronts.",
      "Keep Backs short.",
      'Every Front makes sense on its own: never "according to the text".',
      "Split a list into several Cards.",
      "No two Cards have the same Front.",
      "a few lowercase one-word Tags, taken from the topic",
    ]) {
      expect(prompt()).toContain(rule);
    }
  });

  test("holds the Grading notes rule", () => {
    expect(prompt()).toContain(
      "For a Card whose answer has key elements, or can be phrased in several ways, write `gradingNotes`: what an answer must include, and what it may vary in. Otherwise set it to `null`. Notes are at most 2,000 characters and are never shown while studying.",
    );
  });

  test("holds the Markdown and LaTeX rules", () => {
    for (const rule of [
      "CommonMark, with GFM tables and strikethrough",
      "`$…$` for inline math, `$$…$$` for display math, and `\\$` for a dollar sign",
      "No raw HTML and no images.",
      "Only LaTeX that KaTeX supports: no packages, no `\\newcommand`, no TikZ.",
    ]) {
      expect(prompt()).toContain(rule);
    }
  });

  test("holds the JSON and escaping rules, with the schema URL", () => {
    for (const rule of [
      "Every key is present on every object, never left out: write none as `null` or `[]`. No other keys.",
      "Write every LaTeX backslash as `\\\\`, and every line break as `\\n`.",
      "Keep to the limits in the schema's descriptions.",
      `Set \`"$schema"\` to \`"${URL}"\`.`,
      'Set `"macros": []`.',
    ]) {
      expect(prompt()).toContain(rule);
    }
  });

  test("ends with the output rule", () => {
    expect(prompt()).toEndWith(
      "## Output\n\nReply with only the Card file, as one ```json code block, with nothing before or after it.",
    );
  });

  test("keeps its sections in order", () => {
    const text = prompt({ instructions: "Be brief." });
    const at = [
      "## Good flashcards",
      "## Grading notes",
      "## Markdown and LaTeX",
      "## JSON",
      "## Macros",
      "## The JSON Schema",
      "## An example Card file",
      "## These Cards",
      "## Extra instructions",
      "## Output",
    ].map((heading) => text.indexOf(`\n${heading}\n`));
    expect(at.every((index) => index > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  test("lists the effective Macros as name → definition", () => {
    expect(prompt()).toContain(
      "## Macros\n\nFormulas may use these macros, as `name` → `definition`. Use them where they fit, and define no new ones.\n\n- `\\R` → `\\mathbb{R}`\n- `\\norm` → `\\left\\| #1 \\right\\|`\n",
    );
  });

  test("has no Macros section without Macros", () => {
    expect(prompt({}, [])).not.toContain("## Macros");
    expect(prompt({}, [])).not.toContain("define no new ones");
  });

  test("asks for the language of the material, or the language set", () => {
    expect(prompt()).toContain("- Card language: the language of the material.");
    expect(prompt({ language: "Polish" })).toContain("- Card language: Polish.");
    expect(prompt({ language: "Polish" })).not.toContain("the language of the material");
  });

  test("asks for as many cards as the material needs, or the number set, and complete Cards", () => {
    const complete = "Write fewer complete Cards rather than stop partway through the JSON.";
    expect(prompt()).toContain(`- Number of cards: as many as the material needs. ${complete}`);
    expect(prompt({ count: 40 })).toContain(`- Number of cards: 40. ${complete}`);
    expect(prompt({ count: 1000 })).toContain("- Number of cards: 1,000.");
  });

  test("says how deep the questions go, one sentence per difficulty", () => {
    // The line after the number of cards.
    const sentences = (["introductory", "intermediate", "advanced"] as const).map((difficulty) => {
      const lines = prompt({ difficulty }).split("\n");
      return lines[lines.findIndex((line) => line.startsWith("- Number of cards:")) + 1];
    });
    expect(sentences[0]).toContain("introductory");
    expect(sentences[1]).toContain("intermediate");
    expect(sentences[2]).toContain("advanced");
    expect(new Set(sentences).size).toBe(3);
  });

  test("holds the extra instructions word for word, and leaves them out when blank", () => {
    const instructions =
      "  Focus on the convergence tests.\n\nUse \\norm where it fits; skip `history`.  ";
    expect(prompt({ instructions })).toContain(`## Extra instructions\n\n${instructions}\n`);
    expect(prompt()).not.toContain("## Extra instructions");
    expect(prompt({ instructions: " \n " })).not.toContain("## Extra instructions");
  });

  test("holds the example Card file, with the schema URL", () => {
    expect(JSON.parse(jsonBlocks(prompt())[1] ?? "")).toEqual(cardPromptExample(URL));
  });
});

describe("the example Card file", () => {
  test("has Formulas and Tags, one Card with Grading notes and one without", () => {
    const { cards, macros } = cardPromptExample(URL);
    expect(macros).toEqual([]);
    expect(cards.every((card) => card.tags.length > 0)).toBe(true);
    expect(cards.some((card) => `${card.front}${card.back}`.includes("$$"))).toBe(true);
    expect(cards.some((card) => /\$[^$]+\$/.test(card.front))).toBe(true);
    expect(cards.filter((card) => card.gradingNotes === null)).toHaveLength(1);
    expect(cards.filter((card) => card.gradingNotes !== null)).toHaveLength(1);
  });

  test("parseCardFile reads the prompt's example with no invalid Cards", () => {
    const example = jsonBlocks(prompt())[1] ?? "";
    const parsed = parseCardFile(example);
    if ("problems" in parsed) throw new Error(JSON.stringify(parsed.problems));
    expect(parsed.invalid).toEqual([]);
    expect(parsed.cards).toHaveLength(cardPromptExample(URL).cards.length);
  });
});
