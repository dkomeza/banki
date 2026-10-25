import { describe, expect, test } from "bun:test";
import { CreateDeckRequest, UpdateDeckRequest, deckNameKey } from "./decks";

describe("CreateDeckRequest", () => {
  test("trims the name and the description, keeping the description's line breaks", () => {
    expect(
      CreateDeckRequest.parse({ name: "  Spanish  ", description: "\n Line one\n\nLine two \n" }),
    ).toEqual({ name: "Spanish", description: "Line one\n\nLine two" });
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
    expect(CreateDeckRequest.safeParse({ name: "a", folderId: "x" }).success).toBe(false);
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

  test("is the same for the composed and decomposed forms of an accent", () => {
    expect(deckNameKey("Café")).toBe(deckNameKey("Café"));
  });
});
