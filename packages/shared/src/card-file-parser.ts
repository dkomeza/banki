import { z } from "zod";
import { CardFileCard, CardFileEnvelope, type CardFileMacro } from "./card-file";

/** One thing wrong with a Card file, as a line to show or paste back to an LLM. */
export type CardFileProblem = {
  /** `<location>: <message>`, such as `card 14, "back": "back" is missing`. */
  text: string;
};

/** A Card read from a Card file, with its 1-based position in the file's `cards`. */
export type NumberedCard = CardFileCard & { number: number };

/** A Card skipped as invalid: its 1-based position, and every problem with it. */
export type InvalidCard = { number: number; problems: CardFileProblem[] };

/**
 * What `parseCardFile` makes of a Card file: read, with its macros, the Cards
 * that are valid and the ones skipped as invalid; or refused as a whole, with
 * the problems in the file itself.
 */
export type ParsedCardFile =
  | { macros: CardFileMacro[]; cards: NumberedCard[]; invalid: InvalidCard[] }
  | { problems: CardFileProblem[] };

/** `"key"` and ` #i` for a key and a 1-based position in its list, as a problem's location names them. */
function located(where: string, path: readonly PropertyKey[]): string {
  const [key, index] = path;
  if (typeof key !== "string") return where;
  return `${where}, ${JSON.stringify(key)}${typeof index === "number" ? ` #${index + 1}` : ""}`;
}

const problem = (location: string, message: string): CardFileProblem => ({
  text: `${location}: ${message}`,
});

/** The problems of one Card, the `number`th, at `entry`: one per issue, in field order. */
function cardProblems(number: number, entry: unknown, error: z.ZodError): CardFileProblem[] {
  return error.issues.map((issue) => {
    const location = located(`card ${number}`, issue.path);
    const [key, index] = issue.path;
    // A tag problem quotes the bad tag, so it can be found in a long list.
    const tags = typeof entry === "object" && entry !== null && "tags" in entry && entry.tags;
    if (key === "tags" && typeof index === "number" && Array.isArray(tags)) {
      return problem(location, `${JSON.stringify(tags[index])}: ${issue.message}`);
    }
    return problem(location, issue.message);
  });
}

/** A problem with the file itself: at the top, on a key of it, or on a macro. */
function fileProblem(issue: z.core.$ZodIssue): CardFileProblem {
  const [key, index, ...rest] = issue.path;
  if (key === "macros" && typeof index === "number") {
    return problem(located(`macro ${index + 1}`, rest), issue.message);
  }
  return problem(located("file", issue.path), issue.message);
}

/**
 * Reads the text of a Card file into the Cards an import can use. Parsing is
 * strict: the text goes through `JSON.parse` and nothing else, so a code fence,
 * a BOM or a trailing comma refuses it. Anything wrong with the file itself
 * (not JSON, the wrong `format` or `version`, a missing or unknown top-level
 * key, an invalid macro) refuses the whole file, and its Cards aren't checked.
 * Otherwise every valid Card is kept, as `CardFileCard` parses it, and every
 * invalid one is skipped and listed with all its problems.
 */
export function parseCardFile(text: string): ParsedCardFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      problems: [
        problem(
          "file",
          `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }

  const file = CardFileEnvelope.safeParse(json);
  if (!file.success) return { problems: file.error.issues.map(fileProblem) };

  const cards: NumberedCard[] = [];
  const invalid: InvalidCard[] = [];
  for (const [index, entry] of file.data.cards.entries()) {
    const number = index + 1;
    const card = CardFileCard.safeParse(entry);
    if (card.success) cards.push({ number, ...card.data });
    else invalid.push({ number, problems: cardProblems(number, entry, card.error) });
  }
  return { macros: file.data.macros, cards, invalid };
}

/** Problems one per line, for showing them or pasting them back to an LLM. */
export const formatProblems = (problems: readonly CardFileProblem[]): string =>
  problems.map(({ text }) => text).join("\n");
