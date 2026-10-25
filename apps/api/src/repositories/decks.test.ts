import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { deck } from "../db/schema";
import { type DeckRepository, createDeckRepository } from "./decks";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let decks: DeckRepository;

const USER = "user-1";
const OTHER = "user-2";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-decks-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  // Two Users, so scoping shows; Banki has one in practice.
  const users = createUserRepository(opened.db);
  users.createWithPassword({ userId: USER, accountId: "a1", email: "u@x.y", passwordHash: "h" });
  opened.db.run(
    // createWithPassword refuses a second User, so the other one goes in directly.
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${OTHER}, 'n', 'o@x.y', 1, 0, 0)`,
  );
  decks = createDeckRepository(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

const create = (name: string, description: string | null = null, now?: Date, userId = USER) => {
  const created = decks.create(userId, { name, description }, now === undefined ? {} : { now });
  if (created === "taken") throw new Error(`${name} is taken`);
  return created;
};

describe("create", () => {
  test("creates a Deck and answers it, with its creation time", () => {
    const created = decks.create(
      USER,
      { name: "Spanish", description: "Line one\nLine two" },
      { id: "deck-1", now: at("2026-10-01T10:00:00.000Z") },
    );

    expect(created).toEqual({
      id: "deck-1",
      name: "Spanish",
      description: "Line one\nLine two",
      createdAt: "2026-10-01T10:00:00.000Z",
    });
    expect(decks.find(USER, "deck-1")).toEqual(created as never);
  });

  test("gives each Deck its own ID", () => {
    expect(create("A").id).not.toBe(create("B").id);
  });

  test("refuses a name another Deck has, ignoring case", () => {
    create("Calculus 2");

    expect(decks.create(USER, { name: "calculus 2", description: null })).toBe("taken");
    expect(decks.create(USER, { name: "CALCULUS 2", description: null })).toBe("taken");
    expect(decks.list(USER)).toHaveLength(1);
  });

  test("takes a name only a deleted Deck has", () => {
    const old = create("Calculus 2");
    decks.softDelete(USER, old.id);

    expect(decks.create(USER, { name: "calculus 2", description: null })).not.toBe("taken");
  });

  test("takes a name another User's Deck has", () => {
    create("Spanish", null, undefined, OTHER);

    expect(decks.create(USER, { name: "Spanish", description: null })).not.toBe("taken");
  });

  test("the database refuses a taken name too, should a write skip the check", () => {
    create("Spanish");

    expect(() =>
      opened.db
        .insert(deck)
        .values({
          id: "dupe",
          userId: USER,
          name: "SPANISH",
          nameKey: "spanish",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).toThrow();
  });
});

describe("list", () => {
  test("lists the User's Decks that aren't deleted, with what both sorts need", () => {
    create("Older", "about", at("2026-09-01T00:00:00.000Z"));
    const gone = create("Gone", null, at("2026-09-15T00:00:00.000Z"));
    create("Newer", null, at("2026-10-01T00:00:00.000Z"));
    create("Someone else's", null, undefined, OTHER);
    decks.softDelete(USER, gone.id);

    expect(
      decks.list(USER).map(({ name, description, createdAt }) => [name, description, createdAt]),
    ).toEqual([
      ["Older", "about", "2026-09-01T00:00:00.000Z"],
      ["Newer", null, "2026-10-01T00:00:00.000Z"],
    ]);
  });

  test("is empty for a User without Decks", () => {
    expect(decks.list(USER)).toEqual([]);
  });
});

describe("find", () => {
  test("finds nothing for an unknown, deleted or another User's Deck", () => {
    const gone = create("Gone");
    decks.softDelete(USER, gone.id);
    const theirs = create("Theirs", null, undefined, OTHER);

    expect(decks.find(USER, "nope")).toBeUndefined();
    expect(decks.find(USER, gone.id)).toBeUndefined();
    expect(decks.find(USER, theirs.id)).toBeUndefined();
  });
});

describe("update", () => {
  test("changes the name and the description, keeping the creation time", () => {
    const created = create("Spanish", "old", at("2026-09-01T00:00:00.000Z"));

    expect(decks.update(USER, created.id, { name: "Spanish B1", description: null })).toEqual({
      id: created.id,
      name: "Spanish B1",
      description: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });

  test("changes only what it is given", () => {
    const created = create("Spanish", "about");

    expect(decks.update(USER, created.id, { description: "new" })).toMatchObject({
      name: "Spanish",
      description: "new",
    });
    expect(decks.update(USER, created.id, { name: "Español" })).toMatchObject({
      name: "Español",
      description: "new",
    });
  });

  test("lets a Deck change the case of its own name", () => {
    const created = create("spanish");

    expect(decks.update(USER, created.id, { name: "Spanish" })).toMatchObject({ name: "Spanish" });
  });

  test("refuses another Deck's name, ignoring case, and changes nothing", () => {
    create("Calculus 2");
    const other = create("Calculus 10", "about");

    expect(decks.update(USER, other.id, { name: "CALCULUS 2", description: "x" })).toBe("taken");
    expect(decks.find(USER, other.id)).toMatchObject({ name: "Calculus 10", description: "about" });
  });

  test("takes a deleted Deck's name", () => {
    decks.softDelete(USER, create("Calculus 2").id);
    const other = create("Calculus 10");

    expect(decks.update(USER, other.id, { name: "Calculus 2" })).toMatchObject({
      name: "Calculus 2",
    });
  });

  test("finds nothing to change for an unknown, deleted or another User's Deck", () => {
    const gone = create("Gone");
    decks.softDelete(USER, gone.id);
    const theirs = create("Theirs", null, undefined, OTHER);

    expect(decks.update(USER, "nope", { name: "x" })).toBe("not_found");
    expect(decks.update(USER, gone.id, { name: "x" })).toBe("not_found");
    expect(decks.update(USER, theirs.id, { name: "x" })).toBe("not_found");
    expect(decks.find(OTHER, theirs.id)?.name).toBe("Theirs");
  });
});

describe("softDelete", () => {
  test("sets deletedAt and keeps the row", () => {
    const created = create("Spanish");
    const now = at("2026-10-20T12:00:00.000Z");

    expect(decks.softDelete(USER, created.id, now)).toBe(true);

    const row = opened.db.select().from(deck).where(eq(deck.id, created.id)).get();
    expect(row?.deletedAt).toEqual(now);
    expect(decks.find(USER, created.id)).toBeUndefined();
  });

  test("deletes nothing for an unknown, already deleted or another User's Deck", () => {
    const created = create("Spanish");
    decks.softDelete(USER, created.id);
    const theirs = create("Theirs", null, undefined, OTHER);

    expect(decks.softDelete(USER, "nope")).toBe(false);
    expect(decks.softDelete(USER, created.id)).toBe(false);
    expect(decks.softDelete(USER, theirs.id)).toBe(false);
    expect(decks.find(OTHER, theirs.id)).toBeDefined();
  });
});

describe("any", () => {
  test("counts deleted Decks too, and only the User's", () => {
    expect(decks.any(USER)).toBe(false);
    create("Theirs", null, undefined, OTHER);
    expect(decks.any(USER)).toBe(false);

    decks.softDelete(USER, create("Gone").id);

    expect(decks.any(USER)).toBe(true);
  });
});
