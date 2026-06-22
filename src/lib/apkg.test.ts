import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { zipSync, strToU8 } from "fflate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "banki-import-test-"));
process.env.DATABASE_PATH = path.join(root, "banki.db");
process.env.MEDIA_DIR = path.join(root, "media");

beforeAll(() => fs.mkdirSync(process.env.MEDIA_DIR!, { recursive: true }));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("APKG import", () => {
  it("imports a legacy card, math, and mapped media with a fresh schedule", async () => {
    const collectionPath = path.join(root, "source.anki21");
    const source = new Database(collectionPath);
    source.exec(`
      CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT NOT NULL, decks TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, tags TEXT, flds TEXT);
      CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, ord INTEGER, due INTEGER);
    `);
    const models = { "10": { name: "Basic", css: ".card{font-size:20px}", flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }], tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" }] } };
    source.prepare("INSERT INTO col VALUES (1, ?, ?)").run(JSON.stringify(models), JSON.stringify({ "20": { name: "Physics" } }));
    source.prepare("INSERT INTO notes VALUES (1, 'guid', 10, 'exam ', ?)").run("What is \\(E=mc^2\\)? <img src=\"diagram.png\">\x1fEnergy-mass equivalence");
    source.prepare("INSERT INTO cards VALUES (2, 1, 0, 1)").run();
    source.close();
    const archive = zipSync({
      "collection.anki21": new Uint8Array(fs.readFileSync(collectionPath)),
      media: strToU8(JSON.stringify({ "0": "diagram.png" })),
      "0": new Uint8Array([137, 80, 78, 71]),
    });
    const { importApkg } = await import("@/lib/apkg");
    const report = await importApkg("physics.apkg", archive);
    expect(report.importedCards).toBe(1);
    expect(report.importedMedia).toBe(1);
    expect(report.skippedCards).toBe(0);
    expect(report.warnings.some((warning) => warning.includes("Mathematical content"))).toBe(true);
  });

  it("reads normalized WITHOUT ROWID note-type tables using keyed queries", async () => {
    const collectionPath = path.join(root, "modern.anki21");
    const source = new Database(collectionPath);
    source.exec(`
      CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT NOT NULL, decks TEXT NOT NULL);
      CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, tags TEXT, flds TEXT);
      CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, ord INTEGER, due INTEGER);
      CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT, PRIMARY KEY(ntid, ord)) WITHOUT ROWID;
      CREATE TABLE templates (ntid INTEGER, ord INTEGER, name TEXT, front TEXT, back TEXT, css TEXT, PRIMARY KEY(ntid, ord)) WITHOUT ROWID;
      CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT) WITHOUT ROWID;
      INSERT INTO col VALUES (1, '{}', '{}');
      INSERT INTO notetypes VALUES (100, 'Basic');
      INSERT INTO fields VALUES (100, 0, 'Front'), (100, 1, 'Back');
      INSERT INTO templates VALUES (100, 0, 'Card 1', '{{Front}}', '{{FrontSide}}<hr>{{Back}}', '.card{}');
      INSERT INTO decks VALUES (200, 'Modern deck');
      INSERT INTO notes VALUES (1, 'modern-guid', 100, '', 'Question\x1fAnswer');
      INSERT INTO cards VALUES (2, 1, 0, 1);
    `);
    source.close();
    const archive = zipSync({
      "collection.anki21": new Uint8Array(fs.readFileSync(collectionPath)),
      media: strToU8("{}"),
    });
    const { importApkg } = await import("@/lib/apkg");
    const report = await importApkg("modern.apkg", archive);
    expect(report.importedCards).toBe(1);
  });
});
