import { randomUUID } from "node:crypto";
import {
  type CreateFolderRequest,
  type FolderResponse,
  type UpdateFolderRequest,
  deckNameKey,
  nextFreeName,
} from "@banki/shared";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { z } from "zod";
import type { Queryable } from "../db/database";
import { deck, folder } from "../db/schema";
import { stampCards } from "./cards";
import {
  type Clash,
  type Place,
  type Refusal,
  foldersAbove,
  foldersInside,
  isLivePlace,
  liveFolderTree,
  placeIs,
} from "./places";

export type Folder = FolderResponse;

export type FolderRepository = ReturnType<typeof createFolderRepository>;

/** A new Folder, as `CreateFolderRequest` parses it. */
export type NewFolder = z.output<typeof CreateFolderRequest>;

/** Changes to a Folder, as `UpdateFolderRequest` parses them. */
export type FolderChanges = z.output<typeof UpdateFolderRequest>;

const COLUMNS = {
  id: folder.id,
  name: folder.name,
  parentId: folder.parentId,
  createdAt: folder.createdAt,
} as const;

type Row = { id: string; name: string; parentId: string | null; createdAt: Date };

const toFolder = (row: Row): Folder => ({ ...row, createdAt: row.createdAt.toISOString() });

/** The User's Folder `id`, unless it is deleted. */
const live = (userId: string, id: string) =>
  and(eq(folder.userId, userId), eq(folder.id, id), isNull(folder.deletedAt));

const findIn = (db: Queryable, userId: string, id: string): Folder | undefined => {
  const row = db.select(COLUMNS).from(folder).where(live(userId, id)).get();
  return row === undefined ? undefined : toFolder(row);
};

/** The live Folder in `place` named `name`, ignoring case, other than `except`. */
const folderNamed = (db: Queryable, userId: string, place: Place, name: string, except?: string) =>
  db
    .select({ id: folder.id, name: folder.name })
    .from(folder)
    .where(
      and(
        eq(folder.userId, userId),
        placeIs(folder.parentId, place),
        eq(folder.nameKey, deckNameKey(name)),
        isNull(folder.deletedAt),
        except === undefined ? undefined : ne(folder.id, except),
      ),
    )
    .get();

/**
 * Deletes the Folder `id` softly, with every Folder, Deck and Card inside it
 * that isn't deleted yet, as one Deletion: the same `deletedAt` and deletion ID on
 * all of them (ADR-0016). Expects to run inside a transaction. False when
 * there is no such Folder.
 */
export function deleteFolderTree(db: Queryable, userId: string, id: string, now: Date): boolean {
  const tree = liveFolderTree(db, userId);
  if (!tree.has(id)) return false;
  const folders = [id, ...foldersInside(tree, id)];
  const stamp = { deletedAt: now, deletionId: randomUUID(), updatedAt: now };
  db.update(folder)
    .set(stamp)
    .where(and(eq(folder.userId, userId), inArray(folder.id, folders), isNull(folder.deletedAt)))
    .run();
  const decksInside = and(
    eq(deck.userId, userId),
    inArray(deck.folderId, folders),
    isNull(deck.deletedAt),
  );
  stampCards(db, userId, db.select({ id: deck.id }).from(deck).where(decksInside), stamp);
  db.update(deck).set(stamp).where(decksInside).run();
  return true;
}

/**
 * The User's Folders. Every query is scoped by the User (ADR-0001), so another
 * User's Folder is as unknown as one that never existed, and a deleted Folder
 * is too, as a Folder to read or change and as a place to put something in.
 * Names are expected already parsed (trimmed, 1 to 100 characters).
 */
export function createFolderRepository(db: Queryable) {
  return {
    /** The User's Folders that aren't deleted, oldest first. */
    list(userId: string): Folder[] {
      return db
        .select(COLUMNS)
        .from(folder)
        .where(and(eq(folder.userId, userId), isNull(folder.deletedAt)))
        .orderBy(folder.createdAt, folder.id)
        .all()
        .map(toFolder);
    },

    /** The User's Folder `id`, unless it is deleted. */
    find: (userId: string, id: string) => findIn(db, userId, id),

    /**
     * Creates a Folder in `parentId` (null for the Root), unless that isn't a
     * live Folder of the User's, or another live Folder there has its name.
     * `id` and `now` are for the Seed data and tests.
     */
    create(
      userId: string,
      { name, parentId }: NewFolder,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): Folder | "not_found" | "taken" {
      return db.transaction(
        (tx) => {
          if (!isLivePlace(tx, userId, parentId)) return "not_found";
          if (folderNamed(tx, userId, parentId, name) !== undefined) return "taken";
          tx.insert(folder)
            .values({
              id,
              userId,
              parentId,
              name,
              nameKey: deckNameKey(name),
              createdAt: now,
              updatedAt: now,
            })
            .run();
          return toFolder({ id, name, parentId, createdAt: now });
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Renames a Folder, moves it, or both. A rename refuses a name another
     * Folder beside it has ("taken"). A move refuses a destination that isn't
     * a live Folder ("not_found"), and the Folder itself or one inside it
     * ("invalid_move"). A move into a place where a Folder has its name
     * answers the clash, unless `onClash` says what to do: `replace` deletes
     * that Folder (with everything in it) as its own Deletion first, which
     * isn't allowed when it holds this one ("replace_not_allowed"); `keepBoth` takes
     * the next free "Name (n)".
     */
    update(
      userId: string,
      id: string,
      { name: newName, parentId, onClash }: FolderChanges,
      now = new Date(),
    ): Folder | Refusal | { clash: Clash } {
      return db.transaction(
        (tx) => {
          const current = findIn(tx, userId, id);
          if (current === undefined) return "not_found";
          let name = newName ?? current.name;
          const moving = parentId !== undefined && parentId !== current.parentId;
          const place = moving ? parentId : current.parentId;
          if (moving) {
            if (!isLivePlace(tx, userId, place)) return "not_found";
            const tree = liveFolderTree(tx, userId);
            if (place === id || (place !== null && foldersInside(tree, id).has(place))) {
              return "invalid_move";
            }
            const existing = folderNamed(tx, userId, place, name);
            if (existing !== undefined) {
              const replaceAllowed = !foldersAbove(tree, id).has(existing.id);
              if (onClash === undefined) return { clash: { ...existing, replaceAllowed } };
              if (onClash === "replace") {
                if (!replaceAllowed) return "replace_not_allowed";
                deleteFolderTree(tx, userId, existing.id, now);
              } else {
                name = nextFreeName(name, (n) => folderNamed(tx, userId, place, n) !== undefined);
              }
            }
          } else if (
            newName !== undefined &&
            folderNamed(tx, userId, place, name, id) !== undefined
          ) {
            return "taken";
          }
          tx.update(folder)
            .set({ name, nameKey: deckNameKey(name), parentId: place, updatedAt: now })
            .where(live(userId, id))
            .run();
          return findIn(tx, userId, id) ?? "not_found";
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Deletes a Folder softly with everything inside it, as one Deletion
     * (ADR-0016); false when there is no such Folder.
     */
    softDelete(userId: string, id: string, now = new Date()): boolean {
      return db.transaction((tx) => deleteFolderTree(tx, userId, id, now), {
        behavior: "immediate",
      });
    },

    /** Whether the User has any Folder at all, deleted ones too. */
    any(userId: string): boolean {
      return (
        db
          .select({ id: folder.id })
          .from(folder)
          .where(eq(folder.userId, userId))
          .limit(1)
          .get() !== undefined
      );
    },
  };
}
