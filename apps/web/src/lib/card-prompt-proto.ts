import { CARD_FILE_JSON_SCHEMA, CARD_FILE_SCHEMA_PATH, type Macro } from "@banki/shared";
import { useEffect, useRef, useState } from "react";

// PROTOTYPE (BAN-35): the Card prompt's options, a stand-in for the prompt
// function `@banki/shared` will hold, and a fake save. A Variant's screens
// only; nothing here reaches the API.

export type Difficulty = "introductory" | "intermediate" | "advanced";

export type PromptOptions = {
  language: string;
  /** As typed, so an out-of-range number can be shown with its error. */
  count: string;
  difficulty: Difficulty;
  instructions: string;
};

export const LANGUAGE_MAX = 50;
export const COUNT_MAX = 1000;
export const INSTRUCTIONS_MAX = 2000;

export const DIFFICULTIES: readonly { value: Difficulty; label: string; hint: string }[] = [
  { value: "introductory", label: "Introductory", hint: "Definitions and core facts" },
  { value: "intermediate", label: "Intermediate", hint: "How the ideas connect" },
  { value: "advanced", label: "Advanced", hint: "Edge cases and derivations" },
];

export const DEFAULT_OPTIONS: PromptOptions = {
  language: "",
  count: "",
  difficulty: "intermediate",
  instructions: "",
};

const LONG_INSTRUCTIONS =
  "These are my lecture notes for Calculus 2 (series and improper integrals). Focus on the convergence tests: for each test write one card for its statement, one for when it applies and one worked example. Skip the history and the proofs of the comparison test. Use the notation from the notes, with \\norm and \\abs where they fit. Where a theorem has conditions, make the conditions part of the Back and say in the Grading notes that leaving one out is a wrong answer.";

/** The options a `?state=` starts from. */
export function optionsForState(state: string | undefined): PromptOptions {
  switch (state) {
    case "filled":
    case "save-failed":
      return {
        language: "Polish",
        count: "40",
        difficulty: "advanced",
        instructions: LONG_INSTRUCTIONS,
      };
    case "invalid":
      return {
        language: "English",
        count: "1500",
        difficulty: "intermediate",
        instructions: Array.from({ length: 5 }, () => LONG_INSTRUCTIONS)
          .join(" ")
          .slice(0, INSTRUCTIONS_MAX + 140),
      };
    default:
      return DEFAULT_OPTIONS;
  }
}

export type OptionErrors = { language?: string; count?: string; instructions?: string };

export function checkOptions(options: PromptOptions): OptionErrors {
  const errors: OptionErrors = {};
  if (options.language.length > LANGUAGE_MAX) {
    errors.language = `Up to ${LANGUAGE_MAX} characters`;
  }
  const count = options.count.trim();
  if (count !== "") {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > COUNT_MAX) {
      errors.count = "A whole number from 1 to 1,000, or blank";
    }
  }
  if (options.instructions.length > INSTRUCTIONS_MAX) {
    errors.instructions = `Up to 2,000 characters: ${(options.instructions.length - INSTRUCTIONS_MAX).toLocaleString("en-GB")} too many`;
  }
  return errors;
}

export const hasErrors = (errors: OptionErrors) => Object.keys(errors).length > 0;

export const schemaUrl = () => `${window.location.origin}${CARD_FILE_SCHEMA_PATH}`;

export const SCHEMA_TEXT = JSON.stringify(CARD_FILE_JSON_SCHEMA, null, 2);

const DIFFICULTY_SENTENCE: Record<Difficulty, string> = {
  introductory:
    "Keep the questions introductory: definitions, names and the core facts a beginner needs first.",
  intermediate:
    "Pitch the questions at an intermediate level: how the ideas connect, when each applies, and why.",
  advanced:
    "Make the questions advanced: edge cases, derivations, conditions that are easy to forget, and how results compare.",
};

const EXAMPLE = {
  $schema: "SCHEMA_URL",
  format: "banki",
  version: 1,
  macros: [],
  cards: [
    {
      front:
        "What does the ratio test say about $\\sum a_n$ when $\\lim \\abs{a_{n+1}/a_n} = L < 1$?",
      back: "The series converges absolutely.",
      tags: ["series", "convergence"],
      gradingNotes: "Must say *absolutely*; plain “converges” is incomplete.",
    },
    {
      front: "Derivative of $\\sin x$",
      back: "$$\\frac{d}{dx}\\sin x = \\cos x$$",
      tags: ["derivatives"],
      gradingNotes: null,
    },
  ],
};

/** The whole Card prompt for these options, as the page shows and copies it. */
export function buildPrompt(options: PromptOptions, macros: readonly Macro[], url: string): string {
  const count = options.count.trim();
  const parts = [
    "# Write flashcards for Banki",
    "",
    "Banki is a spaced-repetition app. Write flashcards from the material I paste after this prompt or attach, as one Card file: a JSON document described below.",
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
    "For a Card whose answer has key elements, or can be phrased in several ways, write `gradingNotes`: what an answer must include, and what it may vary in. Otherwise set it to `null`. Notes are at most 2,000 characters and are never shown while studying.",
    "",
    "## Markdown and LaTeX",
    "",
    "- Fronts, Backs and Grading notes are CommonMark, with GFM tables and strikethrough.",
    "- `$…$` for inline math, `$$…$$` for display math, `\\$` for a dollar sign.",
    "- No raw HTML and no images.",
    "- Only LaTeX that KaTeX supports: no packages, no `\\newcommand`, no TikZ.",
    "",
    "## JSON",
    "",
    "- Every key is present; write none as `null` or `[]`. No other keys.",
    "- Write every LaTeX backslash as `\\\\` and every line break as `\\n`.",
    "- Keep to the limits in the schema's descriptions.",
    `- Set \`"$schema"\` to \`${url}\`.`,
    '- Set `"macros": []`.',
  ];
  if (macros.length > 0) {
    parts.push(
      "",
      "## Macros",
      "",
      "Your Formulas may use these macros. Use them where they fit, and define no new ones.",
      "",
      ...macros.map((macro) => `- \`${macro.name}\` → \`${macro.definition}\``),
    );
  }
  parts.push(
    "",
    "## The JSON Schema",
    "",
    "```json",
    SCHEMA_TEXT,
    "```",
    "",
    "## An example Card file",
    "",
    "```json",
    JSON.stringify(EXAMPLE, null, 2).replace("SCHEMA_URL", url),
    "```",
    "",
    "## This time",
    "",
    `- Card language: ${options.language.trim() || "the language of the material"}.`,
    `- Number of cards: ${count === "" ? "as many as the material needs" : count}. Write fewer complete Cards rather than stop partway through the JSON.`,
    `- ${DIFFICULTY_SENTENCE[options.difficulty]}`,
  );
  if (options.instructions.trim() !== "") {
    parts.push("", "## Extra instructions", "", options.instructions);
  }
  parts.push(
    "",
    "## Output",
    "",
    "Reply with only the Card file, as one ```json code block, with nothing before or after it.",
  );
  return parts.join("\n");
}

export type SaveStatus = "saving" | "saved" | "failed" | undefined;

/**
 * The options as they change, saved after a moment the way Deck settings
 * are: a fake save that fails on `save-failed`, with Try again.
 */
export function usePromptOptions(state: string | undefined) {
  const [options, setOptions] = useState(() => optionsForState(state));
  const [status, setStatus] = useState<SaveStatus>(state === "save-failed" ? "failed" : undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const errors = checkOptions(options);
  // What the prompt is built from: the options as they last had no problem.
  const [valid, setValid] = useState(() =>
    hasErrors(checkOptions(optionsForState(state))) ? DEFAULT_OPTIONS : optionsForState(state),
  );

  const save = (fails: boolean) => {
    clearTimeout(timer.current);
    setStatus("saving");
    timer.current = setTimeout(() => setStatus(fails ? "failed" : "saved"), 700);
  };
  const change = (patch: Partial<PromptOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (hasErrors(checkOptions(next))) {
      clearTimeout(timer.current);
      setStatus(undefined);
      return;
    }
    setValid(next);
    save(state === "save-failed");
  };
  return { options, valid, errors, status, change, retry: () => save(false) };
}

/** Copies text, and says so for a moment; `copied` starts it saying so, for `?state=copied`. */
export function useCopy(copied: boolean) {
  const [done, setDone] = useState(copied);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    copied: done,
    copy: (text: string) => {
      void navigator.clipboard?.writeText(text).catch(() => {});
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1600);
    },
  };
}
