import { describe, expect, test } from "bun:test";
import { createApiKeyCipher } from "./api-key-cipher";

const cipher = createApiKeyCipher(Buffer.alloc(32, 1));
const API_KEY = "sk-or-v1-0123456789abcdef3f9a";

describe("the API key cipher", () => {
  test("reads back what it stored", () => {
    expect(cipher.decrypt(cipher.encrypt(API_KEY, "user-1"), "user-1")).toBe(API_KEY);
  });

  test("never holds the key in plain text", () => {
    const stored = cipher.encrypt(API_KEY, "user-1");

    expect(stored).not.toContain(API_KEY);
    expect(stored).not.toContain("3f9a");
    expect(Buffer.from(stored.slice(3), "base64url").toString("latin1")).not.toContain(API_KEY);
  });

  test("uses a fresh nonce on every save", () => {
    const first = cipher.encrypt(API_KEY, "user-1");
    const second = cipher.encrypt(API_KEY, "user-1");

    expect(first).not.toBe(second);
    expect(first.slice(0, 3 + 16)).not.toBe(second.slice(0, 3 + 16));
  });

  test("can't read a key stored under another encryption key", () => {
    const other = createApiKeyCipher(Buffer.alloc(32, 2));

    expect(cipher.decrypt(other.encrypt(API_KEY, "user-1"), "user-1")).toBeUndefined();
  });

  test("can't read a key stored for another User", () => {
    expect(cipher.decrypt(cipher.encrypt(API_KEY, "user-1"), "user-2")).toBeUndefined();
  });

  test("can't read a key that was tampered with", () => {
    const stored = cipher.encrypt(API_KEY, "user-1");
    const flipped = `${stored.slice(0, -2)}${stored.at(-2) === "A" ? "B" : "A"}${stored.at(-1)}`;

    expect(cipher.decrypt(flipped, "user-1")).toBeUndefined();
  });

  test.each(["", "v1.", "v2.abc", "v1.abc.def", "not a stored key"])("can't read %p", (stored) => {
    expect(cipher.decrypt(stored, "user-1")).toBeUndefined();
  });
});
