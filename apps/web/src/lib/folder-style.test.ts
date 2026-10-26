import { describe, expect, test } from "vitest";
import { FOLDER_STYLE_KEY, createFolderStyleStore } from "./folder-style";

const memory = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

describe("createFolderStyleStore", () => {
  test("is Normal until Compact is chosen", () => {
    expect(createFolderStyleStore(() => memory()).current()).toBe("normal");
  });

  test("remembers the choice on this device", () => {
    const storage = memory();
    createFolderStyleStore(() => storage).set("compact");

    expect(storage.getItem(FOLDER_STYLE_KEY)).toBe("compact");
    expect(createFolderStyleStore(() => storage).current()).toBe("compact");
  });

  test("reads anything else stored as Normal", () => {
    expect(createFolderStyleStore(() => memory({ [FOLDER_STYLE_KEY]: "dense" })).current()).toBe(
      "normal",
    );
  });
});
