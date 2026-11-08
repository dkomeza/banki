import { describe, expect, test } from "bun:test";
import { ConfirmImportRequest, formatProblemsWithWarnings, macroPlanLine } from "./imports";

describe("formatProblemsWithWarnings", () => {
  test("puts the problems first, then each Macro warning and image problem, one per line", () => {
    expect(
      formatProblemsWithWarnings(
        [{ text: 'card 9, "back": "back" is missing' }],
        [
          {
            name: "\\eps",
            definition: "\\epsilon",
            outcome: "kept",
            deckDefinition: "\\varepsilon",
          },
        ],
        [
          {
            card: 11,
            reference: "images/a.jpg",
            problem: "missing",
            message: "The zip has no images/a.jpg.",
          },
        ],
      ),
    ).toBe(
      [
        'card 9, "back": "back" is missing',
        "warning: \\eps is defined differently in this Deck; the Deck's definition is kept.",
        "warning: card 11: images/a.jpg: The zip has no images/a.jpg.",
      ].join("\n"),
    );
  });

  test("with no problems, is the warnings alone", () => {
    expect(
      formatProblemsWithWarnings(
        [],
        [{ name: "\\m", definition: "m", outcome: "added" }],
        [],
        true,
      ),
    ).toBe("warning: \\m was added to the Deck's macros.");
  });
});

test("macroPlanLine says why a Macro wasn't added", () => {
  expect(
    macroPlanLine({
      name: "\\x",
      definition: "x",
      outcome: "not_added",
      reason: "Its definition is long.",
    }),
  ).toBe("\\x can't be added: its definition is long.");
});

test("ConfirmImportRequest refuses a Card sent twice or one breaking the Card rules", () => {
  const card = { number: 1, front: "a", back: "b", tags: [], gradingNotes: null };
  expect(ConfirmImportRequest.safeParse({ cards: [card] }).success).toBe(true);
  expect(ConfirmImportRequest.safeParse({ cards: [card, card] }).success).toBe(false);
  expect(ConfirmImportRequest.safeParse({ cards: [{ ...card, front: " " }] }).success).toBe(false);
});
