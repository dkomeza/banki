import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { card, card_tag, deck } from "../db/schema";
import { type CardRepository, createCardRepository } from "./cards";
import { type DeckRepository, createDeckRepository } from "./decks";
import { createDeletionRepository } from "./deletions";
import { type FolderRepository, createFolderRepository } from "./folders";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let cards: CardRepository;
let decks: DeckRepository;
let folders: FolderRepository;

const USER = "user-1";
const OTHER = "user-2";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-cards-"));
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
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

const deckNamed = (name: string, folderId: string | null = null, userId = USER) => {
  const created = decks.create(userId, { name, description: null, folderId });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

const folderNamed = (name: string, parentId: string | null = null) => {
  const created = folders.create(USER, { name, parentId });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

const write = (deckId: string, front: string, back = "back", now?: Date, userId = USER) => {
  const created = cards.create(userId, deckId, { front, back }, now === undefined ? {} : { now });
  if (typeof created === "string") throw new Error(`${front}: ${created}`);
  return created;
};

const rowOf = (id: string) => opened.db.select().from(card).where(eq(card.id, id)).get();
const deckRowOf = (id: string) => opened.db.select().from(deck).where(eq(deck.id, id)).get();

const frontsIn = (deckId: string, userId = USER) => {
  const listed = cards.list(userId, deckId);
  return typeof listed === "string" ? listed : listed.map((c) => c.front);
};

describe("create", () => {
  test("creates a Card exactly as typed and answers it, with its times", () => {
    const deckId = deckNamed("Spanish");

    const created = cards.create(
      USER,
      deckId,
      { front: "  el desayuno \n", back: "breakfast\n\nTomo el desayuno.  " },
      { id: "card-1", now: at("2026-10-01T10:00:00.000Z") },
    );

    expect(created).toEqual({
      id: "card-1",
      deckId,
      front: "  el desayuno \n",
      back: "breakfast\n\nTomo el desayuno.  ",
      tags: [],
      gradingNotes: null,
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
    });
    expect(frontsIn(deckId)).toEqual(["  el desayuno \n"]);
    expect(cards.find(USER, "card-1")?.front).toBe("  el desayuno \n");
  });

  test("refuses a deleted Deck, an unknown one and another User's", () => {
    const deleted = deckNamed("Old");
    decks.softDelete(USER, deleted);
    const theirs = deckNamed("Theirs", null, OTHER);

    for (const deckId of [deleted, "nope", theirs]) {
      expect(cards.create(USER, deckId, { front: "f", back: "b" })).toBe("not_found");
    }
  });
});

describe("list", () => {
  test("lists a Deck's live Cards, newest first", () => {
    const deckId = deckNamed("Spanish");
    const other = deckNamed("Kanji");
    write(deckId, "oldest", "b", at("2026-09-01T00:00:00.000Z"));
    write(deckId, "newest", "b", at("2026-10-03T00:00:00.000Z"));
    write(deckId, "middle", "b", at("2026-10-01T00:00:00.000Z"));
    write(other, "elsewhere");
    cards.softDelete(USER, write(deckId, "deleted", "b", at("2026-10-02T00:00:00.000Z")).id);

    expect(frontsIn(deckId)).toEqual(["newest", "middle", "oldest"]);
  });

  test("answers not_found for a deleted Deck, an unknown one and another User's", () => {
    const deleted = deckNamed("Old");
    write(deleted, "f");
    decks.softDelete(USER, deleted);
    const theirs = deckNamed("Theirs", null, OTHER);
    write(theirs, "theirs", "b", undefined, OTHER);

    expect(frontsIn(deleted)).toBe("not_found");
    expect(frontsIn("nope")).toBe("not_found");
    expect(frontsIn(theirs)).toBe("not_found");
    expect(frontsIn(theirs, OTHER)).toEqual(["theirs"]);
  });
});

describe("find", () => {
  test("doesn't find a deleted Card, another User's, or one in a deleted Deck", () => {
    const deckId = deckNamed("Spanish");
    const deleted = write(deckId, "deleted");
    cards.softDelete(USER, deleted.id);
    const theirs = write(deckNamed("Theirs", null, OTHER), "theirs", "b", undefined, OTHER);
    const inDeletedDeck = write(deckNamed("Gone"), "gone");
    decks.softDelete(USER, inDeletedDeck.deckId);

    expect(cards.find(USER, deleted.id)).toBeUndefined();
    expect(cards.find(USER, theirs.id)).toBeUndefined();
    expect(cards.find(USER, inDeletedDeck.id)).toBeUndefined();
    expect(cards.find(OTHER, theirs.id)).toEqual(theirs);
  });
});

describe("update", () => {
  test("changes the Front and the Back as typed, keeping the creation time", () => {
    const created = write(deckNamed("Spanish"), "old", "old back", at("2026-09-01T00:00:00.000Z"));

    expect(
      cards.update(
        USER,
        created.id,
        { front: " new\n", back: "new back " },
        at("2026-10-01T00:00:00.000Z"),
      ),
    ).toEqual({
      ...created,
      front: " new\n",
      back: "new back ",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  test("changes only the side it is given", () => {
    const created = write(deckNamed("Spanish"), "front", "back");

    expect(cards.update(USER, created.id, { back: "other" })).toMatchObject({
      front: "front",
      back: "other",
    });
    expect(cards.update(USER, created.id, { front: "first" })).toMatchObject({
      front: "first",
      back: "other",
    });
  });

  test("refuses a deleted Card, another User's, and one in a deleted Deck", () => {
    const deckId = deckNamed("Spanish");
    const deleted = write(deckId, "deleted");
    cards.softDelete(USER, deleted.id);
    const theirs = write(deckNamed("Theirs", null, OTHER), "theirs", "b", undefined, OTHER);
    const inDeletedDeck = write(deckNamed("Gone"), "gone");
    decks.softDelete(USER, inDeletedDeck.deckId);

    for (const id of [deleted.id, theirs.id, inDeletedDeck.id, "nope"]) {
      expect(cards.update(USER, id, { front: "x" })).toBe("not_found");
    }
    expect(rowOf(theirs.id)?.front).toBe("theirs");
  });
});

describe("softDelete", () => {
  test("stamps the Card with its deletion time and a deletion ID of its own", () => {
    const deckId = deckNamed("Spanish");
    const one = write(deckId, "one");
    const two = write(deckId, "two");

    expect(cards.softDelete(USER, one.id, at("2026-10-05T00:00:00.000Z"))).toBeString();
    expect(cards.softDelete(USER, two.id)).toBeString();

    const row = rowOf(one.id);
    expect(row?.deletedAt).toEqual(at("2026-10-05T00:00:00.000Z"));
    expect(row?.deletionId).toBeString();
    expect(row?.deletionId).not.toBe(rowOf(two.id)?.deletionId ?? null);
    expect(deckRowOf(deckId)?.deletedAt).toBeNull();
  });

  test("answers undefined for a Card already deleted, another User's or an unknown one", () => {
    const deleted = write(deckNamed("Spanish"), "deleted");
    cards.softDelete(USER, deleted.id);
    const theirs = write(deckNamed("Theirs", null, OTHER), "theirs", "b", undefined, OTHER);

    expect(cards.softDelete(USER, deleted.id)).toBeUndefined();
    expect(cards.softDelete(USER, theirs.id)).toBeUndefined();
    expect(cards.softDelete(USER, "nope")).toBeUndefined();
    expect(rowOf(theirs.id)?.deletedAt).toBeNull();
  });
});

describe("move", () => {
  test("moves every Card to the Deck, keeping its ID, sides, Tags and createdAt", () => {
    const from = deckNamed("Spanish");
    const to = deckNamed("Verbs");
    const one = cards.create(
      USER,
      from,
      { front: "comer", back: "to eat", tags: ["verb", "food"] },
      { now: at("2026-09-01T10:00:00.000Z") },
    );
    if (typeof one === "string") throw new Error(one);
    const two = write(from, "beber", "to drink", at("2026-09-02T10:00:00.000Z"));
    const stays = write(from, "la mesa");

    const moved = cards.move(USER, [one.id, two.id], to, at("2026-10-05T00:00:00.000Z"));

    expect(moved).toEqual([
      { ...two, deckId: to, updatedAt: "2026-10-05T00:00:00.000Z" },
      { ...one, deckId: to, updatedAt: "2026-10-05T00:00:00.000Z" },
    ]);
    expect(frontsIn(from)).toEqual([stays.front]);
    expect(frontsIn(to)).toEqual(["beber", "comer"]);
    expect(cards.find(USER, one.id)).toMatchObject({
      id: one.id,
      deckId: to,
      tags: ["food", "verb"],
      createdAt: "2026-09-01T10:00:00.000Z",
    });
    expect(cards.tags(USER)).toEqual(["food", "verb"]);
  });

  test("takes a Card listed twice once, and moves a Duplicate anyway", () => {
    const from = deckNamed("Spanish");
    const to = deckNamed("Verbs");
    const comer = write(from, "comer");
    write(to, "Comer");

    const moved = cards.move(USER, [comer.id, comer.id], to);

    expect(moved).toHaveLength(1);
    expect(frontsIn(to)).toEqual(expect.arrayContaining(["comer", "Comer"]));
  });

  test("moves nothing when one Card is deleted, unknown or another User's", () => {
    const from = deckNamed("Spanish");
    const to = deckNamed("Verbs");
    const live = write(from, "live");
    const gone = write(from, "gone");
    cards.softDelete(USER, gone.id);
    const theirs = write(deckNamed("Theirs", null, OTHER), "theirs", "b", undefined, OTHER);

    for (const other of [gone.id, "nope", theirs.id]) {
      expect(cards.move(USER, [live.id, other], to)).toBe("not_found");
    }
    expect(rowOf(live.id)?.deckId).toBe(from);
    expect(rowOf(theirs.id)?.deckId).not.toBe(to);
  });

  test("moves nothing out of a deleted Deck", () => {
    const from = deckNamed("Spanish");
    const comer = write(from, "comer");
    decks.softDelete(USER, from);

    expect(cards.move(USER, [comer.id], deckNamed("Verbs"))).toBe("not_found");
    expect(rowOf(comer.id)?.deckId).toBe(from);
  });

  test("moves nothing into a deleted Deck, an unknown one or another User's", () => {
    const from = deckNamed("Spanish");
    const comer = write(from, "comer");
    const deleted = deckNamed("Old");
    decks.softDelete(USER, deleted);
    const theirs = deckNamed("Theirs", null, OTHER);

    for (const to of [deleted, "nope", theirs]) {
      expect(cards.move(USER, [comer.id], to)).toBe("not_found");
    }
    expect(rowOf(comer.id)?.deckId).toBe(from);
  });

  test("moves 10,000 Cards in one go", () => {
    const from = deckNamed("Spanish");
    const to = deckNamed("Verbs");
    const ids = Array.from({ length: 10_000 }, (_, i) => `card-${i}`);
    const now = new Date();
    opened.db
      .insert(card)
      .values(
        ids.map((id) => ({
          id,
          userId: USER,
          deckId: from,
          front: id,
          back: "b",
          createdAt: now,
          updatedAt: now,
        })),
      )
      .run();

    const moved = cards.move(USER, ids, to);

    expect(moved).toHaveLength(10_000);
    expect(frontsIn(from)).toEqual([]);
  });
});

describe("softDeleteAll", () => {
  test("deletes every Card at once, each as a Deletion of its own", () => {
    const deckId = deckNamed("Spanish");
    const one = write(deckId, "one");
    const two = write(deckId, "two");
    const stays = write(deckId, "stays");

    const deleted = cards.softDeleteAll(USER, [one.id, two.id], at("2026-10-05T00:00:00.000Z"));

    if (deleted === "not_found") throw new Error("Nothing was deleted");
    expect(deleted.map((d) => d.cardId)).toEqual([one.id, two.id]);
    expect(deleted.map((d) => rowOf(d.cardId)?.deletionId)).toEqual(
      deleted.map((d) => d.deletionId),
    );
    expect(new Set(deleted.map((d) => d.deletionId)).size).toBe(2);
    expect(rowOf(one.id)?.deletedAt).toEqual(at("2026-10-05T00:00:00.000Z"));
    expect(frontsIn(deckId)).toEqual([stays.front]);
    const listed = createDeletionRepository(opened.db).list(USER);
    expect(listed.map((d) => d.top.name).toSorted()).toEqual(["one", "two"]);
  });

  test("deletes nothing when one Card is deleted already, unknown or another User's", () => {
    const deckId = deckNamed("Spanish");
    const live = write(deckId, "live");
    const gone = write(deckId, "gone");
    cards.softDelete(USER, gone.id);
    const theirs = write(deckNamed("Theirs", null, OTHER), "theirs", "b", undefined, OTHER);

    for (const other of [gone.id, "nope", theirs.id]) {
      expect(cards.softDeleteAll(USER, [live.id, other])).toBe("not_found");
    }
    expect(rowOf(live.id)?.deletedAt).toBeNull();
    expect(rowOf(theirs.id)?.deletedAt).toBeNull();
  });
});

describe("a Deck's or a Folder's delete", () => {
  test("a Deck's delete stamps its live Cards with the Deck's Deletion", () => {
    const deckId = deckNamed("Spanish");
    const one = write(deckId, "one");
    const two = write(deckId, "two");
    const elsewhere = write(deckNamed("Kanji"), "elsewhere");

    decks.softDelete(USER, deckId, at("2026-10-05T00:00:00.000Z"));

    const stamp = deckRowOf(deckId);
    for (const id of [one.id, two.id]) {
      expect(rowOf(id)).toMatchObject({
        deletedAt: at("2026-10-05T00:00:00.000Z"),
        deletionId: stamp?.deletionId ?? "",
      });
    }
    expect(rowOf(elsewhere.id)?.deletedAt).toBeNull();
  });

  test("a Card deleted on its own before keeps its own Deletion", () => {
    const deckId = deckNamed("Spanish");
    const before = write(deckId, "before");
    cards.softDelete(USER, before.id, at("2026-10-01T00:00:00.000Z"));
    const own = rowOf(before.id);

    decks.softDelete(USER, deckId, at("2026-10-05T00:00:00.000Z"));

    expect(rowOf(before.id)).toMatchObject({
      deletedAt: own?.deletedAt ?? null,
      deletionId: own?.deletionId ?? null,
    });
    expect(own?.deletionId).not.toBe(deckRowOf(deckId)?.deletionId ?? null);
  });

  test("a Folder's delete stamps the Cards of every Deck inside with its one Deletion", () => {
    const maths = folderNamed("Maths");
    const analysis = folderNamed("Analysis", maths);
    const top = write(deckNamed("Algebra", maths), "top");
    const deep = write(deckNamed("Calculus", analysis), "deep");
    const before = write(top.deckId, "before");
    cards.softDelete(USER, before.id, at("2026-10-01T00:00:00.000Z"));
    const own = rowOf(before.id);
    const outside = write(deckNamed("Spanish"), "outside");

    folders.softDelete(USER, maths, at("2026-10-05T00:00:00.000Z"));

    const deletionId = deckRowOf(top.deckId)?.deletionId;
    expect(deletionId).toBeString();
    for (const id of [top.id, deep.id]) {
      expect(rowOf(id)).toMatchObject({
        deletedAt: at("2026-10-05T00:00:00.000Z"),
        deletionId: deletionId ?? "",
      });
    }
    expect(rowOf(before.id)?.deletionId).toBe(own?.deletionId ?? "");
    expect(rowOf(outside.id)?.deletedAt).toBeNull();
  });

  test("a Deck replaced by a move takes its Cards with it", () => {
    const languages = folderNamed("Languages");
    const replaced = deckNamed("Spanish", languages);
    const gone = write(replaced, "gone");
    const moving = deckNamed("Spanish");

    decks.update(USER, moving, { folderId: languages, onClash: "replace" });

    expect(rowOf(gone.id)?.deletionId).toBe(deckRowOf(replaced)?.deletionId ?? "");
  });
});

describe("cardCount", () => {
  test("a Deck answers the number of its live Cards", () => {
    const deckId = deckNamed("Spanish");
    const empty = deckNamed("Empty");
    write(deckId, "one");
    write(deckId, "two");
    cards.softDelete(USER, write(deckId, "deleted").id);
    write(deckNamed("Theirs", null, OTHER), "theirs", "b", undefined, OTHER);

    expect(decks.find(USER, deckId)?.cardCount).toBe(2);
    expect(decks.find(USER, empty)?.cardCount).toBe(0);
    expect(Object.fromEntries(decks.list(USER).map((d) => [d.name, d.cardCount]))).toEqual({
      Spanish: 2,
      Empty: 0,
    });
  });
});

describe("any", () => {
  test("counts deleted Cards too, and only the User's", () => {
    const deckId = deckNamed("Spanish");
    expect(cards.any(USER)).toBe(false);

    cards.softDelete(USER, write(deckId, "deleted").id);

    expect(cards.any(USER)).toBe(true);
    expect(cards.any(OTHER)).toBe(false);
  });
});

const tagged = (deckId: string, front: string, tags: string[], userId = USER, now?: Date) => {
  const created = cards.create(
    userId,
    deckId,
    { front, back: "b", tags },
    now === undefined ? {} : { now },
  );
  if (typeof created === "string") throw new Error(`${front}: ${created}`);
  return created;
};
const tagsIn = (deckId: string) => {
  const listed = cards.list(USER, deckId);
  return typeof listed === "string" ? listed : listed.map((c) => [c.front, c.tags]);
};

describe("Tags", () => {
  test("a create stores the Card's Tags and answers them A–Z", () => {
    const deckId = deckNamed("Spanish");

    const created = tagged(deckId, "el andén", ["travel", "noun", "b1"]);

    expect(created.tags).toEqual(["b1", "noun", "travel"]);
    expect(cards.find(USER, created.id)?.tags).toEqual(["b1", "noun", "travel"]);
    expect(tagsIn(deckId)).toEqual([["el andén", ["b1", "noun", "travel"]]]);
  });

  test("a Card created without Tags carries none", () => {
    const deckId = deckNamed("Spanish");
    expect(write(deckId, "f").tags).toEqual([]);
    expect(tagsIn(deckId)).toEqual([["f", []]]);
  });

  test("each Card in a list answers its own Tags", () => {
    const deckId = deckNamed("Spanish");
    tagged(deckId, "one", ["a"], USER, at("2026-10-01T10:00:00.000Z"));
    write(deckId, "two", "b", at("2026-10-02T10:00:00.000Z"));
    tagged(deckId, "three", ["c", "b"], USER, at("2026-10-03T10:00:00.000Z"));

    expect(tagsIn(deckId)).toEqual([
      ["three", ["b", "c"]],
      ["two", []],
      ["one", ["a"]],
    ]);
  });

  test("an update given Tags replaces them all, and leaves the sides alone", () => {
    const deckId = deckNamed("Spanish");
    const created = tagged(deckId, "quedar", ["verb", "b1"]);

    const updated = cards.update(USER, created.id, { tags: ["social", "verb"] });

    expect(updated).toMatchObject({ front: "quedar", back: "b", tags: ["social", "verb"] });
    expect(cards.update(USER, created.id, { tags: [] })).toMatchObject({ tags: [] });
    expect(opened.db.select().from(card_tag).all()).toEqual([]);
  });

  test("an update without Tags keeps them", () => {
    const deckId = deckNamed("Spanish");
    const created = tagged(deckId, "quedar", ["verb"]);

    expect(cards.update(USER, created.id, { front: "quedarse" })).toMatchObject({
      front: "quedarse",
      tags: ["verb"],
    });
  });

  test("tags answers the User's Tags on live Cards in live Decks, once each, A–Z", () => {
    const spanish = deckNamed("Spanish");
    const calculus = deckNamed("Calculus");
    tagged(spanish, "quedar", ["verb", "exam"]);
    tagged(spanish, "la cuenta", ["noun", "food"]);
    tagged(calculus, "Ratio test", ["series", "exam"]);
    tagged(deckNamed("Theirs", null, OTHER), "x", ["theirs"], OTHER);

    expect(cards.tags(USER)).toEqual(["exam", "food", "noun", "series", "verb"]);
    expect(cards.tags(OTHER)).toEqual(["theirs"]);
  });

  test("a deleted Card keeps its Tags, hidden, and gets them back on Restore", () => {
    const deckId = deckNamed("Spanish");
    tagged(deckId, "quedar", ["verb", "exam"]);
    const madrugada = tagged(deckId, "la madrugada", ["noun", "time"]);
    const deletionId = cards.softDelete(USER, madrugada.id);
    if (deletionId === undefined) throw new Error("not deleted");

    expect(cards.tags(USER)).toEqual(["exam", "verb"]);
    expect(
      opened.db.select().from(card_tag).where(eq(card_tag.cardId, madrugada.id)).all(),
    ).toHaveLength(2);

    createDeletionRepository(opened.db).restore(USER, deletionId);

    expect(cards.tags(USER)).toEqual(["exam", "noun", "time", "verb"]);
    expect(cards.find(USER, madrugada.id)?.tags).toEqual(["noun", "time"]);
  });

  test("a deleted Deck's Cards' Tags are hidden until it is restored", () => {
    const deckId = deckNamed("Spanish");
    tagged(deckId, "quedar", ["verb"]);
    const deletionId = decks.softDelete(USER, deckId);
    if (deletionId === undefined) throw new Error("not deleted");

    expect(cards.tags(USER)).toEqual([]);

    createDeletionRepository(opened.db).restore(USER, deletionId);

    expect(cards.tags(USER)).toEqual(["verb"]);
  });

  test("a Removal takes the Card's Tags with it", () => {
    const deckId = deckNamed("Spanish");
    const created = tagged(deckId, "quedar", ["verb"]);
    const deletionId = cards.softDelete(USER, created.id);
    if (deletionId === undefined) throw new Error("not deleted");

    createDeletionRepository(opened.db).remove(USER, deletionId);

    expect(opened.db.select().from(card_tag).all()).toEqual([]);
  });

  test("each Tag row is scoped by the User who owns its Card", () => {
    const deckId = deckNamed("Spanish");
    const created = tagged(deckId, "quedar", ["verb"]);
    expect(opened.db.select().from(card_tag).all()).toEqual([
      { cardId: created.id, userId: USER, name: "verb" },
    ]);
  });
});

/** A Card in `deckId` with these Grading notes. */
const withNotes = (deckId: string, gradingNotes: string | null, now?: Date) => {
  const created = cards.create(
    USER,
    deckId,
    { front: "f", back: "b", gradingNotes },
    now === undefined ? {} : { now },
  );
  if (typeof created === "string") throw new Error(created);
  return created;
};

describe("Grading notes", () => {
  test("a create stores them as given, and a Card created without them has none", () => {
    const deckId = deckNamed("Spanish");
    const noted = withNotes(deckId, " Must mention $x$.\n");

    expect(noted.gradingNotes).toBe(" Must mention $x$.\n");
    expect(cards.find(USER, noted.id)?.gradingNotes).toBe(" Must mention $x$.\n");
    expect(write(deckId, "plain").gradingNotes).toBeNull();
    expect(rowOf(write(deckId, "row").id)?.gradingNotes).toBeNull();
  });

  test("an update of only them changes them and the update time, and null clears them", () => {
    const created = withNotes(deckNamed("Spanish"), "old", at("2026-09-01T00:00:00.000Z"));

    expect(
      cards.update(USER, created.id, { gradingNotes: "new" }, at("2026-10-01T00:00:00.000Z")),
    ).toEqual({
      ...created,
      gradingNotes: "new",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(cards.update(USER, created.id, { gradingNotes: null })).toMatchObject({
      gradingNotes: null,
    });
  });

  test("an update without them keeps them", () => {
    const created = withNotes(deckNamed("Spanish"), "kept");

    expect(cards.update(USER, created.id, { front: "other", tags: ["x"] })).toMatchObject({
      front: "other",
      gradingNotes: "kept",
    });
  });

  test("every Card in a list carries its own", () => {
    const deckId = deckNamed("Spanish");
    withNotes(deckId, "one", at("2026-09-01T00:00:00.000Z"));
    withNotes(deckId, null, at("2026-09-02T00:00:00.000Z"));

    const listed = cards.list(USER, deckId);
    if (typeof listed === "string") throw new Error(listed);
    expect(listed.map((c) => c.gradingNotes)).toEqual([null, "one"]);
  });

  test("survive a Move, and a delete then Restore", () => {
    const from = deckNamed("Spanish");
    const to = deckNamed("Verbs");
    const created = withNotes(from, "Accept either tense.");

    const moved = cards.move(USER, [created.id], to);
    if (typeof moved === "string") throw new Error(moved);
    expect(moved[0]?.gradingNotes).toBe("Accept either tense.");

    const deletionId = cards.softDelete(USER, created.id);
    if (deletionId === undefined) throw new Error("not deleted");
    createDeletionRepository(opened.db).restore(USER, deletionId);
    expect(cards.find(USER, created.id)?.gradingNotes).toBe("Accept either tense.");
  });
});
