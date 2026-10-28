import { describe, expect, test } from "bun:test";
import { CreateCardRequest, UpdateCardRequest } from "./cards";
import { CardTags, TagName, sortTags, tagNameProblem } from "./tags";

describe("TagName", () => {
  test("takes one word of letters, digits, - and _, in any script", () => {
    for (const tag of ["verb", "irregular-verb", "ch3", "snake_case", "動詞", "árbol", "x"]) {
      expect(TagName.parse(tag)).toBe(tag);
    }
  });

  test("stores it lowercase", () => {
    expect(TagName.parse("Irregular-Verb")).toBe("irregular-verb");
    expect(TagName.parse("ÁRBOL")).toBe("árbol");
  });

  test("reads a decomposed accent as the same Tag as a composed one", () => {
    expect(TagName.parse("árbol")).toBe("árbol");
  });

  test("refuses an empty Tag, a space, punctuation and anything but - and _", () => {
    for (const tag of ["", " ", "two words", "verb,", "#verb", "taylor's", "a.b", "a/b", "😀"]) {
      expect(TagName.safeParse(tag).success).toBe(false);
    }
  });

  test("refuses a combining mark on its own, or leading the word", () => {
    expect(TagName.safeParse("\u0301").success).toBe(false);
    expect(TagName.safeParse("\u0301a").success).toBe(false);
  });

  test("counts the 50 characters as stored, after lowercasing", () => {
    // "İ" lowercases to "i" and a combining dot: two characters.
    expect(TagName.safeParse("İ".repeat(25)).success).toBe(true);
    expect(TagName.safeParse("İ".repeat(26)).success).toBe(false);
  });

  test("takes up to 50 characters, counting each character once", () => {
    expect(TagName.safeParse("a".repeat(50)).success).toBe(true);
    expect(TagName.safeParse("a".repeat(51)).success).toBe(false);
    expect(TagName.safeParse("動".repeat(50)).success).toBe(true);
    expect(TagName.safeParse("動".repeat(51)).success).toBe(false);
  });

  test("says what's wrong in a sentence for the Tags field", () => {
    expect(tagNameProblem("verb")).toBeUndefined();
    expect(tagNameProblem("taylor's")).toBe("A tag is one word: letters, digits, - and _.");
    expect(tagNameProblem("a".repeat(51))).toBe("Keep a tag to 50 characters.");
  });
});

describe("CardTags", () => {
  test("drops duplicates, ignoring case, and answers them A–Z", () => {
    expect(CardTags.parse(["verb", "Noun", "VERB", "a1"])).toEqual(["a1", "noun", "verb"]);
  });

  test("takes up to 20 Tags, counted once duplicates are dropped", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(CardTags.safeParse(twenty).success).toBe(true);
    expect(CardTags.safeParse([...twenty, "T0"]).success).toBe(true);
    expect(CardTags.safeParse([...twenty, "t20"]).success).toBe(false);
  });

  test("refuses the list when any Tag breaks the rules", () => {
    expect(CardTags.safeParse(["verb", "two words"]).success).toBe(false);
    expect(CardTags.safeParse("verb").success).toBe(false);
  });
});

test("sortTags orders A–Z by character", () => {
  expect(sortTags(["b", "a-b", "a", "動詞", "a_b", "10", "9"])).toEqual([
    "10",
    "9",
    "a",
    "a-b",
    "a_b",
    "b",
    "動詞",
  ]);
});

describe("a Card's Tags in requests", () => {
  test("a create takes no Tags unless given", () => {
    expect(CreateCardRequest.parse({ front: "f", back: "b" }).tags).toEqual([]);
    expect(CreateCardRequest.parse({ front: "f", back: "b", tags: ["B", "a"] }).tags).toEqual([
      "a",
      "b",
    ]);
  });

  test("a change may carry only Tags, or none at all to leave them", () => {
    expect(UpdateCardRequest.parse({ tags: [] })).toEqual({ tags: [] });
    expect(UpdateCardRequest.parse({ front: "f" }).tags).toBeUndefined();
    expect(UpdateCardRequest.safeParse({}).success).toBe(false);
  });
});
