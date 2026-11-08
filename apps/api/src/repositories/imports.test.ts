import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportPreviewResponse, NumberedCard } from "@banki/shared";
import { sql } from "drizzle-orm";
import { type OpenedDatabase, importsDirOf, openDatabase, uploadsDirOf } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { makeZip } from "../testing/zip";
import { type CardRepository, createCardRepository } from "./cards";
import { type DeckRepository, createDeckRepository } from "./decks";
import { createImageRepository } from "./images";
import { type ImportRepository, createImportRepository, hasImports } from "./imports";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let imports: ImportRepository;
let cards: CardRepository;
let decks: DeckRepository;
let deckId: string;

const USER = "user-1";
const OTHER = "user-2";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const card = (front: string, back = "b", more: Record<string, unknown> = {}) => ({
  front,
  back,
  tags: [],
  gradingNotes: null,
  ...more,
});

const fileText = (entries: unknown[], macros: unknown[] = []) =>
  JSON.stringify({ $schema: null, format: "banki", version: 1, macros, cards: entries });

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-imports-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  createUserRepository(opened.db).createWithPassword({
    userId: USER,
    accountId: "a1",
    email: "u@x.y",
    passwordHash: "h",
  });
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${OTHER}, 'n', 'o@x.y', 1, 0, 0)`,
  );
  imports = createImportRepository(opened.db, importsDirOf(tempDir), uploadsDirOf(tempDir));
  cards = createCardRepository(opened.db);
  decks = createDeckRepository(opened.db);
  const deck = decks.create(USER, { name: "D", description: null, folderId: null });
  if (typeof deck === "string") throw new Error(deck);
  deckId = deck.id;
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Creates an Import of `text` pasted, or of a zip, answering its ID. */
function create(upload: string | Uint8Array, at = NOW): string {
  const created = imports.create(
    USER,
    deckId,
    typeof upload === "string"
      ? { bytes: new TextEncoder().encode(upload), kind: "paste", fileName: "" }
      : { bytes: upload, kind: "file", fileName: "deck.zip" },
    { now: at },
  );
  if (created === "not_found" || "problems" in created) throw new Error(JSON.stringify(created));
  return created.id;
}

const preview = (id: string): ImportPreviewResponse => {
  const found = imports.find(USER, id);
  if (found?.status !== "unconfirmed") throw new Error("not a preview");
  return found;
};

/** The preview's Cards as the browser sends them: ticked, as read. */
const asRead = (id: string, numbers?: number[]): NumberedCard[] =>
  preview(id)
    .cards.filter((one) => numbers === undefined || numbers.includes(one.number))
    .map((one) => {
      const { duplicateOf: _, ...read } = one;
      return read;
    });

const confirm = (id: string, ticked: NumberedCard[], at = NOW) => {
  const done = imports.confirm(USER, id, ticked, { now: at });
  if (typeof done === "string" || done.status !== "confirmed")
    throw new Error(JSON.stringify(done));
  return done;
};

const deckCards = () => {
  const listed = cards.list(USER, deckId);
  if (listed === "not_found") throw new Error("no deck");
  return listed;
};

describe("create and find", () => {
  test("a pasted file becomes an unconfirmed Import whose preview has every valid Card", () => {
    const id = create(fileText([card("a"), {}, card("b")]));
    const found = preview(id);
    expect(found).toMatchObject({
      status: "unconfirmed",
      deckId,
      fileName: "pasted JSON",
      source: "paste",
      total: 3,
    });
    expect(found.cards.map((one) => one.number)).toEqual([1, 3]);
    expect(found.invalid.map((one) => one.number)).toEqual([2]);
  });

  test("a refused file creates nothing", () => {
    const refused = imports.create(USER, deckId, {
      bytes: new TextEncoder().encode("```json\n{}\n```"),
      kind: "paste",
      fileName: "",
    });
    expect(refused).toMatchObject({
      problems: [{ text: expect.stringContaining("Not valid JSON") }],
    });
    expect(hasImports(opened.db, USER)).toBe(false);
  });

  test("into a deleted Deck, an unknown one or another User's, it is not found", () => {
    const bytes = new TextEncoder().encode(fileText([]));
    expect(imports.create(OTHER, deckId, { bytes, kind: "paste", fileName: "" })).toBe("not_found");
    decks.softDelete(USER, deckId);
    expect(imports.create(USER, deckId, { bytes, kind: "paste", fileName: "" })).toBe("not_found");
  });

  test("another User's Import is unknown", () => {
    const id = create(fileText([]));
    expect(imports.find(OTHER, id)).toBeUndefined();
    expect(imports.confirm(OTHER, id, [])).toBe("not_found");
  });

  test("the preview marks Duplicates, plans Macros and names image problems against the Deck now", () => {
    cards.create(USER, deckId, { front: "la cuenta", back: "the bill" });
    const id = create(
      fileText(
        [
          card("el mercado"),
          card("La cuenta"),
          card("el  mercado"),
          card("x", "![](images/no.png)"),
        ],
        [{ name: "\\m", definition: "m." }],
      ),
    );
    const found = preview(id);
    expect(found.cards.map((one) => one.duplicateOf)).toEqual([
      null,
      { cardId: expect.any(String), front: "la cuenta" },
      { number: 1, front: "el mercado" },
      null,
    ]);
    expect(found.macros).toEqual([{ name: "\\m", definition: "m.", outcome: "added" }]);
    expect(found.images.map((one) => [one.card, one.problem])).toEqual([[4, "missing"]]);
  });

  test("a zip's referenced images are staged and served for the preview", () => {
    const id = create(
      makeZip([
        { name: "cards.json", data: fileText([card("a", "![](images/a.png)")]) },
        { name: "images/a.png", data: PNG },
      ]),
    );
    expect(preview(id).stagedImages).toEqual(["a.png"]);
    expect(preview(id).source).toBe("zip");
    expect(imports.stagedImage(USER, id, "a.png")?.contentType).toBe("image/png");
    expect(imports.stagedImage(USER, id, "b.png")).toBeUndefined();
    expect(imports.stagedImage(OTHER, id, "a.png")).toBeUndefined();
    expect(imports.stagedImage(USER, id, "../a.png")).toBeUndefined();
  });
});

describe("confirm", () => {
  test("adds exactly the ticked Cards with their edits, in file order, stamped with the Import", () => {
    const id = create(
      fileText([card("one", "1", { tags: ["B", "a"] }), card("two"), card("three")]),
    );
    const [one, , three] = asRead(id);
    const report = confirm(id, [{ ...one!, back: "edited" }, three!]);

    expect(report).toMatchObject({ status: "confirmed", imported: 2, leftOut: 1, duplicates: [] });
    const added = deckCards().toReversed();
    expect(added.map((c) => [c.front, c.back, c.tags])).toEqual([
      ["one", "edited", ["a", "b"]],
      ["three", "b", []],
    ]);
    // The first is the oldest.
    expect(added[0]!.createdAt < added[1]!.createdAt).toBe(true);
    const stamped = opened.db.values(sql`SELECT import_id FROM card`);
    expect(stamped).toEqual([[id], [id]]);
  });

  test("skips and reports a Card that became a Duplicate since the preview, and the locked ones", () => {
    const id = create(fileText([card("a"), card("b"), card("a")]));
    const ticked = asRead(id, [1, 2]);
    cards.create(USER, deckId, { front: "B", back: "made meanwhile" });
    const report = confirm(id, ticked);
    expect(report.imported).toBe(1);
    expect(report.duplicates).toEqual([
      { number: 2, front: "b" },
      { number: 3, front: "a" },
    ]);
    expect(report.leftOut).toBe(0);
  });

  test("an unticked first Card frees a later one repeating it", () => {
    const id = create(fileText([card("a"), card("a")]));
    const report = confirm(id, asRead(id, [2]));
    expect(report).toMatchObject({ imported: 1, leftOut: 1, duplicates: [] });
  });

  test("two Cards repeating each other, both unticked, are both left out, not Duplicates", () => {
    const id = create(fileText([card("a"), card("a"), card("b")]));
    const report = confirm(id, asRead(id, [3]));
    expect(report).toMatchObject({ imported: 1, leftOut: 2, duplicates: [] });
  });

  test("rewrites a reference's destination, not the same words in its alt text", () => {
    const id = create(
      makeZip([
        { name: "cards.json", data: fileText([card("![see images/a.png)](images/a.png)")]) },
        { name: "images/a.png", data: PNG },
      ]),
    );
    confirm(id, asRead(id));
    const [added] = deckCards();
    expect(added?.front).toMatch(/^!\[see images\/a\.png\)\]\(images\/[\w-]{36}\.png\)$/);
  });

  test("is refused, adding nothing, once confirmed, for a deleted Deck, or for a card not in the file", () => {
    const id = create(fileText([card("a")]));
    expect(imports.confirm(USER, id, [{ number: 9, ...card("z") }])).toBe("unknown_card");
    confirm(id, asRead(id));
    expect(imports.confirm(USER, id, [])).toBe("confirmed");

    const other = create(fileText([card("b")]));
    const ticked = asRead(other);
    decks.softDelete(USER, deckId);
    expect(imports.confirm(USER, other, ticked)).toBe("deck_gone");
    expect(opened.db.values(sql`SELECT front FROM card`)).toEqual([["a"]]);
  });

  test("makes each referenced zip image a new Image, rewriting the references, and drops the rest", () => {
    const existing = createImageRepository(opened.db, uploadsDirOf(tempDir)).store(USER, PNG);
    if (!("reference" in existing)) throw new Error("not stored");
    const id = create(
      makeZip([
        {
          name: "d/cards.json",
          data: fileText([
            card("![](images/a.png)", `x ![](images/a.png) ![](${existing.reference})`, {
              gradingNotes: "![](images/c.png)",
            }),
            card("b", "![](images/b.png)"),
            card("m", "![](images/missing.png)"),
          ]),
        },
        { name: "d/images/a.png", data: PNG },
        { name: "d/images/b.png", data: PNG },
        { name: "d/images/c.png", data: PNG },
      ]),
    );
    const report = confirm(id, asRead(id, [1, 3]));
    expect(report.imageCount).toBe(2);
    expect(report.images.map((one) => [one.card, one.reference])).toEqual([
      [3, "images/missing.png"],
    ]);
    const [first] = deckCards().filter((c) => c.back.startsWith("x"));
    const reference = /images\/([\w-]+\.png)/.exec(first!.front)?.[1];
    expect(reference).not.toBe("a.png");
    expect(first!.back).toBe(`x ![](images/${reference}) ![](${existing.reference})`);
    expect(first!.gradingNotes).toMatch(/^!\[\]\(images\/[\w-]{36}\.png\)$/);
    expect(readdirSync(uploadsDirOf(tempDir))).toHaveLength(3);
    // The staged files go.
    expect(existsSync(join(importsDirOf(tempDir), id))).toBe(false);
    // A Card with an image problem still imports, its reference as written.
    expect(deckCards().find((c) => c.front === "m")?.back).toBe("![](images/missing.png)");
  });

  test("applies the Macro plan to the Deck's own Macros as the Deck is now", () => {
    const id = create(
      fileText(
        [card("a")],
        [
          { name: "\\m", definition: "m." },
          { name: "\\f", definition: "f." },
        ],
      ),
    );
    decks.update(USER, deckId, { macros: [{ name: "\\f", definition: "F" }] });
    const report = confirm(id, asRead(id));
    expect(report.macros).toEqual([
      { name: "\\m", definition: "m.", outcome: "added" },
      { name: "\\f", definition: "f.", outcome: "kept", deckDefinition: "F" },
    ]);
    expect(decks.find(USER, deckId)?.macros).toEqual([
      { name: "\\f", definition: "F" },
      { name: "\\m", definition: "m." },
    ]);
  });

  test("the report stays at its Import, with the invalid Cards", () => {
    const id = create(fileText([card("a"), { front: "x" }]));
    confirm(id, asRead(id));
    expect(imports.find(USER, id)).toMatchObject({
      status: "confirmed",
      total: 2,
      imported: 1,
      invalid: [{ number: 2 }],
      confirmedAt: NOW.toISOString(),
    });
  });
});

describe("sweep", () => {
  test("removes an Import not confirmed within 24 hours, with its files; never a confirmed one", () => {
    const zip = makeZip([
      { name: "cards.json", data: fileText([card("a", "![](images/a.png)")]) },
      { name: "images/a.png", data: PNG },
    ]);
    const old = create(zip, new Date(NOW.getTime() - 25 * HOUR_MS));
    const fresh = create(zip, new Date(NOW.getTime() - 23 * HOUR_MS));
    const done = create(fileText([card("b")]), new Date(NOW.getTime() - 48 * HOUR_MS));
    confirm(done, asRead(done), new Date(NOW.getTime() - 47 * HOUR_MS));
    // A staging folder with no Import, left by a failure, goes too once old.
    const stray = join(importsDirOf(tempDir), "stray");
    mkdirSync(stray);
    const longAgo = new Date(NOW.getTime() - 30 * HOUR_MS);
    utimesSync(stray, longAgo, longAgo);

    expect(imports.sweep(NOW)).toBe(1);
    expect(imports.find(USER, old)).toBeUndefined();
    expect(existsSync(join(importsDirOf(tempDir), old))).toBe(false);
    expect(existsSync(stray)).toBe(false);
    expect(imports.find(USER, fresh)?.status).toBe("unconfirmed");
    expect(existsSync(join(importsDirOf(tempDir), fresh))).toBe(true);
    expect(imports.find(USER, done)?.status).toBe("confirmed");
  });
});
