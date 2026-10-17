import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthSecretError, loadAuthSecret } from "./secret";

let dataDir: string;
const secretFile = () => join(dataDir, "auth-secret");

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "banki-secret-"));
});

afterEach(() => {
  chmodSync(dataDir, 0o700);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("loadAuthSecret", () => {
  test("generates 32 random bytes as base64url into auth-secret, readable by its owner only", () => {
    const secret = loadAuthSecret({ dataDir, authSecret: undefined });

    expect(secret).toMatch(/^[\w-]{43}$/);
    expect(readFileSync(secretFile(), "utf8")).toBe(secret);
    expect(statSync(secretFile()).mode & 0o777).toBe(0o600);
  });

  test("reuses the file on later starts", () => {
    const first = loadAuthSecret({ dataDir, authSecret: undefined });

    expect(loadAuthSecret({ dataDir, authSecret: undefined })).toBe(first);
  });

  test("ignores a trailing newline someone added to the file", () => {
    writeFileSync(secretFile(), "a-secret-someone-wrote-by-hand-0123456789\n");

    expect(loadAuthSecret({ dataDir, authSecret: undefined })).toBe(
      "a-secret-someone-wrote-by-hand-0123456789",
    );
  });

  test("AUTH_SECRET overrides the file and doesn't create one", () => {
    const authSecret = "s".repeat(32);

    expect(loadAuthSecret({ dataDir, authSecret })).toBe(authSecret);
    expect(() => statSync(secretFile())).toThrow();
  });

  test("an empty file fails with an error naming it", () => {
    writeFileSync(secretFile(), "\n");

    expect(() => loadAuthSecret({ dataDir, authSecret: undefined })).toThrow(AuthSecretError);
    expect(() => loadAuthSecret({ dataDir, authSecret: undefined })).toThrow(/auth-secret.*empty/);
  });

  test("an unreadable file fails with an error naming it", () => {
    writeFileSync(secretFile(), "secret", { mode: 0o000 });

    expect(() => loadAuthSecret({ dataDir, authSecret: undefined })).toThrow(
      /Can't read the auth secret from .*auth-secret/,
    );
  });
});
