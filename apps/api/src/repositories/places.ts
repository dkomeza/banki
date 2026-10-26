// What the Deck and Folder repositories share about places: where something
// sits (a Folder, or the Root as null), the live folder tree, and the clash a
// move into a place can run into.
import { and, eq, isNull } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Queryable } from "../db/database";
import { folder } from "../db/schema";

/** A Folder's ID, or null for the Root. */
export type Place = string | null;

/** The condition that `column` holds `place`: the Folder's ID, or null at the Root. */
export const placeIs = (column: SQLiteColumn, place: Place) =>
  place === null ? isNull(column) : eq(column, place);

/** The clash a move answers when something of its kind beside the destination has its name. */
export type Clash = { id: string; name: string; replaceAllowed: boolean };

/**
 * Why a move or a create was refused, besides a clash: "invalid_move" for a
 * Folder into itself or one inside it, "replace_not_allowed" for Replace where
 * the clashing Folder holds the moved one.
 */
export type Refusal = "not_found" | "taken" | "invalid_move" | "replace_not_allowed";

/** The User's live Folders, each ID with the Folder it sits in. */
export function liveFolderTree(db: Queryable, userId: string): Map<string, Place> {
  const rows = db
    .select({ id: folder.id, parentId: folder.parentId })
    .from(folder)
    .where(and(eq(folder.userId, userId), isNull(folder.deletedAt)))
    .all();
  return new Map(rows.map((row) => [row.id, row.parentId]));
}

/** Whether `place` is the Root or one of the User's live Folders. */
export const isLivePlace = (db: Queryable, userId: string, place: Place) =>
  place === null ||
  db
    .select({ id: folder.id })
    .from(folder)
    .where(and(eq(folder.userId, userId), eq(folder.id, place), isNull(folder.deletedAt)))
    .get() !== undefined;

/** Every Folder in `tree` inside `id`, at any depth, `id` itself not included. */
export function foldersInside(tree: Map<string, Place>, id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const [child, parent] of tree) {
    if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const inside = new Set<string>();
  const queue = [...(children.get(id) ?? [])];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (inside.has(next)) continue;
    inside.add(next);
    queue.push(...(children.get(next) ?? []));
  }
  return inside;
}

/** The Folders `place` sits inside, from its parent up to one at the Root. */
export function foldersAbove(tree: Map<string, Place>, place: Place): Set<string> {
  const above = new Set<string>();
  for (let at = place === null ? null : (tree.get(place) ?? null); at !== null;) {
    if (above.has(at)) break;
    above.add(at);
    at = tree.get(at) ?? null;
  }
  return above;
}
