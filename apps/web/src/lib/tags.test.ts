import { describe, expect, test } from "vitest";
import type { Card } from "./cards";
import {
  deckSearch,
  fold,
  highlight,
  matches,
  pickedTags,
  suggestTags,
  tagCounts,
  tagProblem,
  tagsChanged,
  toDeckSearch,
  wordsOf,
} from "./tags";

const card = (front: string, back = "", tags: string[] = []): Card => ({
  id: front,
  deckId: "d1",
  front,
  back,
  tags,
  gradingNotes: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
});

const shown = (cards: Card[], q: string, picked: string[] = []) =>
  cards.filter((c) => matches(c, wordsOf(q), picked)).map((c) => c.front);

describe("search", () => {
  const cards = [
    card("el árbol", "the tree"),
    card("la cuenta", "the bill, the check\n¿Nos trae la cuenta, por favor?"),
    card("$\\int \\sec x \\, dx$", "$\\ln\\lvert \\sec x + \\tan x \\rvert + C$"),
    card("か", "ka"),
    card("が", "ga"),
  ];

  test("matches every word, in any order, in the Front or the Back", () => {
    expect(shown(cards, "bill cuenta")).toEqual(["la cuenta"]);
    expect(shown(cards, "favor la")).toEqual(["la cuenta"]);
    expect(shown(cards, "cuenta tree")).toEqual([]);
  });

  test("ignores case", () => {
    expect(shown(cards, "LA CUENTA")).toEqual(["la cuenta"]);
  });

  test("ignores Latin accents both ways", () => {
    expect(shown(cards, "arbol")).toEqual(["el árbol"]);
    expect(shown(cards, "ÁRBOL")).toEqual(["el árbol"]);
    expect(shown([card("el arbol")], "árbol")).toEqual(["el arbol"]);
  });

  test("keeps Japanese voiced marks: が doesn't match か", () => {
    expect(shown(cards, "か")).toEqual(["か"]);
    expect(shown(cards, "が")).toEqual(["が"]);
  });

  test("matches the Markdown and LaTeX source as typed", () => {
    expect(shown(cards, "\\sec")).toEqual(["$\\int \\sec x \\, dx$"]);
    expect(shown(cards, "\\tan")).toEqual(["$\\int \\sec x \\, dx$"]);
  });

  test("a blank search matches everything", () => {
    expect(wordsOf("  \n ")).toEqual([]);
    expect(shown(cards, " ")).toHaveLength(cards.length);
  });

  test("doesn't match Tags", () => {
    expect(shown([card("f", "b", ["verb"])], "verb")).toEqual([]);
  });

  test("fold drops only the combining diacritics", () => {
    expect(fold("Ñandú Über çà")).toBe("nandu uber ca");
    expect(fold("が")).toBe("が");
  });
});

describe("the tag filter", () => {
  const cards = [
    card("quedar", "", ["b1", "verb"]),
    card("estar de acuerdo", "to agree", ["irregular", "verb"]),
    card("la cuenta", "", ["noun"]),
  ];

  test("picked Tags narrow with and", () => {
    expect(shown(cards, "", ["verb"])).toEqual(["quedar", "estar de acuerdo"]);
    expect(shown(cards, "", ["verb", "irregular"])).toEqual(["estar de acuerdo"]);
    expect(shown(cards, "", ["verb", "noun"])).toEqual([]);
  });

  test("Tags and search narrow together", () => {
    expect(shown(cards, "agree", ["verb"])).toEqual(["estar de acuerdo"]);
    expect(shown(cards, "agree", ["b1"])).toEqual([]);
  });

  test("tagCounts lists the Cards' Tags A–Z with how many carry each", () => {
    expect(tagCounts(cards)).toEqual([
      { tag: "b1", count: 1 },
      { tag: "irregular", count: 1 },
      { tag: "noun", count: 1 },
      { tag: "verb", count: 2 },
    ]);
  });
});

describe("the filter in the URL", () => {
  test("keeps a search and Tags, reading numbers as text and dropping the rest", () => {
    expect(deckSearch({ q: "arbol", tags: "verb,noun", state: "x" })).toEqual({
      q: "arbol",
      tags: "verb,noun",
    });
    expect(deckSearch({ q: 2024, tags: 3 })).toEqual({ q: "2024", tags: "3" });
    expect(deckSearch({ q: "", tags: ["x"] })).toEqual({});
  });

  test("reads the picked Tags lowercase, once each", () => {
    expect(pickedTags("verb,Irregular,,verb")).toEqual(["verb", "irregular"]);
    expect(pickedTags(undefined)).toEqual([]);
  });

  test("writes nothing for an empty filter", () => {
    expect(toDeckSearch("", [])).toEqual({});
    expect(toDeckSearch("a b", ["verb", "noun"])).toEqual({ q: "a b", tags: "verb,noun" });
  });
});

const hits = (text: string, q: string) =>
  highlight(text, wordsOf(q))
    .filter((run) => run.hit)
    .map((run) => run.text);

describe("highlight", () => {
  test("marks each match, ignoring case and accents, keeping the text as typed", () => {
    expect(hits("El Árbol y el arbusto", "ar")).toEqual(["Ár", "ar"]);
    expect(highlight("abc", []).map((r) => r.text)).toEqual(["abc"]);
  });

  test("marks a decomposed accent with its letter", () => {
    expect(hits("cafe\u0301 au lait", "cafe")).toEqual(["café"]);
  });

  test("keeps characters outside the BMP whole", () => {
    expect(hits("𝔸 then cat", "cat")).toEqual(["cat"]);
  });
});

describe("the Tags field", () => {
  test("refuses a word breaking the rules, and a 21st Tag", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(tagProblem("verb", [])).toBeUndefined();
    expect(tagProblem("taylor's", [])).toBe("A tag is one word: letters, digits, - and _.");
    expect(tagProblem("a".repeat(51), [])).toBe("Keep a tag to 50 characters.");
    expect(tagProblem("t20", twenty)).toBe("A card carries up to 20 tags.");
    expect(tagProblem("T0", twenty)).toBeUndefined();
  });

  test("suggests the User's Tags holding what's typed, those starting with it first, not the Card's own", () => {
    const all = ["convergence", "exam", "icon", "noun", "series"];
    expect(suggestTags(all, "con", [])).toEqual(["convergence", "icon"]);
    expect(suggestTags(all, "CON", ["convergence"])).toEqual(["icon"]);
    expect(suggestTags(all, " ", [])).toEqual([]);
  });

  test("tagsChanged compares two A–Z lists", () => {
    expect(tagsChanged(["a", "b"], ["a", "b"])).toBe(false);
    expect(tagsChanged(["a"], ["a", "b"])).toBe(true);
    expect(tagsChanged(["a", "c"], ["a", "b"])).toBe(true);
  });
});
