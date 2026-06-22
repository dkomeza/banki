import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "banki-json-import-test-"));
process.env.DATABASE_PATH = path.join(root, "banki.db");

beforeAll(() => fs.mkdirSync(root, { recursive: true }));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("Banki JSON import", () => {
  it("imports an ordered deck with sanitized HTML and a fresh schedule", async () => {
    const { importBankiCardFile } = await import("@/lib/banki-import");
    const { sqlite } = await import("@/lib/db");
    const report = importBankiCardFile("biology.banki.json", JSON.stringify({
      version: 1,
      deck: { name: "Biology", description: "Exam material" },
      cards: [
        { front: "First <script>bad()</script>", back: "Answer 1", tags: ["exam", "exam"] },
        { front: "Second", back: "\\(x^2\\)", tags: ["math"] },
      ],
    }));

    expect(report).toMatchObject({ importedCards: 2, importedMedia: 0, skippedCards: 0 });
    const deck = sqlite.prepare("SELECT name, description, source_name FROM decks WHERE id = ?").get(report.deckId);
    expect(deck).toEqual({ name: "Biology", description: "Exam material", source_name: "biology.banki.json" });
    const imported = sqlite.prepare("SELECT front_html, back_html, tags, position, reps, state FROM cards WHERE deck_id = ? ORDER BY position").all(report.deckId) as Array<Record<string, unknown>>;
    expect(imported).toHaveLength(2);
    expect(imported[0]).toMatchObject({ front_html: "First ", tags: '["exam"]', position: 0, reps: 0, state: 0 });
    expect(imported[1]).toMatchObject({ front_html: "Second", back_html: "\\(x^2\\)", position: 1 });
  });

  it("reports a precise path and imports nothing when a card is invalid", async () => {
    const { importBankiCardFile } = await import("@/lib/banki-import");
    const { sqlite } = await import("@/lib/db");
    const before = (sqlite.prepare("SELECT count(*) AS count FROM decks").get() as { count: number }).count;

    expect(() => importBankiCardFile("bad.banki.json", JSON.stringify({
      version: 1,
      deck: { name: "Broken" },
      cards: [{ front: "Question", back: "" }],
    }))).toThrow(/cards\.0\.back/);

    const after = (sqlite.prepare("SELECT count(*) AS count FROM decks").get() as { count: number }).count;
    expect(after).toBe(before);
  });

  it("rejects unknown fields and malformed JSON", async () => {
    const { parseBankiCardFile } = await import("@/lib/banki-import");
    expect(() => parseBankiCardFile("not json")).toThrow(/not valid JSON/);
    expect(() => parseBankiCardFile(JSON.stringify({
      version: 1,
      deck: { name: "Deck" },
      cards: [{ front: "Q", back: "A", hint: "unsupported" }],
    }))).toThrow(/cards\.0/);
  });
});
