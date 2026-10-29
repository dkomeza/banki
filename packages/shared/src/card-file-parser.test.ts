import { describe, expect, test } from "bun:test";
import { CardFile, NEWER_BANKI_MESSAGE, NOT_A_CARD_FILE_MESSAGE } from "./card-file";
import { type CardFileProblem, formatProblems, parseCardFile } from "./card-file-parser";

/** BAN-30's example Card file. */
const EXAMPLE: CardFile = {
  $schema: "https://banki.example.com/api/schemas/card-file-v1.json",
  format: "banki",
  version: 1,
  macros: [
    { name: "\\R", definition: "\\mathbb{R}" },
    { name: "\\norm", definition: "\\left\\| #1 \\right\\|" },
  ],
  cards: [
    {
      front: "What is $\\nabla \\cdot E$?",
      back: "$\\rho / \\varepsilon_0$",
      tags: ["maxwell"],
      gradingNotes: null,
    },
  ],
};

const CARD = EXAMPLE.cards[0]!;

/** A Card like the example's, with `front` and any of its keys changed by `changes`. */
const card = (front: string, changes: Record<string, unknown> = {}) => ({
  ...CARD,
  front,
  ...changes,
});

/** `object` without `key`. */
const without = (object: object, key: string) =>
  Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));

/** The text of a Card file of `file`. */
const text = (file: unknown) => JSON.stringify(file, null, 2);

/** What `parseCardFile` reads from `file`, failing when it is refused. */
function read(file: unknown) {
  const result = parseCardFile(typeof file === "string" ? file : text(file));
  if ("problems" in result)
    throw new Error(`Expected it read, got ${formatProblems(result.problems)}`);
  return result;
}

/** The problem lines `parseCardFile` refuses `file` with, failing when it is read. */
function refused(file: unknown): string[] {
  const result = parseCardFile(typeof file === "string" ? file : text(file));
  if (!("problems" in result)) throw new Error("Expected the Card file to be refused");
  return result.problems.map((problem) => problem.text);
}

/** The problem lines of each invalid Card of `file`, by number. */
function invalidOf(file: unknown): Array<[number, string[]]> {
  return read(file).invalid.map(({ number, problems }) => [number, problems.map((p) => p.text)]);
}

/** The example with these macros. */
const withMacros = (macros: unknown[]) => ({ ...EXAMPLE, macros });

/** The example with these Cards. */
const withCards = (cards: unknown[]) => ({ ...EXAMPLE, cards });

describe("parseCardFile reads", () => {
  test("the example, numbering its Cards, with its macros and nothing invalid", () => {
    expect(read(EXAMPLE)).toEqual({
      macros: EXAMPLE.macros,
      cards: [{ number: 1, ...CARD }],
      invalid: [],
    });
  });

  test("a null $schema, no macros and no Cards", () => {
    expect(read({ $schema: null, format: "banki", version: 1, macros: [], cards: [] })).toEqual({
      macros: [],
      cards: [],
      invalid: [],
    });
  });

  test("Cards as CardFileCard parses them: Tags sorted and deduped, blank notes null, sides untouched", () => {
    const front = "  Leading *and* trailing  \n";
    const { cards } = read(
      withCards([card(front, { tags: ["Maxwell", "EM", "em"], gradingNotes: " \n" })]),
    );
    expect(cards).toEqual([
      { number: 1, front, back: CARD.back, tags: ["em", "maxwell"], gradingNotes: null },
    ]);
  });

  test("what CardFile reads, for a file it accepts", () => {
    const file = withCards([card("a", { tags: ["B", "a"] }), card("b", { gradingNotes: "x" })]);
    const { macros, cards } = read(file);
    const parsed = CardFile.parse(file);
    expect(macros).toEqual(parsed.macros);
    expect(cards.map((numbered) => without(numbered, "number"))).toEqual(parsed.cards);
  });
});

describe("parseCardFile refuses, repairing nothing,", () => {
  test.each(["", "{", '{ "format": "banki", }', "banki"])("the text %p as not JSON", (input) => {
    const problems = refused(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith("file: Not valid JSON: ");
  });

  test("with the engine's own message", () => {
    let message = "";
    try {
      JSON.parse("{");
    } catch (error) {
      if (error instanceof Error) message = error.message;
    }
    expect(refused("{")).toEqual([`file: Not valid JSON: ${message}`]);
  });

  test("JSON in a code fence", () => {
    expect(refused(`\`\`\`json\n${text(EXAMPLE)}\n\`\`\``)[0]).toStartWith(
      "file: Not valid JSON: ",
    );
  });

  test("JSON after a byte order mark", () => {
    expect(refused(`﻿${text(EXAMPLE)}`)[0]).toStartWith("file: Not valid JSON: ");
  });

  test.each(["[]", '"banki"', "null", "1"])("the JSON value %s as not a Card file", (value) => {
    expect(refused(value)).toEqual([`file: ${NOT_A_CARD_FILE_MESSAGE}`]);
  });

  test("a format other than banki", () => {
    expect(refused({ ...EXAMPLE, format: "anki" })).toEqual([
      `file, "format": ${NOT_A_CARD_FILE_MESSAGE}`,
    ]);
  });

  test("version 2 as made by a newer Banki", () => {
    expect(refused({ ...EXAMPLE, version: 2 })).toEqual([
      `file, "version": ${NEWER_BANKI_MESSAGE}`,
    ]);
    expect(refused({ ...EXAMPLE, version: 2 })).toEqual([
      'file, "version": This Card file was made by a newer Banki: this one reads version 1',
    ]);
  });

  test.each(["$schema", "format", "version", "macros", "cards"])("a file without %s", (key) => {
    expect(refused(without(EXAMPLE, key))).toEqual([`file, "${key}": "${key}" is missing`]);
  });

  test("an unknown top-level key, naming it", () => {
    expect(refused({ ...EXAMPLE, deck: "Physics" })).toEqual([
      'file: "deck" is not a key of a Card file',
    ]);
  });

  test.each(["macros", "cards"])("%s that isn't a list", (key) => {
    expect(refused({ ...EXAMPLE, [key]: {} })).toEqual([`file, "${key}": "${key}" is a list`]);
  });

  test("a $schema that isn't text or null", () => {
    expect(refused({ ...EXAMPLE, $schema: 1 })).toEqual([
      'file, "$schema": "$schema" is a URL or null',
    ]);
  });

  test("only for the file's own problems, without checking its Cards", () => {
    expect(refused({ ...EXAMPLE, version: 2, cards: [{}, card("")] })).toEqual([
      `file, "version": ${NEWER_BANKI_MESSAGE}`,
    ]);
  });
});

describe("parseCardFile refuses a file with an invalid macro", () => {
  test.each([
    [
      { name: "R", definition: "x" },
      'macro 1, "name": A macro\'s name is \\ and letters, such as \\R, or \\ and one other character',
    ],
    [{ name: "\\R", definition: " " }, 'macro 1, "definition": Write what the macro stands for'],
    [{ name: "\\R" }, 'macro 1, "definition": "definition" is missing'],
    [{ name: "\\R", definition: "x", args: 0 }, 'macro 1: "args" is not a key of a macro'],
    ["\\R", "macro 1: A macro is an object with a name and a definition"],
  ])("%p", (macro, problem) => {
    expect(refused(withMacros([macro]))).toEqual([problem]);
  });

  test("defined twice, at the repeat", () => {
    const macros = [
      { name: "\\R", definition: "\\mathbb{R}" },
      { name: "\\C", definition: "\\mathbb{C}" },
      { name: "\\R", definition: "\\mathbf{R}" },
    ];
    expect(refused(withMacros(macros))).toEqual(['macro 3, "name": \\R is defined more than once']);
  });

  test("as a whole, valid Cards and all", () => {
    const result = parseCardFile(
      text({ ...withMacros([{ name: "R", definition: "x" }]), cards: [CARD, CARD] }),
    );
    expect(result).not.toHaveProperty("cards");
    expect(result).toHaveProperty("problems");
  });
});

describe("parseCardFile skips an invalid Card", () => {
  test("and keeps the others with their numbers", () => {
    const result = read(withCards([card("one"), without(card("two"), "back"), card("three")]));
    expect(result.cards.map(({ number, front }) => [number, front])).toEqual([
      [1, "one"],
      [3, "three"],
    ]);
    expect(result.invalid).toEqual([
      { number: 2, problems: [{ text: 'card 2, "back": "back" is missing' }] },
    ]);
  });

  test.each([
    [card(" \n"), 'card 1, "front": Write something on this side'],
    [card("a", { back: "a".repeat(20_001) }), 'card 1, "back": Keep it to 20,000 characters'],
    [card("a", { id: "x" }), 'card 1: "id" is not a key of a Card'],
    [without(card("a"), "tags"), 'card 1, "tags": "tags" is missing'],
    [without(card("a"), "gradingNotes"), 'card 1, "gradingNotes": "gradingNotes" is missing'],
    [
      card("a", { tags: ["ok", "Foo Bar"] }),
      'card 1, "tags" #2: "Foo Bar": A tag is one word: letters, digits, - and _.',
    ],
    [
      card("a", { tags: ["a".repeat(51)] }),
      `card 1, "tags" #1: "${"a".repeat(51)}": Keep a tag to 50 characters.`,
    ],
    [card("a", { tags: ["ok", 5] }), 'card 1, "tags" #2: 5: A tag is text'],
    [
      card("a", { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }),
      'card 1, "tags": A card carries up to 20 tags',
    ],
    [card("a", { tags: "maxwell" }), 'card 1, "tags": "tags" is a list'],
    [
      card("a", { gradingNotes: "a".repeat(2_001) }),
      'card 1, "gradingNotes": Keep grading notes to 2,000 characters',
    ],
    [card("a", { gradingNotes: 5 }), 'card 1, "gradingNotes": "gradingNotes" is text or null'],
    [card("a", { front: 5 }), 'card 1, "front": "front" is text'],
    ["What is 2 + 2?", "card 1: A Card is an object with a front, a back, tags and gradingNotes"],
    [null, "card 1: A Card is an object with a front, a back, tags and gradingNotes"],
  ])("%p", (entry, problem) => {
    expect(invalidOf(withCards([entry]))).toEqual([[1, [problem]]]);
  });

  test("with a side of 20,000 characters kept", () => {
    expect(read(withCards([card("a".repeat(20_000))])).invalid).toEqual([]);
  });

  test("listing all its problems, in field order", () => {
    const entry = { ...without(card(""), "back"), tags: ["a b"], extra: 1 };
    expect(invalidOf(withCards([entry]))).toEqual([
      [
        1,
        [
          'card 1, "front": Write something on this side',
          'card 1, "back": "back" is missing',
          'card 1, "tags" #1: "a b": A tag is one word: letters, digits, - and _.',
          'card 1: "extra" is not a key of a Card',
        ],
      ],
    ]);
  });

  test("of a file of only invalid Cards, which is still read", () => {
    const result = read(withCards([card(""), {}, 7]));
    expect(result.cards).toEqual([]);
    expect(result.invalid.map(({ number }) => number)).toEqual([1, 2, 3]);
    expect(result.invalid[1]!.problems).toHaveLength(4);
  });

  test("with no cap on how many are listed", () => {
    const result = read(withCards(Array.from({ length: 500 }, () => ({}))));
    expect(result.invalid).toHaveLength(500);
    expect(result.invalid[499]!.number).toBe(500);
  });
});

describe("formatProblems", () => {
  test("puts one problem on each line", () => {
    const problems: CardFileProblem[] = [{ text: "card 1: a" }, { text: "card 2: b" }];
    expect(formatProblems(problems)).toBe("card 1: a\ncard 2: b");
  });

  test("lists every problem of a file's invalid Cards", () => {
    const { invalid } = read(withCards([{}, card("")]));
    const lines = formatProblems(invalid.flatMap(({ problems }) => problems)).split("\n");
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toBe('card 2, "front": Write something on this side');
  });
});
