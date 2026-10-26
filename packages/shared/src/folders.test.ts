import { describe, expect, test } from "bun:test";
import { CreateFolderRequest, UpdateFolderRequest } from "./folders";

describe("CreateFolderRequest", () => {
  test("trims the name, and puts it at the Root without a parent", () => {
    expect(CreateFolderRequest.parse({ name: "  Maths " })).toEqual({
      name: "Maths",
      parentId: null,
    });
    expect(CreateFolderRequest.parse({ name: "Analysis", parentId: "f1" })).toEqual({
      name: "Analysis",
      parentId: "f1",
    });
  });

  test("takes a name of 1 to 100 characters after trimming, and nothing else", () => {
    expect(CreateFolderRequest.safeParse({ name: ` ${"a".repeat(100)} ` }).success).toBe(true);
    expect(CreateFolderRequest.safeParse({ name: "a".repeat(101) }).success).toBe(false);
    expect(CreateFolderRequest.safeParse({ name: "  " }).success).toBe(false);
    expect(CreateFolderRequest.safeParse({ name: "a", description: "d" }).success).toBe(false);
  });
});

describe("UpdateFolderRequest", () => {
  test("takes a name, a move, or both, with what to do about a clash", () => {
    expect(UpdateFolderRequest.parse({ name: " B " })).toEqual({ name: "B" });
    expect(UpdateFolderRequest.parse({ parentId: null })).toEqual({ parentId: null });
    expect(UpdateFolderRequest.parse({ parentId: "f1", onClash: "replace" })).toEqual({
      parentId: "f1",
      onClash: "replace",
    });
  });

  test("refuses neither, onClash without a move, and a blank name", () => {
    expect(UpdateFolderRequest.safeParse({}).success).toBe(false);
    expect(UpdateFolderRequest.safeParse({ name: "B", onClash: "keepBoth" }).success).toBe(false);
    expect(UpdateFolderRequest.safeParse({ name: " " }).success).toBe(false);
  });
});
