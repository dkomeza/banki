import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { deck, folder } from "../db/schema";
import { type DeckRepository, createDeckRepository } from "./decks";
import { type FolderRepository, createFolderRepository } from "./folders";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let folders: FolderRepository;
let decks: DeckRepository;

const USER = "user-1";
const OTHER = "user-2";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-folders-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  // Two Users, so scoping shows; Banki has one in practice.
  createUserRepository(opened.db).createWithPassword({
    userId: USER,
    accountId: "a1",
    email: "u@x.y",
    passwordHash: "h",
  });
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${OTHER}, 'n', 'o@x.y', 1, 0, 0)`,
  );
  folders = createFolderRepository(opened.db);
  decks = createDeckRepository(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

/** Creates a Folder and answers its ID. */
const make = (name: string, parentId: string | null = null, userId = USER, now?: Date) => {
  const created = folders.create(userId, { name, parentId }, now === undefined ? {} : { now });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

/** Creates a Deck and answers its ID. */
const deckIn = (name: string, folderId: string | null) => {
  const created = decks.create(USER, { name, description: null, folderId });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

const folderRow = (id: string) => opened.db.select().from(folder).where(eq(folder.id, id)).get();
const deckRow = (id: string) => opened.db.select().from(deck).where(eq(deck.id, id)).get();

describe("create", () => {
  test("creates a Folder at the Root or in a Folder, and answers it", () => {
    const created = folders.create(
      USER,
      { name: "Maths", parentId: null },
      { id: "f1", now: at("2026-10-01T10:00:00.000Z") },
    );

    expect(created).toEqual({
      id: "f1",
      name: "Maths",
      parentId: null,
      createdAt: "2026-10-01T10:00:00.000Z",
    });
    expect(folders.create(USER, { name: "Analysis", parentId: "f1" })).toMatchObject({
      parentId: "f1",
    });
    expect(folders.find(USER, "f1")).toEqual(folders.list(USER)[0]);
  });

  test("refuses a name another Folder beside it has, ignoring case", () => {
    const maths = make("Maths");
    make("Analysis", maths);

    expect(folders.create(USER, { name: "MATHS", parentId: null })).toBe("taken");
    expect(folders.create(USER, { name: "analysis", parentId: maths })).toBe("taken");
  });

  test("takes a name a Folder elsewhere, a deleted Folder, a Deck or another User's Folder has", () => {
    const maths = make("Maths");
    make("Analysis", maths);
    folders.softDelete(USER, make("Gone"));
    deckIn("Spanish", null);
    make("Theirs", null, OTHER);

    for (const name of ["Analysis", "Gone", "Spanish", "Theirs"]) {
      expect(folders.create(USER, { name, parentId: null })).not.toBe("taken");
    }
  });

  test("refuses a parent that is unknown, deleted or another User's", () => {
    const gone = make("Gone");
    folders.softDelete(USER, gone);
    const theirs = make("Theirs", null, OTHER);

    for (const parentId of ["nope", gone, theirs]) {
      expect(folders.create(USER, { name: "A", parentId })).toBe("not_found");
    }
  });

  test("the database refuses two Folders of a name at the Root, despite its NULLs", () => {
    make("Maths");

    expect(() =>
      opened.db
        .insert(folder)
        .values({
          id: "dupe",
          userId: USER,
          parentId: null,
          name: "Maths",
          nameKey: "maths",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).toThrow();
  });
});

describe("list and find", () => {
  test("list the User's live Folders, oldest first, with what the tree and the sorts need", () => {
    const maths = make("Maths", null, USER, at("2026-09-01T00:00:00.000Z"));
    make("Analysis", maths, USER, at("2026-09-02T00:00:00.000Z"));
    folders.softDelete(USER, make("Gone"));
    make("Theirs", null, OTHER);

    expect(
      folders.list(USER).map(({ name, parentId, createdAt }) => [name, parentId, createdAt]),
    ).toEqual([
      ["Maths", null, "2026-09-01T00:00:00.000Z"],
      ["Analysis", maths, "2026-09-02T00:00:00.000Z"],
    ]);
  });

  test("find nothing for an unknown, deleted or another User's Folder", () => {
    const gone = make("Gone");
    folders.softDelete(USER, gone);
    const theirs = make("Theirs", null, OTHER);

    for (const id of ["nope", gone, theirs]) expect(folders.find(USER, id)).toBeUndefined();
  });
});

describe("rename", () => {
  test("renames a Folder, keeping its place and creation time", () => {
    const maths = make("Maths", null, USER, at("2026-09-01T00:00:00.000Z"));

    expect(folders.update(USER, maths, { name: "Mathematics" })).toEqual({
      id: maths,
      name: "Mathematics",
      parentId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });

  test("lets a Folder change the case of its own name", () => {
    const maths = make("maths");

    expect(folders.update(USER, maths, { name: "Maths" })).toMatchObject({ name: "Maths" });
  });

  test("refuses the name of a Folder beside it, but not one elsewhere or deleted", () => {
    const maths = make("Maths");
    make("Analysis", maths);
    folders.softDelete(USER, make("Gone"));
    const other = make("Other");

    expect(folders.update(USER, other, { name: "MATHS" })).toBe("taken");
    expect(folders.update(USER, other, { name: "Analysis" })).toMatchObject({ name: "Analysis" });
    expect(folders.update(USER, other, { name: "Gone" })).toMatchObject({ name: "Gone" });
  });

  test("finds nothing to change for an unknown, deleted or another User's Folder", () => {
    const gone = make("Gone");
    folders.softDelete(USER, gone);
    const theirs = make("Theirs", null, OTHER);

    for (const id of ["nope", gone, theirs]) {
      expect(folders.update(USER, id, { name: "x" })).toBe("not_found");
    }
    expect(folders.find(OTHER, theirs)?.name).toBe("Theirs");
  });
});

describe("move", () => {
  test("moves a Folder, with everything in it, into another and back to the Root", () => {
    const maths = make("Maths");
    const analysis = make("Analysis");
    const calculus = deckIn("Calculus", analysis);

    expect(folders.update(USER, analysis, { parentId: maths })).toMatchObject({ parentId: maths });
    expect(decks.find(USER, calculus)?.folderId).toBe(analysis);
    expect(folders.update(USER, analysis, { parentId: null })).toMatchObject({ parentId: null });
  });

  test("refuses the Folder itself or one inside it", () => {
    const maths = make("Maths");
    const analysis = make("Analysis", maths);
    const real = make("Real analysis", analysis);

    expect(folders.update(USER, maths, { parentId: maths })).toBe("invalid_move");
    expect(folders.update(USER, maths, { parentId: analysis })).toBe("invalid_move");
    expect(folders.update(USER, maths, { parentId: real })).toBe("invalid_move");
    expect(folders.find(USER, maths)?.parentId).toBeNull();
  });

  test("refuses a destination that is unknown, deleted or another User's", () => {
    const gone = make("Gone");
    folders.softDelete(USER, gone);
    const theirs = make("Theirs", null, OTHER);
    const maths = make("Maths");

    for (const parentId of ["nope", gone, theirs]) {
      expect(folders.update(USER, maths, { parentId })).toBe("not_found");
    }
  });

  test("a move to where it is already is no move, and no clash", () => {
    const maths = make("Maths");

    expect(folders.update(USER, maths, { parentId: null })).toMatchObject({ parentId: null });
  });

  test("answers the clash with a Folder of the name at the destination, moving nothing", () => {
    const archive = make("Archive");
    const there = make("Analysis", archive);
    const maths = make("Maths");
    const moved = make("ANALYSIS", maths);

    expect(folders.update(USER, moved, { parentId: archive })).toEqual({
      clash: { id: there, name: "Analysis", replaceAllowed: true },
    });
    expect(folders.find(USER, moved)?.parentId).toBe(maths);
  });

  test("Replace deletes the other Folder with everything in it, as its own Deletion, and moves this one in", () => {
    const archive = make("Archive");
    const there = make("Analysis", archive);
    const inside = make("Inside", there);
    const deckThere = deckIn("Calculus", inside);
    const moved = make("Analysis");

    expect(folders.update(USER, moved, { parentId: archive, onClash: "replace" })).toMatchObject({
      name: "Analysis",
      parentId: archive,
    });
    for (const id of [there, inside]) expect(folders.find(USER, id)).toBeUndefined();
    expect(decks.find(USER, deckThere)).toBeUndefined();
    const deletion = folderRow(there)?.deletionId;
    expect(deletion).toEqual(expect.any(String));
    expect(folderRow(inside)?.deletionId).toBe(deletion);
    expect(deckRow(deckThere)?.deletionId).toBe(deletion);
    expect(folderRow(moved)?.deletionId).toBeNull();
  });

  test("Replace isn't allowed when the clashing Folder holds the moved one", () => {
    const bio = make("Bio");
    const x = make("X", bio);
    const innerBio = make("Bio", x);

    expect(folders.update(USER, innerBio, { parentId: null })).toEqual({
      clash: { id: bio, name: "Bio", replaceAllowed: false },
    });
    expect(folders.update(USER, innerBio, { parentId: null, onClash: "replace" })).toBe(
      "replace_not_allowed",
    );
    expect(folders.find(USER, bio)).toBeDefined();
    expect(folders.find(USER, innerBio)?.parentId).toBe(x);
  });

  test("Keep both moves it in as the next free Name (n), within 100 characters", () => {
    const archive = make("Archive");
    make("Cells", archive);
    make("Cells (2)", archive);
    const moved = make("Cells");
    const long = "a".repeat(100);
    make(long, archive);
    const movedLong = make(long);

    expect(folders.update(USER, moved, { parentId: archive, onClash: "keepBoth" })).toMatchObject({
      name: "Cells (3)",
      parentId: archive,
    });
    expect(
      folders.update(USER, movedLong, { parentId: archive, onClash: "keepBoth" }),
    ).toMatchObject({ name: `${"a".repeat(96)} (2)` });
  });

  test("a rename and a move together clash on the new name at the destination", () => {
    const archive = make("Archive");
    make("Old", archive);
    const moved = make("Maths");

    expect(folders.update(USER, moved, { name: "old", parentId: archive })).toMatchObject({
      clash: { name: "Old" },
    });
  });
});

describe("softDelete", () => {
  test("deletes a Folder and everything inside it, with one deletedAt and one deletion ID", () => {
    const maths = make("Maths");
    const analysis = make("Analysis", maths);
    const calculus = deckIn("Calculus", analysis);
    const algebra = deckIn("Algebra", maths);
    const kept = deckIn("Spanish", null);
    const now = at("2026-10-20T12:00:00.000Z");

    expect(folders.softDelete(USER, maths, now)).toBeString();

    const rows = [folderRow(maths), folderRow(analysis), deckRow(calculus), deckRow(algebra)];
    for (const row of rows) expect(row?.deletedAt).toEqual(now);
    expect(new Set(rows.map((row) => row?.deletionId)).size).toBe(1);
    expect(rows[0]?.deletionId).toEqual(expect.any(String));
    expect(deckRow(kept)?.deletedAt).toBeNull();
    expect(folders.list(USER)).toEqual([]);
    expect(decks.list(USER).map((d) => d.name)).toEqual(["Spanish"]);
  });

  test("leaves what was deleted earlier with its own deletion", () => {
    const maths = make("Maths");
    const old = make("Old", maths);
    const oldDeck = deckIn("Old deck", maths);
    const earlier = at("2026-10-01T00:00:00.000Z");
    folders.softDelete(USER, old, earlier);
    decks.softDelete(USER, oldDeck, earlier);
    const before = [folderRow(old)?.deletionId, deckRow(oldDeck)?.deletionId];

    folders.softDelete(USER, maths, at("2026-10-20T00:00:00.000Z"));

    expect([folderRow(old)?.deletionId, deckRow(oldDeck)?.deletionId]).toEqual(before);
    expect(folderRow(old)?.deletedAt).toEqual(earlier);
    expect(folderRow(maths)?.deletionId).not.toBe(before[0]);
  });

  test("deletes nothing for an unknown, already deleted or another User's Folder", () => {
    const gone = make("Gone");
    folders.softDelete(USER, gone);
    const theirs = make("Theirs", null, OTHER);

    for (const id of ["nope", gone, theirs]) expect(folders.softDelete(USER, id)).toBeUndefined();
    expect(folders.find(OTHER, theirs)).toBeDefined();
  });

  test("frees the names of what it deleted", () => {
    const maths = make("Maths");
    folders.softDelete(USER, maths);

    expect(folders.create(USER, { name: "Maths", parentId: null })).not.toBe("taken");
  });
});

describe("any", () => {
  test("counts deleted Folders too, and only the User's", () => {
    make("Theirs", null, OTHER);
    expect(folders.any(USER)).toBe(false);

    folders.softDelete(USER, make("Gone"));

    expect(folders.any(USER)).toBe(true);
  });
});
