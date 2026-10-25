import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptionKeyError, loadEncryptionKey } from "./encryption-key";

let dataDir: string;
const keyFile = () => join(dataDir, "encryption-key");
const load = (encryptionKey?: string) => loadEncryptionKey({ dataDir, encryptionKey });

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "banki-encryption-key-"));
});

afterEach(() => {
  chmodSync(dataDir, 0o700);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("loadEncryptionKey", () => {
  test("generates 32 random bytes as base64url into encryption-key, readable by its owner only", () => {
    const key = load();

    expect(key.length).toBe(32);
    expect(readFileSync(keyFile(), "utf8")).toBe(key.toString("base64url"));
    expect(statSync(keyFile()).mode & 0o777).toBe(0o600);
    expect(readdirSync(dataDir)).toEqual(["encryption-key"]);
  });

  test("reads the file back on later starts", () => {
    const first = load();

    expect(load().equals(first)).toBe(true);
  });

  test("concurrent first starts all end up with the same, complete key", async () => {
    const loader = join(import.meta.dir, "encryption-key.ts");
    const starts = Array.from({ length: 8 }, () =>
      Bun.spawn(
        [
          "bun",
          "-e",
          `const { loadEncryptionKey } = await import(${JSON.stringify(loader)});
           const key = loadEncryptionKey({ dataDir: process.argv[1], encryptionKey: undefined });
           process.stdout.write(key.toString("base64url"));`,
          dataDir,
        ],
        { stdout: "pipe", stderr: "pipe" },
      ),
    );

    const keys = await Promise.all(
      starts.map(async (start) => {
        expect(await start.exited).toBe(0);
        return new Response(start.stdout).text();
      }),
    );

    const written = readFileSync(keyFile(), "utf8");
    expect(written).toMatch(/^[\w-]{43}$/);
    expect(new Set(keys)).toEqual(new Set([written]));
    expect(readdirSync(dataDir)).toEqual(["encryption-key"]);
  });

  test("ignores a trailing newline someone added to the file", () => {
    const text = Buffer.alloc(32, 9).toString("base64url");
    writeFileSync(keyFile(), `${text}\n`);

    expect(load().equals(Buffer.alloc(32, 9))).toBe(true);
  });

  test("ENCRYPTION_KEY overrides the file and doesn't create one", () => {
    const key = load(Buffer.alloc(32, 5).toString("base64url"));

    expect(key.equals(Buffer.alloc(32, 5))).toBe(true);
    expect(() => statSync(keyFile())).toThrow();
  });

  test("an ENCRYPTION_KEY that isn't 32 bytes of base64url fails, saying so", () => {
    expect(() => load(Buffer.alloc(16, 5).toString("base64url"))).toThrow(
      /ENCRYPTION_KEY isn't 32 bytes as base64url/,
    );
  });

  test.each([
    ["empty", "\n"],
    ["shorter than 32 bytes", Buffer.alloc(31, 1).toString("base64url")],
    ["longer than 32 bytes", Buffer.alloc(40, 1).toString("base64url")],
    ["not base64url", "an encryption key typed in by hand, 43 chars"],
  ])("a file that is %s fails, naming it and saying what it expects", (_, content) => {
    writeFileSync(keyFile(), content);

    expect(() => load()).toThrow(EncryptionKeyError);
    expect(() => load()).toThrow(/encryption-key isn't 32 bytes as base64url.*delete it/);
  });

  test("an unreadable file fails with an error naming it", () => {
    writeFileSync(keyFile(), "key", { mode: 0o000 });

    expect(() => load()).toThrow(/Can't read the encryption key from .*encryption-key/);
  });
});
