import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { type OpenedDatabase, importsDirOf, openDatabase, uploadsDirOf } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { card, card_import, deck, folder } from "../db/schema";
import { type CardRepository, createCardRepository } from "./cards";
import { type DeckRepository, createDeckRepository } from "./decks";
import { type DeletionRepository, createDeletionRepository } from "./deletions";
import { type FolderRepository, createFolderRepository } from "./folders";
import { createImportRepository } from "./imports";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let cards: CardRepository;
let decks: DeckRepository;
let folders: FolderRepository;
let deletions: DeletionRepository;

const USER = "user-1";
const OTHER = "user-2";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-deletions-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  // Two Users, so scoping shows; Banki has one in practice.
  const users = createUserRepository(opened.db);
  users.createWithPassword({ userId: USER, accountId: "a1", email: "u@x.y", passwordHash: "h" });
  opened.db.run(
    // createWithPassword refuses a second User, so the other one goes in directly.
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${OTHER}, 'n', 'o@x.y', 1, 0, 0)`,
  );
  cards = createCardRepository(opened.db);
  decks = createDeckRepository(opened.db);
  folders = createFolderRepository(opened.db);
  deletions = createDeletionRepository(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const DAY_MS = 24 * 60 * 60 * 1000;

const makeFolder = (name: string, parentId: string | null = null, userId = USER) => {
  const created = folders.create(userId, { name, parentId });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

const makeDeck = (name: string, folderId: string | null = null, userId = USER, now?: Date) => {
  const created = decks.create(
    userId,
    { name, description: null, folderId },
    now === undefined ? {} : { now },
  );
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

const write = (deckId: string, front: string, userId = USER) => {
  const created = cards.create(userId, deckId, { front, back: "b" });
  if (typeof created === "string") throw new Error(`${front}: ${created}`);
  return created.id;
};

const deleted = (id: string | undefined) => {
  if (id === undefined) throw new Error("Nothing was deleted");
  return id;
};

const folderRow = (id: string) => opened.db.select().from(folder).where(eq(folder.id, id)).get();
const deckRow = (id: string) => opened.db.select().from(deck).where(eq(deck.id, id)).get();
const cardRow = (id: string) => opened.db.select().from(card).where(eq(card.id, id)).get();
const importRow = (id: string) =>
  opened.db.select().from(card_import).where(eq(card_import.id, id)).get();

describe("list", () => {
  test("lists one entry per Deletion, newest first, with its top item, where it was and what went with it", () => {
    const maths = makeFolder("Maths");
    const analysis = makeFolder("Analysis", maths);
    const calculus = makeDeck("Calculus", analysis);
    write(calculus, "c1");
    write(calculus, "c2");
    const algebra = makeDeck("Algebra", maths);
    write(algebra, "a1");
    const languages = makeFolder("Languages");
    const spanish = makeDeck("Spanish", languages);
    write(spanish, "s1");
    const lone = write(spanish, "la madrugada\nthe small hours");

    const cardDeletion = deleted(cards.softDelete(USER, lone, at("2026-10-01T00:00:00.000Z")));
    const deckDeletion = deleted(decks.softDelete(USER, spanish, at("2026-10-02T00:00:00.000Z")));
    const folderDeletion = deleted(folders.softDelete(USER, maths, at("2026-10-03T00:00:00.000Z")));

    expect(deletions.list(USER)).toEqual([
      {
        id: folderDeletion,
        deletedAt: "2026-10-03T00:00:00.000Z",
        removesAt: "2026-11-02T00:00:00.000Z",
        top: { kind: "folder", id: maths, name: "Maths" },
        path: [],
        deck: null,
        counts: { folders: 1, decks: 2, cards: 3 },
      },
      {
        id: deckDeletion,
        deletedAt: "2026-10-02T00:00:00.000Z",
        removesAt: "2026-11-01T00:00:00.000Z",
        top: { kind: "deck", id: spanish, name: "Spanish" },
        path: ["Languages"],
        deck: null,
        counts: { folders: 0, decks: 0, cards: 1 },
      },
      {
        id: cardDeletion,
        deletedAt: "2026-10-01T00:00:00.000Z",
        removesAt: "2026-10-31T00:00:00.000Z",
        top: { kind: "card", id: lone, name: "la madrugada\nthe small hours" },
        path: null,
        deck: { id: spanish, name: "Spanish", macros: [] },
        counts: { folders: 0, decks: 0, cards: 0 },
      },
    ]);
  });

  test("gives a Card's Deck with its own Macros, kept once that Deck is deleted too", () => {
    const calculus = makeDeck("Calculus 2");
    const d = { name: "\\d", definition: "\\mathrm{d}" };
    decks.update(USER, calculus, { macros: [d] });
    const lone = write(calculus, "$\\d x$");
    cards.softDelete(USER, lone, at("2026-10-01T00:00:00.000Z"));
    decks.softDelete(USER, calculus, at("2026-10-02T00:00:00.000Z"));

    const listed = deletions.list(USER).find((entry) => entry.top.kind === "card");

    expect(listed?.deck).toEqual({ id: calculus, name: "Calculus 2", macros: [d] });
  });

  test("gives a Deck or Folder deep inside its whole Folder path, deleted Folders too", () => {
    const maths = makeFolder("Maths");
    const analysis = makeFolder("Analysis", maths);
    const calculus = makeDeck("Calculus 1", analysis);
    decks.softDelete(USER, calculus, at("2026-10-01T00:00:00.000Z"));
    folders.softDelete(USER, maths, at("2026-10-02T00:00:00.000Z"));

    expect(deletions.list(USER).map((d) => [d.top.name, d.path])).toEqual([
      ["Maths", []],
      ["Calculus 1", ["Maths", "Analysis"]],
    ]);
  });

  test("lists something deleted on its own before its Folder as an entry of its own, not counted with the Folder", () => {
    const maths = makeFolder("Maths");
    const stats = makeDeck("Statistics", maths);
    write(stats, "s1");
    makeDeck("Algebra", maths);
    decks.softDelete(USER, stats, at("2026-10-01T00:00:00.000Z"));
    folders.softDelete(USER, maths, at("2026-10-02T00:00:00.000Z"));

    const listed = deletions.list(USER);
    expect(listed.map((d) => [d.top.name, d.counts])).toEqual([
      ["Maths", { folders: 0, decks: 1, cards: 0 }],
      ["Statistics", { folders: 0, decks: 0, cards: 1 }],
    ]);
  });

  test("lists nothing restored, nothing live, and nothing of another User's", () => {
    const deckId = makeDeck("Live");
    write(deckId, "live");
    const theirs = makeDeck("Theirs", null, OTHER);
    decks.softDelete(OTHER, theirs);
    const restored = deleted(decks.softDelete(USER, makeDeck("Back")));
    deletions.restore(USER, restored);

    expect(deletions.list(USER)).toEqual([]);
  });
});

describe("restore", () => {
  test("brings the whole Deletion back where it was, keeping createdAt and setting updatedAt", () => {
    const maths = makeFolder("Maths");
    const analysis = makeFolder("Analysis", maths);
    const calculus = makeDeck("Calculus", analysis, USER, at("2026-09-01T00:00:00.000Z"));
    const c1 = write(calculus, "c1");
    const id = deleted(folders.softDelete(USER, maths, at("2026-10-01T00:00:00.000Z")));
    const now = at("2026-10-02T00:00:00.000Z");

    expect(deletions.restore(USER, id, now)).toEqual({
      kind: "folder",
      id: maths,
      name: "Maths",
      movedToRoot: false,
      renamed: false,
    });

    for (const row of [folderRow(maths), folderRow(analysis), deckRow(calculus), cardRow(c1)]) {
      expect(row).toMatchObject({ deletedAt: null, deletionId: null, updatedAt: now });
    }
    expect(folderRow(analysis)?.parentId).toBe(maths);
    expect(deckRow(calculus)).toMatchObject({
      folderId: analysis,
      createdAt: at("2026-09-01T00:00:00.000Z"),
    });
    expect(deletions.list(USER)).toEqual([]);
  });

  test("leaves what was deleted on its own before inside deleted, with its own entry", () => {
    const maths = makeFolder("Maths");
    const stats = makeDeck("Statistics", maths);
    const algebra = makeDeck("Algebra", maths);
    const a1 = write(algebra, "a1");
    const alone = write(algebra, "alone");
    const statsDeletion = deleted(decks.softDelete(USER, stats, at("2026-10-01T00:00:00.000Z")));
    const cardDeletion = deleted(cards.softDelete(USER, alone, at("2026-10-02T00:00:00.000Z")));
    const id = deleted(folders.softDelete(USER, maths, at("2026-10-03T00:00:00.000Z")));

    deletions.restore(USER, id);

    expect(deckRow(algebra)?.deletedAt).toBeNull();
    expect(cardRow(a1)?.deletedAt).toBeNull();
    expect(deckRow(stats)?.deletionId).toBe(statsDeletion);
    expect(cardRow(alone)?.deletionId).toBe(cardDeletion);
    expect(deletions.list(USER).map((d) => d.id)).toEqual([cardDeletion, statsDeletion]);
  });

  test("restores nothing inside a Deletion on its own: only the whole Deletion has an ID", () => {
    const maths = makeFolder("Maths");
    const stats = makeDeck("Statistics", maths);
    const s1 = write(stats, "s1");
    folders.softDelete(USER, maths);

    for (const id of [stats, s1, maths]) expect(deletions.restore(USER, id)).toBe("not_found");
    expect(deckRow(stats)?.deletedAt).not.toBeNull();
  });

  test("brings a Deck or Folder whose Folder is deleted back at the Root", () => {
    const old = makeFolder("Old semester");
    const linear = makeDeck("Linear algebra", old);
    const inner = makeFolder("Inner", old);
    const deckDeletion = deleted(decks.softDelete(USER, linear));
    const folderDeletion = deleted(folders.softDelete(USER, inner));
    folders.softDelete(USER, old);

    expect(deletions.restore(USER, deckDeletion)).toMatchObject({
      name: "Linear algebra",
      movedToRoot: true,
      renamed: false,
    });
    expect(deletions.restore(USER, folderDeletion)).toMatchObject({ movedToRoot: true });
    expect(deckRow(linear)?.folderId).toBeNull();
    expect(folderRow(inner)?.parentId).toBeNull();
  });

  test("brings a Deck or Folder whose name is taken beside it back as the next free Name (n)", () => {
    const languages = makeFolder("Languages");
    const spanish = makeDeck("Spanish vocabulary", languages);
    const id = deleted(decks.softDelete(USER, spanish));
    makeDeck("Spanish vocabulary", languages);
    makeDeck("spanish VOCABULARY (2)", languages);
    const maths = makeFolder("Maths");
    const folderDeletion = deleted(folders.softDelete(USER, maths));
    makeFolder("Maths");

    expect(deletions.restore(USER, id)).toMatchObject({
      name: "Spanish vocabulary (3)",
      renamed: true,
      movedToRoot: false,
    });
    expect(deckRow(spanish)).toMatchObject({ name: "Spanish vocabulary (3)", folderId: languages });
    expect(deletions.restore(USER, folderDeletion)).toMatchObject({
      name: "Maths (2)",
      renamed: true,
    });
  });

  test("checks the name where it comes back: a Root fallback clashes with what's at the Root", () => {
    const old = makeFolder("Old");
    const linear = makeDeck("Linear algebra", old);
    const id = deleted(decks.softDelete(USER, linear));
    folders.softDelete(USER, old);
    makeDeck("Linear algebra");

    expect(deletions.restore(USER, id)).toMatchObject({
      name: "Linear algebra (2)",
      movedToRoot: true,
      renamed: true,
    });
  });

  test("keeps a renamed name within 100 characters", () => {
    const long = "x".repeat(100);
    const id = deleted(decks.softDelete(USER, makeDeck(long)));
    makeDeck(long);

    const restored = deletions.restore(USER, id);
    if (typeof restored === "string" || "placeDeleted" in restored) throw new Error("refused");
    expect(restored.name).toBe(`${"x".repeat(96)} (2)`);
  });

  test("brings a Card deleted on its own back into its Deck", () => {
    const spanish = makeDeck("Spanish");
    const c = write(spanish, "la madrugada");
    const id = deleted(cards.softDelete(USER, c));

    expect(deletions.restore(USER, id)).toEqual({
      kind: "card",
      id: c,
      name: "la madrugada",
      movedToRoot: false,
      renamed: false,
    });
    expect(cardRow(c)?.deletedAt).toBeNull();
  });

  test("refuses a Card whose Deck is deleted, naming the Deck", () => {
    const german = makeDeck("German verbs");
    const termin = write(german, "der Termin");
    const id = deleted(cards.softDelete(USER, termin));
    decks.softDelete(USER, german);

    expect(deletions.restore(USER, id)).toEqual({
      placeDeleted: { id: german, name: "German verbs" },
    });
    expect(cardRow(termin)?.deletedAt).not.toBeNull();
  });

  test("answers not_found for an unknown Deletion, one restored already and another User's", () => {
    const id = deleted(decks.softDelete(USER, makeDeck("Spanish")));
    deletions.restore(USER, id);
    const theirs = deleted(decks.softDelete(OTHER, makeDeck("Theirs", null, OTHER)));

    for (const unknown of ["nope", id, theirs]) {
      expect(deletions.restore(USER, unknown)).toBe("not_found");
    }
    expect(deletions.list(OTHER).map((d) => d.id)).toEqual([theirs]);
  });
});

/** Deletes the Cards at once, each as a Deletion of its own, and answers their IDs. */
const deleteAll = (ids: string[]) => {
  const done = cards.softDeleteAll(USER, ids);
  if (done === "not_found") throw new Error("Nothing was deleted");
  return done.map((d) => d.deletionId);
};

describe("restoreAll", () => {
  test("restores every Deletion together, answering each", () => {
    const deckId = makeDeck("Spanish");
    const one = write(deckId, "one");
    const two = write(deckId, "two");
    const ids = deleteAll([one, two]);

    expect(deletions.restoreAll(USER, ids)).toEqual([
      { kind: "card", id: one, name: "one", movedToRoot: false, renamed: false },
      { kind: "card", id: two, name: "two", movedToRoot: false, renamed: false },
    ]);
    expect(cardRow(one)?.deletedAt).toBeNull();
    expect(cardRow(two)?.deletedAt).toBeNull();
    expect(deletions.list(USER)).toEqual([]);
  });

  test("restores none when one is gone already, answering not_found", () => {
    const deckId = makeDeck("Spanish");
    const one = write(deckId, "one");
    const two = write(deckId, "two");
    const [first, second] = deleteAll([one, two]);
    if (first === undefined || second === undefined) throw new Error("Expected two Deletions");
    deletions.remove(USER, second);

    expect(deletions.restoreAll(USER, [first, second])).toBe("not_found");
    expect(cardRow(one)?.deletedAt).not.toBeNull();
    expect(deletions.restoreAll(USER, [first, "nope"])).toBe("not_found");
    expect(cardRow(one)?.deletedAt).not.toBeNull();
  });

  test("restores none while the Cards' Deck is deleted, naming it", () => {
    const deckId = makeDeck("Spanish");
    const ids = deleteAll([write(deckId, "one"), write(deckId, "two")]);
    decks.softDelete(USER, deckId);

    expect(deletions.restoreAll(USER, ids)).toEqual({
      placeDeleted: { id: deckId, name: "Spanish" },
    });
    expect(deletions.list(USER).filter((d) => d.top.kind === "card")).toHaveLength(2);
  });

  test("doesn't restore another User's Deletions", () => {
    const theirs = write(makeDeck("Theirs", null, OTHER), "theirs", OTHER);
    const id = deleted(cards.softDelete(OTHER, theirs));

    expect(deletions.restoreAll(USER, [id])).toBe("not_found");
    expect(cardRow(theirs)?.deletedAt).not.toBeNull();
  });
});

describe("remove", () => {
  test("deletes the Deletion's rows for good, Cards first, and nothing else", () => {
    const maths = makeFolder("Maths");
    const analysis = makeFolder("Analysis", maths);
    const calculus = makeDeck("Calculus", analysis);
    const c1 = write(calculus, "c1");
    const live = makeDeck("Live");
    const l1 = write(live, "l1");
    const id = deleted(folders.softDelete(USER, maths));

    expect(deletions.remove(USER, id)).toBe(true);

    expect(folderRow(maths)).toBeUndefined();
    expect(folderRow(analysis)).toBeUndefined();
    expect(deckRow(calculus)).toBeUndefined();
    expect(cardRow(c1)).toBeUndefined();
    expect(deckRow(live)).toBeDefined();
    expect(cardRow(l1)).toBeDefined();
    expect(deletions.list(USER)).toEqual([]);
  });

  test("keeps a Deck or Folder deleted on its own inside a removed Folder, now at the Root", () => {
    const old = makeFolder("Old semester");
    const linear = makeDeck("Linear algebra", old);
    const l1 = write(linear, "l1");
    const inner = makeFolder("Inner", old);
    const deckDeletion = deleted(decks.softDelete(USER, linear));
    const folderDeletion = deleted(folders.softDelete(USER, inner));
    const id = deleted(folders.softDelete(USER, old));

    deletions.remove(USER, id);

    expect(deckRow(linear)).toMatchObject({ folderId: null, deletionId: deckDeletion });
    expect(cardRow(l1)?.deletionId).toBe(deckDeletion);
    expect(folderRow(inner)).toMatchObject({ parentId: null, deletionId: folderDeletion });
    expect(deletions.restore(USER, deckDeletion)).toMatchObject({ movedToRoot: false });
  });

  test("takes a Card deleted on its own from a removed Deck with it: it could never come back", () => {
    const german = makeDeck("German verbs");
    const termin = write(german, "der Termin");
    const other = makeDeck("Other");
    const kept = write(other, "kept");
    cards.softDelete(USER, termin);
    const keptDeletion = deleted(cards.softDelete(USER, kept));
    const id = deleted(decks.softDelete(USER, german));

    deletions.remove(USER, id);

    expect(cardRow(termin)).toBeUndefined();
    expect(deletions.list(USER).map((d) => d.id)).toEqual([keptDeletion]);
  });

  test("answers false for an unknown Deletion, one removed already and another User's", () => {
    const id = deleted(decks.softDelete(USER, makeDeck("Spanish")));
    deletions.remove(USER, id);
    const theirDeck = makeDeck("Theirs", null, OTHER);
    const theirs = deleted(decks.softDelete(OTHER, theirDeck));

    for (const unknown of ["nope", id, theirs]) expect(deletions.remove(USER, unknown)).toBe(false);
    expect(deckRow(theirDeck)).toBeDefined();
  });
});

describe("removeExpired", () => {
  test("removes a Deletion 30 × 24 h after it, and not a moment before", () => {
    const deletedAt = at("2026-10-01T12:00:00.000Z");
    const due = makeDeck("Due");
    const dueCard = write(due, "d1");
    decks.softDelete(USER, due, deletedAt);
    const younger = makeDeck("Younger");
    decks.softDelete(USER, younger, new Date(deletedAt.getTime() + 1));
    const theirs = makeDeck("Theirs", null, OTHER);
    decks.softDelete(OTHER, theirs, deletedAt);
    const live = makeDeck("Live", null, USER, at("2026-01-01T00:00:00.000Z"));

    const edge = new Date(deletedAt.getTime() + 30 * DAY_MS);
    expect(deletions.removeExpired(new Date(edge.getTime() - 1))).toBe(0);
    expect(deletions.removeExpired(edge)).toBe(2);

    expect(deckRow(due)).toBeUndefined();
    expect(cardRow(dueCard)).toBeUndefined();
    expect(deckRow(theirs)).toBeUndefined();
    expect(deckRow(younger)).toBeDefined();
    expect(deckRow(live)).toBeDefined();
  });

  test("removes what was deleted on its own inside a Folder before the Folder's own Deletion", () => {
    const maths = makeFolder("Maths");
    const stats = makeDeck("Statistics", maths);
    const s1 = write(stats, "s1");
    const statsDeletion = deleted(decks.softDelete(USER, stats, at("2026-09-01T00:00:00.000Z")));
    folders.softDelete(USER, maths, at("2026-09-20T00:00:00.000Z"));

    expect(deletions.removeExpired(at("2026-10-05T00:00:00.000Z"))).toBe(1);
    expect(deckRow(stats)).toBeUndefined();
    expect(cardRow(s1)).toBeUndefined();
    expect(folderRow(maths)?.deletedAt).not.toBeNull();
    expect(deletions.list(USER).map((d) => d.id)).not.toContain(statsDeletion);
  });
});

describe("an Import's Undo", () => {
  const NOW = at("2026-10-26T12:00:00.000Z");

  /** Confirms an Import of `fronts` into `deckId` and undoes it as `deletionId`. */
  const undoneImport = (deckId: string, fronts: string[], deletionId = "undo") => {
    const imports = createImportRepository(opened.db, importsDirOf(tempDir), uploadsDirOf(tempDir));
    const text = JSON.stringify({
      $schema: null,
      format: "banki",
      version: 1,
      macros: [],
      cards: fronts.map((front) => ({ front, back: "b", tags: [], gradingNotes: null })),
    });
    const created = imports.create(USER, deckId, {
      bytes: new TextEncoder().encode(text),
      kind: "file",
      fileName: "words.json",
    });
    if (created === "not_found" || "problems" in created) throw new Error("not created");
    const found = imports.find(USER, created.id);
    if (found?.status !== "unconfirmed") throw new Error("not a preview");
    imports.confirm(
      USER,
      created.id,
      found.cards.map((one) => {
        const { duplicateOf: _, ...read } = one;
        return read;
      }),
      { now: new Date(NOW.getTime() - DAY_MS) },
    );
    const cardIds = opened.db
      .select({ id: card.id })
      .from(card)
      .where(eq(card.importId, created.id))
      .all()
      .map((row) => row.id);
    return {
      imports,
      importId: created.id,
      cardIds,
      undo: () => imports.undo(USER, created.id, { now: NOW, deletionId }),
    };
  };

  test("is one entry of kind Import, named by its file, with its Deck and every Card it took", () => {
    const spanish = makeDeck("Spanish");
    const { importId, undo } = undoneImport(spanish, ["a", "b", "c"]);
    undo();

    expect(deletions.list(USER)).toEqual([
      {
        id: "undo",
        deletedAt: NOW.toISOString(),
        removesAt: new Date(NOW.getTime() + 30 * DAY_MS).toISOString(),
        top: { kind: "import", id: importId, name: "words.json" },
        path: null,
        deck: { id: spanish, name: "Spanish", macros: [] },
        counts: { folders: 0, decks: 0, cards: 3 },
      },
    ]);
  });

  test("of a single Card is still the Import, not a lone Card", () => {
    const spanish = makeDeck("Spanish");
    const { importId, undo } = undoneImport(spanish, ["a"]);
    undo();
    expect(deletions.list(USER)[0]?.top).toEqual({
      kind: "import",
      id: importId,
      name: "words.json",
    });
    expect(deletions.restore(USER, "undo")).toMatchObject({ kind: "import", id: importId });
  });

  test("restores every Card where it is now, keeping createdAt, and clears the Import's Undo", () => {
    const spanish = makeDeck("Spanish");
    const other = makeDeck("Other");
    const { importId, cardIds, undo } = undoneImport(spanish, ["a", "b"]);
    cards.move(USER, [cardIds[0]!], other);
    const before = cardIds.map((id) => cardRow(id)?.createdAt);
    undo();

    expect(deletions.restore(USER, "undo")).toEqual({
      kind: "import",
      id: importId,
      name: "words.json",
      movedToRoot: false,
      renamed: false,
    });
    expect(cardIds.map((id) => [cardRow(id)?.deletedAt, cardRow(id)?.deletionId])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(cardIds.map((id) => cardRow(id)?.createdAt)).toEqual(before);
    expect(cardRow(cardIds[0]!)?.deckId).toBe(other);
    expect(importRow(importId)).toMatchObject({ undoneAt: null, undoDeletionId: null });
    expect(deletions.list(USER)).toEqual([]);
  });

  test("refuses a Restore while a Deck one of its Cards is in is deleted, naming that Deck", () => {
    const spanish = makeDeck("Spanish");
    const other = makeDeck("Other");
    const { importId, cardIds, undo } = undoneImport(spanish, ["a", "b"]);
    cards.move(USER, [cardIds[0]!], other);
    undo();
    decks.softDelete(USER, other);

    expect(deletions.restore(USER, "undo")).toEqual({ placeDeleted: { id: other, name: "Other" } });
    expect(cardIds.map((id) => cardRow(id)?.deletionId)).toEqual(["undo", "undo"]);
    expect(importRow(importId)).toMatchObject({ undoDeletionId: "undo" });
  });

  test("Delete permanently and the 30-day Removal remove its Cards, and keep the Import still undone", () => {
    const spanish = makeDeck("Spanish");
    const first = undoneImport(spanish, ["a", "b"], "first");
    first.undo();
    expect(deletions.remove(USER, "first")).toBe(true);
    expect(first.cardIds.map(cardRow)).toEqual([undefined, undefined]);
    expect(first.imports.find(USER, first.importId)).toMatchObject({
      status: "confirmed",
      imported: 2,
      live: 0,
      undoneAt: NOW.toISOString(),
      undoDeletionId: "first",
    });

    // Gone, its Deletion can't be restored or removed again, and the Import stays undone.
    expect(deletions.restore(USER, "first")).toBe("not_found");
    expect(deletions.remove(USER, "first")).toBe(false);
    expect(importRow(first.importId)).toMatchObject({ undoDeletionId: "first" });

    const second = undoneImport(spanish, ["c"], "second");
    second.undo();
    expect(deletions.removeExpired(new Date(NOW.getTime() + 30 * DAY_MS))).toBe(1);
    expect(second.cardIds.map(cardRow)).toEqual([undefined]);
    expect(importRow(second.importId)).toMatchObject({ undoneAt: NOW, undoDeletionId: "second" });
    expect(deletions.list(USER)).toEqual([]);
  });
});
