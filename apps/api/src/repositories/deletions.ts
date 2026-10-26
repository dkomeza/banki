import {
  DELETION_KEPT_MS,
  type DeletionKind,
  type DeletionResponse,
  type RestoreResponse,
  deckNameKey,
  nextFreeName,
} from "@banki/shared";
import { and, eq, inArray, isNotNull, lte, ne, or, isNull, sql } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, deck, folder } from "../db/schema";
import { deckNamed } from "./decks";
import { folderNamed } from "./folders";
import { type Place, isLivePlace } from "./places";

export type Deletion = DeletionResponse;

export type DeletionRepository = ReturnType<typeof createDeletionRepository>;

/** Why a Restore was refused: no such Deletion, or a Card's whose Deck is deleted. */
export type RestoreRefusal = "not_found" | { placeDeleted: { id: string; name: string } };

/** A Deletion's top item: the row whose parent isn't in the same Deletion. */
type Top = {
  kind: DeletionKind;
  id: string;
  name: string;
  /** Where it sat: a Folder (or the Root) for a Deck or Folder, its Deck for a Card. */
  parent: string | null;
  deletedAt: Date;
};

/** The User's rows stamped with `deletionId`, in `table`. */
const stampedWith = (
  table: typeof folder | typeof deck | typeof card,
  userId: string,
  id: string,
) => and(eq(table.userId, userId), eq(table.deletionId, id));

/** The top item of the User's Deletion `id`, or undefined when there is no such Deletion. */
function topOf(db: Queryable, userId: string, id: string): Top | undefined {
  const folders = db
    .select({
      id: folder.id,
      name: folder.name,
      parent: folder.parentId,
      deletedAt: folder.deletedAt,
    })
    .from(folder)
    .where(stampedWith(folder, userId, id))
    .all();
  if (folders.length > 0) {
    const inside = new Set(folders.map((f) => f.id));
    const top = folders.find((f) => f.parent === null || !inside.has(f.parent)) ?? folders[0];
    return top && { ...top, kind: "folder", deletedAt: top.deletedAt ?? new Date(0) };
  }
  const deckRow = db
    .select({ id: deck.id, name: deck.name, parent: deck.folderId, deletedAt: deck.deletedAt })
    .from(deck)
    .where(stampedWith(deck, userId, id))
    .get();
  if (deckRow !== undefined) {
    return { ...deckRow, kind: "deck", deletedAt: deckRow.deletedAt ?? new Date(0) };
  }
  const cardRow = db
    .select({ id: card.id, name: card.front, parent: card.deckId, deletedAt: card.deletedAt })
    .from(card)
    .where(stampedWith(card, userId, id))
    .get();
  if (cardRow === undefined) return undefined;
  return { ...cardRow, kind: "card", deletedAt: cardRow.deletedAt ?? new Date(0) };
}

/** The Folder names from the Root down to `place`, read from every Folder's row, deleted or not. */
function pathTo(folders: Map<string, { name: string; parentId: string | null }>, place: Place) {
  const path: string[] = [];
  const seen = new Set<string>();
  for (let at = place; at !== null && !seen.has(at);) {
    seen.add(at);
    const row = folders.get(at);
    if (row === undefined) break;
    path.unshift(row.name);
    at = row.parentId;
  }
  return path;
}

/**
 * Removes the User's Deletion `id` for good: deletes every row stamped with it,
 * Cards first. Expects to run inside a transaction. False when there is no
 * such Deletion.
 *
 * Removal is this one function, for the 30-day sweep and Delete permanently
 * alike, so whatever else a Card holds that must go with it (its images,
 * BAN-17) is deleted here. Reviews never are (ADR-0018).
 *
 * Something deleted on its own earlier, inside what this Deletion removes,
 * keeps its own Deletion: a Deck or Folder in a removed Folder moves to the
 * Root, where its Restore would put it anyway. A Card can't be without its
 * Deck, so a Card deleted on its own from a removed Deck goes with it: nothing
 * could ever restore it.
 */
export function removeDeletion(db: Queryable, userId: string, id: string): boolean {
  const folderIds = db
    .select({ id: folder.id })
    .from(folder)
    .where(stampedWith(folder, userId, id))
    .all()
    .map((row) => row.id);
  const deckIds = db
    .select({ id: deck.id })
    .from(deck)
    .where(stampedWith(deck, userId, id))
    .all()
    .map((row) => row.id);
  const cards = db
    .delete(card)
    .where(stampedWith(card, userId, id))
    .returning({ id: card.id })
    .all();
  if (folderIds.length === 0 && deckIds.length === 0 && cards.length === 0) return false;

  if (folderIds.length > 0) {
    const notThis = <T extends typeof folder | typeof deck>(table: T) =>
      or(isNull(table.deletionId), ne(table.deletionId, id));
    db.update(folder)
      .set({ parentId: null })
      .where(and(eq(folder.userId, userId), inArray(folder.parentId, folderIds), notThis(folder)))
      .run();
    db.update(deck)
      .set({ folderId: null })
      .where(and(eq(deck.userId, userId), inArray(deck.folderId, folderIds), notThis(deck)))
      .run();
  }
  if (deckIds.length > 0) {
    db.delete(card)
      .where(and(eq(card.userId, userId), inArray(card.deckId, deckIds)))
      .run();
    db.delete(deck)
      .where(stampedWith(deck, userId, id))
      .run();
  }
  if (folderIds.length > 0)
    db.delete(folder)
      .where(stampedWith(folder, userId, id))
      .run();
  return true;
}

/**
 * The User's Deletions: what Recently deleted lists, Restore and Removal.
 * Every query is scoped by the User (ADR-0001), so another User's Deletion is
 * as unknown as one that never existed, or one restored or removed already.
 */
export function createDeletionRepository(db: Queryable) {
  return {
    /** The User's Deletions not removed, newest first. */
    list(userId: string): Deletion[] {
      const folders = db
        .select({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
          deletedAt: folder.deletedAt,
          deletionId: folder.deletionId,
        })
        .from(folder)
        .where(eq(folder.userId, userId))
        .all();
      const decks = db
        .select({
          id: deck.id,
          name: deck.name,
          folderId: deck.folderId,
          deletedAt: deck.deletedAt,
          deletionId: deck.deletionId,
        })
        .from(deck)
        .where(and(eq(deck.userId, userId), isNotNull(deck.deletionId)))
        .all();
      const cardCounts = db
        .select({ deletionId: card.deletionId, count: sql<number>`count(*)`.mapWith(Number) })
        .from(card)
        .where(and(eq(card.userId, userId), isNotNull(card.deletionId)))
        .groupBy(card.deletionId)
        .all();

      const folderTree = new Map(folders.map((f) => [f.id, f]));
      type Group = { folders: typeof folders; decks: typeof decks; cards: number };
      const groups = new Map<string, Group>();
      const group = (id: string) => {
        let found = groups.get(id);
        if (found === undefined) {
          found = { folders: [], decks: [], cards: 0 };
          groups.set(id, found);
        }
        return found;
      };
      for (const f of folders) if (f.deletionId !== null) group(f.deletionId).folders.push(f);
      for (const d of decks) if (d.deletionId !== null) group(d.deletionId).decks.push(d);
      for (const c of cardCounts) if (c.deletionId !== null) group(c.deletionId).cards = c.count;

      const lone = [...groups]
        .filter(([, g]) => g.folders.length === 0 && g.decks.length === 0)
        .map(([id]) => id);
      const loneCards = new Map(
        (lone.length === 0
          ? []
          : db
              .select({
                id: card.id,
                front: card.front,
                deletedAt: card.deletedAt,
                deletionId: card.deletionId,
                deckId: deck.id,
                deckName: deck.name,
              })
              .from(card)
              .innerJoin(deck, eq(deck.id, card.deckId))
              .where(and(eq(card.userId, userId), inArray(card.deletionId, lone)))
              .all()
        ).map((row) => [row.deletionId, row]),
      );

      const listed: Deletion[] = [];
      for (const [id, g] of groups) {
        let entry: Omit<Deletion, "id" | "deletedAt" | "removesAt"> & { deletedAt: Date | null };
        if (g.folders.length > 0) {
          const inside = new Set(g.folders.map((f) => f.id));
          const top = g.folders.find((f) => f.parentId === null || !inside.has(f.parentId));
          if (top === undefined) continue;
          entry = {
            deletedAt: top.deletedAt,
            top: { kind: "folder", id: top.id, name: top.name },
            path: pathTo(folderTree, top.parentId),
            deck: null,
            counts: { folders: g.folders.length - 1, decks: g.decks.length, cards: g.cards },
          };
        } else if (g.decks[0] !== undefined) {
          const top = g.decks[0];
          entry = {
            deletedAt: top.deletedAt,
            top: { kind: "deck", id: top.id, name: top.name },
            path: pathTo(folderTree, top.folderId),
            deck: null,
            counts: { folders: 0, decks: 0, cards: g.cards },
          };
        } else {
          const top = loneCards.get(id);
          if (top === undefined) continue;
          entry = {
            deletedAt: top.deletedAt,
            top: { kind: "card", id: top.id, name: top.front },
            path: null,
            deck: { id: top.deckId, name: top.deckName },
            counts: { folders: 0, decks: 0, cards: 0 },
          };
        }
        const deletedAt = entry.deletedAt ?? new Date(0);
        listed.push({
          ...entry,
          id,
          deletedAt: deletedAt.toISOString(),
          removesAt: new Date(deletedAt.getTime() + DELETION_KEPT_MS).toISOString(),
        });
      }
      return listed.toSorted(
        (a, b) =>
          Date.parse(b.deletedAt) - Date.parse(a.deletedAt) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    },

    /**
     * Restores the User's Deletion `id` where it was: every row stamped with it
     * comes back, keeping its `createdAt`. A Deck or Folder whose Folder is
     * deleted comes back at the Root (`movedToRoot`), and one whose name a live
     * one of its kind beside it now has, as the next free "Name (n)"
     * (`renamed`). A Card's Deletion whose Deck is deleted is refused, naming
     * the Deck.
     */
    restore(userId: string, id: string, now = new Date()): RestoreResponse | RestoreRefusal {
      return db.transaction(
        (tx) => {
          const top = topOf(tx, userId, id);
          if (top === undefined) return "not_found";
          const back = { deletedAt: null, deletionId: null, updatedAt: now };

          if (top.kind === "card") {
            const home = tx
              .select({ id: deck.id, name: deck.name, deletedAt: deck.deletedAt })
              .from(deck)
              .where(and(eq(deck.userId, userId), eq(deck.id, top.parent ?? "")))
              .get();
            if (home === undefined) return "not_found";
            if (home.deletedAt !== null) return { placeDeleted: { id: home.id, name: home.name } };
            tx.update(card)
              .set(back)
              .where(stampedWith(card, userId, id))
              .run();
            return { kind: "card", id: top.id, name: top.name, movedToRoot: false, renamed: false };
          }

          const movedToRoot = !isLivePlace(tx, userId, top.parent);
          const place = movedToRoot ? null : top.parent;
          const named = top.kind === "deck" ? deckNamed : folderNamed;
          const taken = (name: string) => named(tx, userId, place, name) !== undefined;
          const renamed = taken(top.name);
          const name = renamed ? nextFreeName(top.name, taken) : top.name;
          const self = { ...back, name, nameKey: deckNameKey(name) };
          if (top.kind === "deck") {
            tx.update(deck)
              .set({ ...self, folderId: place })
              .where(and(eq(deck.userId, userId), eq(deck.id, top.id)))
              .run();
          } else {
            tx.update(folder)
              .set({ ...self, parentId: place })
              .where(and(eq(folder.userId, userId), eq(folder.id, top.id)))
              .run();
            tx.update(folder)
              .set(back)
              .where(stampedWith(folder, userId, id))
              .run();
            tx.update(deck)
              .set(back)
              .where(stampedWith(deck, userId, id))
              .run();
          }
          tx.update(card)
            .set(back)
            .where(stampedWith(card, userId, id))
            .run();
          return { kind: top.kind, id: top.id, name, movedToRoot, renamed };
        },
        { behavior: "immediate" },
      );
    },

    /** Removes the User's Deletion `id` at once (Delete permanently); false when there is none. */
    remove(userId: string, id: string): boolean {
      return db.transaction((tx) => removeDeletion(tx, userId, id), { behavior: "immediate" });
    },

    /**
     * Removes every Deletion, any User's, deleted 30 × 24 h or more before
     * `now`, oldest first, each in a transaction of its own. Answers how many
     * it removed.
     */
    removeExpired(now = new Date()): number {
      const cutoff = new Date(now.getTime() - DELETION_KEPT_MS);
      const due = new Map<string, { userId: string; id: string; deletedAt: Date }>();
      for (const table of [folder, deck, card]) {
        const rows = db
          .selectDistinct({
            userId: table.userId,
            id: table.deletionId,
            deletedAt: table.deletedAt,
          })
          .from(table)
          .where(and(isNotNull(table.deletionId), lte(table.deletedAt, cutoff)))
          .all();
        for (const row of rows) {
          if (row.id !== null && row.deletedAt !== null) {
            due.set(`${row.userId}/${row.id}`, { ...row, id: row.id, deletedAt: row.deletedAt });
          }
        }
      }
      let removed = 0;
      for (const { userId, id } of [...due.values()].toSorted(
        (a, b) => a.deletedAt.getTime() - b.deletedAt.getTime(),
      )) {
        if (db.transaction((tx) => removeDeletion(tx, userId, id), { behavior: "immediate" })) {
          removed += 1;
        }
      }
      return removed;
    },
  };
}
