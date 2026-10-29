import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  CARD_FILE_JSON_SCHEMA,
  CardFile,
  NEWER_BANKI_MESSAGE,
  NOT_A_CARD_FILE_MESSAGE,
} from "./card-file";

/** The issue's example Card file. */
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

/** `EXAMPLE` with its one Card changed by `card`. */
const withCard = (card: Record<string, unknown>) => ({ ...EXAMPLE, cards: [{ ...CARD, ...card }] });

/** `EXAMPLE` with these macros. */
const withMacros = (macros: unknown[]) => ({ ...EXAMPLE, macros });

/** The issues `CardFile` refuses `file` with, as `[path, message]`. */
function problemsOf(file: unknown): Array<[string, string]> {
  const result = CardFile.safeParse(file);
  if (result.success) throw new Error("Expected the Card file to be refused");
  return result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

/** `object` without `key`. */
const without = (object: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));

describe("CardFile", () => {
  test("accepts the example", () => {
    expect(CardFile.parse(EXAMPLE)).toEqual(EXAMPLE);
  });

  test("accepts a null $schema, no macros and no Cards", () => {
    const empty: CardFile = { $schema: null, format: "banki", version: 1, macros: [], cards: [] };
    expect(CardFile.parse(empty)).toEqual(empty);
  });

  test.each(["$schema", "format", "version", "macros", "cards"])(
    "refuses a file without %s, saying it is missing",
    (key) => {
      expect(problemsOf(without(EXAMPLE, key))).toEqual([[key, `"${key}" is missing`]]);
    },
  );

  test.each(["front", "back", "tags", "gradingNotes"])(
    "refuses a Card without %s, saying it is missing",
    (key) => {
      const file = { ...EXAMPLE, cards: [without(CARD, key)] };
      expect(problemsOf(file)).toEqual([[`cards.0.${key}`, `"${key}" is missing`]]);
    },
  );

  test.each(["name", "definition"])("refuses a macro without its %s", (key) => {
    const file = withMacros([without({ name: "\\R", definition: "\\mathbb{R}" }, key)]);
    expect(problemsOf(file)).toEqual([[`macros.0.${key}`, `"${key}" is missing`]]);
  });

  test("refuses an unknown key at the top, naming it", () => {
    expect(problemsOf({ ...EXAMPLE, deck: "Physics" })).toEqual([
      ["", '"deck" is not a key of a Card file'],
    ]);
  });

  test("refuses an unknown key on a Card, naming it", () => {
    expect(problemsOf(withCard({ id: "1", notes: "" }))).toEqual([
      ["cards.0", '"id", "notes" are not keys of a Card'],
    ]);
  });

  test("refuses an unknown key on a macro, naming it", () => {
    expect(problemsOf(withMacros([{ name: "\\R", definition: "x", args: 0 }]))).toEqual([
      ["macros.0", '"args" is not a key of a macro'],
    ]);
  });

  test.each(["anki", "Banki", 1, null])("refuses format %p as not a Card file", (format) => {
    const problems = problemsOf({ ...EXAMPLE, format });
    expect(problems).toEqual([["format", NOT_A_CARD_FILE_MESSAGE]]);
    expect(NOT_A_CARD_FILE_MESSAGE).toContain("not a Card file");
  });

  test.each([[[]], ["banki"], [null]])("refuses %p as not a Card file", (file) => {
    expect(problemsOf(file)).toEqual([["", NOT_A_CARD_FILE_MESSAGE]]);
  });

  test("refuses version 2 as made by a newer Banki", () => {
    expect(problemsOf({ ...EXAMPLE, version: 2 })).toEqual([["version", NEWER_BANKI_MESSAGE]]);
    expect(NEWER_BANKI_MESSAGE).toContain("made by a newer Banki");
  });

  test.each([0, 1.5, "1"])("refuses version %p as not 1", (version) => {
    expect(problemsOf({ ...EXAMPLE, version })).toEqual([["version", '"version" is 1']]);
  });

  test.each(["front", "back"])("refuses a blank %s", (side) => {
    expect(problemsOf(withCard({ [side]: " \n\t" }))).toEqual([
      [`cards.0.${side}`, "Write something on this side"],
    ]);
  });

  test.each(["front", "back"])("takes a %s of 20,000 characters and refuses 20,001", (side) => {
    expect(CardFile.safeParse(withCard({ [side]: "a".repeat(20_000) })).success).toBe(true);
    expect(problemsOf(withCard({ [side]: "a".repeat(20_001) }))).toEqual([
      [`cards.0.${side}`, "Keep it to 20,000 characters"],
    ]);
  });

  test("refuses a Tag that isn't one word", () => {
    expect(problemsOf(withCard({ tags: ["ok", "two words"] }))).toEqual([
      ["cards.0.tags.1", "A tag is one word: letters, digits, - and _."],
    ]);
  });

  test("takes a Tag of 50 characters and refuses 51", () => {
    expect(CardFile.safeParse(withCard({ tags: ["a".repeat(50)] })).success).toBe(true);
    expect(problemsOf(withCard({ tags: ["a".repeat(51)] }))).toEqual([
      ["cards.0.tags.0", "Keep a tag to 50 characters."],
    ]);
  });

  test("takes 20 Tags and refuses 21", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(CardFile.safeParse(withCard({ tags: tags.slice(0, 20) })).success).toBe(true);
    expect(problemsOf(withCard({ tags }))).toEqual([
      ["cards.0.tags", "A card carries up to 20 tags"],
    ]);
  });

  test("takes grading notes of 2,000 characters and refuses 2,001", () => {
    expect(CardFile.safeParse(withCard({ gradingNotes: "a".repeat(2_000) })).success).toBe(true);
    expect(problemsOf(withCard({ gradingNotes: "a".repeat(2_001) }))).toEqual([
      ["cards.0.gradingNotes", "Keep grading notes to 2,000 characters"],
    ]);
  });

  test.each(["R", "R1", "\\R1", "\\", "\\ab c", "\\12"])("refuses the macro name %p", (name) => {
    expect(problemsOf(withMacros([{ name, definition: "x" }]))).toEqual([
      [
        "macros.0.name",
        "A macro's name is \\ and letters, such as \\R, or \\ and one other character",
      ],
    ]);
  });

  test.each(["\\R", "\\norm", "\\mathbbR", "\\,", "\\!", "\\1", "\\ "])(
    "takes the macro name %p",
    (name) => {
      expect(CardFile.safeParse(withMacros([{ name, definition: "x" }])).success).toBe(true);
    },
  );

  test.each(["", "  \n"])("refuses a blank definition %p", (definition) => {
    expect(problemsOf(withMacros([{ name: "\\R", definition }]))).toEqual([
      ["macros.0.definition", "Write what the macro stands for"],
    ]);
  });

  test("refuses a macro name defined twice, at the repeat", () => {
    const macros = [
      { name: "\\R", definition: "\\mathbb{R}" },
      { name: "\\C", definition: "\\mathbb{C}" },
      { name: "\\R", definition: "\\mathbf{R}" },
    ];
    expect(problemsOf(withMacros(macros))).toEqual([
      ["macros.2.name", "\\R is defined more than once"],
    ]);
  });

  test("tells macro names apart by case", () => {
    const macros = [
      { name: "\\R", definition: "\\mathbb{R}" },
      { name: "\\r", definition: "\\mathbf{r}" },
    ];
    expect(CardFile.safeParse(withMacros(macros)).success).toBe(true);
  });

  test("lowercases Tags and drops duplicates", () => {
    const [card] = CardFile.parse(withCard({ tags: ["Maxwell", "EM", "maxwell", "em"] })).cards;
    expect(card!.tags).toEqual(["em", "maxwell"]);
  });

  test.each(["", "   ", "\n\t"])("reads grading notes of %p as null", (gradingNotes) => {
    expect(CardFile.parse(withCard({ gradingNotes })).cards[0]!.gradingNotes).toBeNull();
  });

  test("keeps sides, grading notes and definitions exactly as written", () => {
    const front = "  Leading *and* trailing  \n";
    const back = "\n$$ x $$\t";
    const gradingNotes = " Accept $x$ too. ";
    const definition = " \\left\\| #1 \\right\\| ";
    const file = CardFile.parse({
      ...withCard({ front, back, gradingNotes }),
      macros: [{ name: "\\norm", definition }],
    });
    expect(file.cards[0]).toEqual({ front, back, tags: ["maxwell"], gradingNotes });
    expect(file.macros[0]!.definition).toBe(definition);
  });
});

/** The keywords strict mode accepts on every provider (ADR-0023). */
const ALLOWED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "title",
  "description",
  "$schema",
]);

type JsonSchema = {
  type?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: unknown;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  [keyword: string]: unknown;
};

/** Enough of a JSON Schema to walk its subschemas. */
const JsonSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.looseObject({
    type: z.unknown().optional(),
    properties: z.record(z.string(), JsonSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.unknown().optional(),
    items: JsonSchema.optional(),
    anyOf: z.array(JsonSchema).optional(),
  }),
);

/** Every subschema of `schema`, itself first, with where it sits. */
function* subschemas(schema: JsonSchema, at = "#"): Generator<[string, JsonSchema]> {
  yield [at, schema];
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    yield* subschemas(property, `${at}/properties/${key}`);
  }
  if (schema.items !== undefined) yield* subschemas(schema.items, `${at}/items`);
  for (const [index, option] of (schema.anyOf ?? []).entries()) {
    yield* subschemas(option, `${at}/anyOf/${index}`);
  }
}

const SCHEMA = JsonSchema.parse(CARD_FILE_JSON_SCHEMA);
const isObjectSchema = (schema: JsonSchema) =>
  schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"));

describe("CARD_FILE_JSON_SCHEMA", () => {
  test("uses only the keywords strict mode accepts, and no length or pattern keywords", () => {
    for (const [at, schema] of subschemas(SCHEMA)) {
      const keywords = Object.keys(schema);
      expect({ at, keywords: keywords.filter((k) => !ALLOWED_KEYWORDS.has(k)) }).toEqual({
        at,
        keywords: [],
      });
      expect({ at, keywords: keywords.filter((k) => /length|pattern|min|max/i.test(k)) }).toEqual({
        at,
        keywords: [],
      });
    }
  });

  test("closes every object and requires every one of its properties", () => {
    const objects = [...subschemas(SCHEMA)].filter(([, schema]) => isObjectSchema(schema));
    // The file, a macro and a Card.
    expect(objects.length).toBe(3);
    for (const [at, schema] of objects) {
      expect({ at, additionalProperties: schema.additionalProperties }).toEqual({
        at,
        additionalProperties: false,
      });
      expect({ at, required: schema.required?.toSorted() }).toEqual({
        at,
        required: Object.keys(schema.properties ?? {}).toSorted(),
      });
    }
  });

  test("has exactly the Card file's keys, at the top and on a Card", () => {
    expect(Object.keys(SCHEMA.properties!)).toEqual([
      "$schema",
      "format",
      "version",
      "macros",
      "cards",
    ]);
    expect(Object.keys(SCHEMA.properties!.cards!.items!.properties!)).toEqual([
      "front",
      "back",
      "tags",
      "gradingNotes",
    ]);
    expect(Object.keys(SCHEMA.properties!.macros!.items!.properties!)).toEqual([
      "name",
      "definition",
    ]);
  });

  test("describes every property, and has a title", () => {
    expect(SCHEMA.title).toBeString();
    for (const [at, schema] of subschemas(SCHEMA)) {
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        expect({ at: `${at}/properties/${key}`, description: typeof property.description }).toEqual(
          { at: `${at}/properties/${key}`, description: "string" },
        );
      }
    }
  });

  test("types the version as the integer 1", () => {
    expect(SCHEMA.properties!.version).toMatchObject({ type: "integer", const: 1 });
  });

  test("states the limits in its descriptions", () => {
    const card = SCHEMA.properties!.cards!.items!.properties!;
    expect(card.front!.description).toContain("20,000 characters");
    expect(card.tags!.description).toContain("50 characters");
    expect(card.tags!.description).toContain("at most 20");
    expect(card.gradingNotes!.description).toContain("2,000 characters");
  });
});
