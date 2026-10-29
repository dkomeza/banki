import { describe, expect, test } from "bun:test";
import { CreateDeckRequest, UpdateDeckRequest, deckNameKey, nextFreeName } from "./decks";

describe("CreateDeckRequest", () => {
  test("trims the name and the description, keeping the description's line breaks", () => {
    expect(
      CreateDeckRequest.parse({ name: "  Spanish  ", description: "\n Line one\n\nLine two \n" }),
    ).toEqual({ name: "Spanish", description: "Line one\n\nLine two", folderId: null });
  });

  test("takes the Folder to create it in, the Root when missing or null", () => {
    expect(CreateDeckRequest.parse({ name: "A", folderId: "f1" }).folderId).toBe("f1");
    expect(CreateDeckRequest.parse({ name: "A", folderId: null }).folderId).toBeNull();
    expect(CreateDeckRequest.safeParse({ name: "A", folderId: "" }).success).toBe(false);
  });

  test("reads a missing, empty or blank description as none", () => {
    expect(CreateDeckRequest.parse({ name: "A" }).description).toBeNull();
    expect(CreateDeckRequest.parse({ name: "A", description: "" }).description).toBeNull();
    expect(CreateDeckRequest.parse({ name: "A", description: " \n " }).description).toBeNull();
    expect(CreateDeckRequest.parse({ name: "A", description: null }).description).toBeNull();
  });

  test("takes a name of 1 to 100 characters after trimming", () => {
    expect(CreateDeckRequest.safeParse({ name: "a" }).success).toBe(true);
    expect(CreateDeckRequest.safeParse({ name: ` ${"a".repeat(100)} ` }).success).toBe(true);
    expect(CreateDeckRequest.safeParse({ name: "a".repeat(101) }).success).toBe(false);
    expect(CreateDeckRequest.safeParse({ name: "" }).success).toBe(false);
    expect(CreateDeckRequest.safeParse({ name: "   " }).success).toBe(false);
    expect(CreateDeckRequest.safeParse({}).success).toBe(false);
  });

  test("takes a description of up to 1,000 characters after trimming", () => {
    expect(CreateDeckRequest.safeParse({ name: "a", description: "d".repeat(1000) }).success).toBe(
      true,
    );
    expect(CreateDeckRequest.safeParse({ name: "a", description: "d".repeat(1001) }).success).toBe(
      false,
    );
  });

  test("refuses anything else", () => {
    expect(CreateDeckRequest.safeParse({ name: "a", parentId: "x" }).success).toBe(false);
  });
});

describe("UpdateDeckRequest", () => {
  test("takes a name, a description, or both", () => {
    expect(UpdateDeckRequest.parse({ name: " B " })).toEqual({ name: "B" });
    expect(UpdateDeckRequest.parse({ description: "" })).toEqual({ description: null });
    expect(UpdateDeckRequest.parse({ name: "B", description: "d" })).toEqual({
      name: "B",
      description: "d",
    });
  });

  test("takes a move, with what to do about a clash", () => {
    expect(UpdateDeckRequest.parse({ folderId: null })).toEqual({ folderId: null });
    expect(UpdateDeckRequest.parse({ folderId: "f1", onClash: "keepBoth" })).toEqual({
      folderId: "f1",
      onClash: "keepBoth",
    });
    expect(UpdateDeckRequest.safeParse({ folderId: "f1", onClash: "merge" }).success).toBe(false);
  });

  test("takes a Desired retention of its own, or null to follow Settings", () => {
    expect(UpdateDeckRequest.parse({ desiredRetention: 85 })).toEqual({ desiredRetention: 85 });
    expect(UpdateDeckRequest.parse({ desiredRetention: null })).toEqual({ desiredRetention: null });
    for (const desiredRetention of [69, 98, 85.5, "85"]) {
      expect(UpdateDeckRequest.safeParse({ desiredRetention }).success).toBe(false);
    }
  });

  test("refuses onClash without a move", () => {
    expect(UpdateDeckRequest.safeParse({ name: "B", onClash: "replace" }).success).toBe(false);
  });

  test("refuses neither, and the same limits as create", () => {
    expect(UpdateDeckRequest.safeParse({}).success).toBe(false);
    expect(UpdateDeckRequest.safeParse({ name: " " }).success).toBe(false);
    expect(UpdateDeckRequest.safeParse({ description: "d".repeat(1001) }).success).toBe(false);
  });
});

describe("deckNameKey", () => {
  test("is the same for names that differ only in case", () => {
    expect(deckNameKey("Calculus 2")).toBe(deckNameKey("CALCULUS 2"));
    expect(deckNameKey("Łódź")).toBe(deckNameKey("łÓDŹ"));
    expect(deckNameKey("Calculus 2")).not.toBe(deckNameKey("Calculus 10"));
  });

  test("is the same for letters with more than one form in a case", () => {
    expect(deckNameKey("Straße")).toBe(deckNameKey("STRASSE"));
    expect(deckNameKey("ΟΔΟΣ")).toBe(deckNameKey("οδοσ"));
    expect(deckNameKey("οδος")).toBe(deckNameKey("οδοσ"));
  });

  test("is the same for the composed and decomposed forms of an accent", () => {
    expect(deckNameKey("Café")).toBe(deckNameKey("Café"));
  });
});

/** Every "(n)" is taken until "(10)". */
const takenUpTo10 = (candidate: string) => !candidate.endsWith("(10)");

describe("nextFreeName", () => {
  test("takes the first free (n), from 2", () => {
    expect(nextFreeName("Cells", () => false)).toBe("Cells (2)");
    const taken = new Set(["Cells (2)", "Cells (3)"]);
    expect(nextFreeName("Cells", (c) => taken.has(c))).toBe("Cells (4)");
  });

  test("cuts the name short to stay within 100 characters", () => {
    const long = "a".repeat(100);
    expect(nextFreeName(long, () => false)).toBe(`${"a".repeat(96)} (2)`);
    expect(nextFreeName(long, takenUpTo10)).toBe(`${"a".repeat(95)} (10)`);
    expect(nextFreeName(long, takenUpTo10)).toHaveLength(100);
  });

  test("drops the spaces a cut leaves at the end, and never splits a character", () => {
    expect(nextFreeName(`${"a".repeat(95)} bcd`, () => false)).toBe(`${"a".repeat(95)} (2)`);
    expect(nextFreeName(`${"a".repeat(95)}😀😀`, () => false)).toBe(`${"a".repeat(95)} (2)`);
  });
});
