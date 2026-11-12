import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeZip } from "../testing/zip";
import { ZipError, looksLikeZip, writeZip, zipEntries, zipEntryBytes } from "./zip";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("zip", () => {
  test("lists the files and reads them back, stored or deflated, skipping folders", () => {
    const zip = makeZip([
      { name: "deck/", data: "" },
      { name: "deck/cards.json", data: '{"a":1}' },
      { name: "deck/images/a.png", data: "png bytes", stored: true },
    ]);
    expect(looksLikeZip(zip)).toBe(true);
    const entries = zipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual(["deck/cards.json", "deck/images/a.png"]);
    expect(text(zipEntryBytes(zip, entries[0]!))).toBe('{"a":1}');
    expect(text(zipEntryBytes(zip, entries[1]!))).toBe("png bytes");
  });

  test("an empty zip has no entries", () => {
    const zip = makeZip([]);
    expect(looksLikeZip(zip)).toBe(true);
    expect(zipEntries(zip)).toEqual([]);
  });

  test("JSON doesn't look like a zip", () => {
    expect(looksLikeZip(new TextEncoder().encode("{}"))).toBe(false);
  });

  test("something that isn't a zip at all is refused", () => {
    expect(() => zipEntries(new TextEncoder().encode("PK\x03\x04 and then nothing"))).toThrow(
      ZipError,
    );
  });

  test("an entry that unpacks past the size it claims is refused, not unpacked", () => {
    const zip = makeZip([{ name: "bomb.json", data: "x".repeat(100_000), claim: 10 }]);
    const [entry] = zipEntries(zip);
    expect(entry?.size).toBe(10);
    expect(() => zipEntryBytes(zip, entry!)).toThrow(ZipError);
  });

  test("an entry whose data runs past the archive is refused", () => {
    const zip = makeZip([{ name: "a.json", data: "{}" }]);
    const [entry] = zipEntries(zip);
    expect(() => zipEntryBytes(zip, { ...entry!, compressedSize: 1_000_000 })).toThrow(ZipError);
  });
});

const encode = (data: string) => new TextEncoder().encode(data);

describe("writeZip", () => {
  const png = Uint8Array.from({ length: 2048 }, (_, i) => (i * 37) % 256);
  const files = [
    {
      name: "Żółw – słówka.json",
      data: encode(`{"cards":${"[1],".repeat(500)}[]}`),
      deflate: true,
    },
    { name: "images/0b1c.png", data: png, deflate: false },
  ];

  test("zipEntries and zipEntryBytes read back what it wrote, unchanged", () => {
    const zip = writeZip(files);
    expect(looksLikeZip(zip)).toBe(true);
    const entries = zipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
    expect(entries.map((entry) => entry.method)).toEqual([8, 0]);
    expect(entries[0]!.compressedSize).toBeLessThan(files[0]!.data.length);
    expect(entries.map((entry) => zipEntryBytes(zip, entry))).toEqual(files.map((f) => f.data));
  });

  test("an empty zip reads back with no entries", () => {
    const zip = writeZip([]);
    expect(looksLikeZip(zip)).toBe(true);
    expect(zipEntries(zip)).toEqual([]);
  });

  test.skipIf(Bun.which("unzip") === null)("unzip -t accepts its output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "banki-zip-"));
    try {
      const path = join(dir, "deck.zip");
      writeFileSync(path, writeZip(files, new Date(2026, 10, 9, 12, 30, 15)));
      const tested = Bun.spawnSync(["unzip", "-t", path]);
      expect(tested.stdout.toString()).toContain("No errors detected");
      expect(tested.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
