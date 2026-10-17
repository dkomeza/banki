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

  test("leaves nothing in the data directory but auth-secret", () => {
    loadAuthSecret({ dataDir, authSecret: undefined });

    expect(readdirSync(dataDir)).toEqual(["auth-secret"]);
  });

  test("concurrent first starts all end up with the same, complete secret", async () => {
    const loader = join(import.meta.dir, "secret.ts");
    const starts = Array.from({ length: 8 }, () =>
      Bun.spawn(
        [
          "bun",
          "-e",
          `const { loadAuthSecret } = await import(${JSON.stringify(loader)});
           process.stdout.write(loadAuthSecret({ dataDir: process.argv[1], authSecret: undefined }));`,
          dataDir,
        ],
        { stdout: "pipe", stderr: "pipe" },
      ),
    );

    const secrets = await Promise.all(
      starts.map(async (start) => {
        expect(await start.exited).toBe(0);
        return new Response(start.stdout).text();
      }),
    );

    const written = readFileSync(secretFile(), "utf8");
    expect(written).toMatch(/^[\w-]{43}$/);
    expect(new Set(secrets)).toEqual(new Set([written]));
    expect(readdirSync(dataDir)).toEqual(["auth-secret"]);
  });

  test("a start that died while writing leaves no half-written auth-secret behind", () => {
    // What a start killed between writing its temp file and linking it leaves.
    writeFileSync(join(dataDir, "auth-secret.4242.0123456789ab.tmp"), "");

    const secret = loadAuthSecret({ dataDir, authSecret: undefined });

    expect(secret).toMatch(/^[\w-]{43}$/);
    expect(readFileSync(secretFile(), "utf8")).toBe(secret);
  });

  test("a file shorter than 32 characters fails, saying to delete it", () => {
    writeFileSync(secretFile(), "x".repeat(31));

    expect(() => loadAuthSecret({ dataDir, authSecret: undefined })).toThrow(
      /auth-secret.*shorter than 32 characters.*Delete it/,
    );
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
