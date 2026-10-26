import {
  ApiError,
  FOLDER_NAME_MAX_LENGTH,
  FolderListResponse,
  FolderResponse,
  NameClashError,
  type OnClash,
  deckNameKey,
  nextFreeName,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { CANT_REACH, type Deck, decksQueryOptions } from "./decks";
import { ApiRequestError } from "./query";

export type Folder = FolderResponse;

/** A Folder's ID, or null for the Root. */
export type Place = string | null;

/** Something that moves: a Deck or a Folder. */
export type Item = { kind: "deck" | "folder"; id: string };

/** Every live Folder and Deck of the User's, as the lists answer them. */
export type Library = { folders: readonly Folder[]; decks: readonly Deck[] };

/** What Home calls the Root, in the breadcrumb and the Move… picker. */
export const ROOT_NAME = "Decks";

/** The User's Folders that aren't deleted, from `GET /api/folders`. */
export const foldersQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["folders"],
    queryFn: async (): Promise<Folder[]> => {
      const res = await client.api.folders.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return FolderListResponse.parse(await res.json());
    },
  });

// The folder tree, built from the lists.

/** What sits in a place: its Folders and its Decks, unsorted. */
export function contentsOf(library: Library, place: Place) {
  return {
    folders: library.folders.filter((f) => f.parentId === place),
    decks: library.decks.filter((d) => d.folderId === place),
  };
}

/** The Folders from one at the Root down to `place`, `place` last; none for the Root. */
export function pathTo(folders: readonly Folder[], place: Place): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  for (let at = place === null ? undefined : byId.get(place); at !== undefined;) {
    if (path.includes(at)) break;
    path.unshift(at);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  return path;
}

/** Every Folder inside `id`, at any depth, `id` itself not included. */
export function foldersInside(folders: readonly Folder[], id: string): Set<string> {
  const inside = new Set<string>();
  const queue = [id];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const f of folders) {
      if (f.parentId === next && !inside.has(f.id)) {
        inside.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return inside;
}

/** How many Decks and Folders are inside a Folder, at any depth. */
export function countInside(library: Library, id: string) {
  const inside = foldersInside(library.folders, id);
  const places = new Set([id, ...inside]);
  return {
    folders: inside.size,
    decks: library.decks.filter((d) => d.folderId !== null && places.has(d.folderId)).length,
  };
}

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "2 decks and 1 folder", "1 deck", or "" for nothing. */
export function countLabel({ decks, folders }: { decks: number; folders: number }): string {
  const parts = [];
  if (decks > 0) parts.push(counted(decks, "deck"));
  if (folders > 0) parts.push(counted(folders, "folder"));
  return parts.join(" and ");
}

/** A place's name: the Folder's, or "Decks" for the Root. */
export function placeName(folders: readonly Folder[], place: Place): string {
  return place === null ? ROOT_NAME : (folders.find((f) => f.id === place)?.name ?? ROOT_NAME);
}

/** Where an item is now. */
export function placeOf(library: Library, item: Item): Place {
  return item.kind === "deck"
    ? (library.decks.find((d) => d.id === item.id)?.folderId ?? null)
    : (library.folders.find((f) => f.id === item.id)?.parentId ?? null);
}

/**
 * Why `item` can't move to `place`, if it can't: it's there already
 * ("current"), or it's the Folder itself ("self") or one inside it ("inside").
 */
export function cantMoveTo(
  library: Library,
  item: Item,
  place: Place,
): "current" | "self" | "inside" | undefined {
  if (placeOf(library, item) === place) return "current";
  if (item.kind === "folder" && place !== null) {
    if (place === item.id) return "self";
    if (foldersInside(library.folders, item.id).has(place)) return "inside";
  }
  return undefined;
}

export type TreeRow = { place: Place; name: string; depth: number };

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The whole folder tree as rows for the Move… picker: "Decks" (the Root) on top, each level A–Z. */
export function treeRows(folders: readonly Folder[]): TreeRow[] {
  const rows: TreeRow[] = [{ place: null, name: ROOT_NAME, depth: 0 }];
  const walk = (parent: Place, depth: number, seen: Set<string>) => {
    const children = folders
      .filter((f) => f.parentId === parent && !seen.has(f.id))
      .toSorted((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
    for (const f of children) {
      rows.push({ place: f.id, name: f.name, depth });
      walk(f.id, depth + 1, new Set([...seen, f.id]));
    }
  };
  walk(null, 1, new Set());
  return rows;
}

/** The name Keep both would give `name` moved into `place` beside another of its kind and name. */
export function keepBothName(library: Library, kind: Item["kind"], place: Place, name: string) {
  const beside =
    kind === "deck" ? contentsOf(library, place).decks : contentsOf(library, place).folders;
  const taken = new Set(beside.map((x) => deckNameKey(x.name)));
  return nextFreeName(name, (candidate) => taken.has(deckNameKey(candidate)));
}

// Creating, renaming, moving and deleting.

/** What the name field says when another Folder beside it has the name. */
export const FOLDER_NAME_TAKEN = "There's already a folder with this name here.";

/** What's wrong with a Folder name, if anything, before it is sent. */
export function folderNameProblem(name: string): string | undefined {
  if (name.trim() === "") return "Give the folder a name.";
  if (name.trim().length > FOLDER_NAME_MAX_LENGTH) return "Keep the name to 100 characters.";
  return undefined;
}

export type FolderOutcome =
  | { ok: true; folder: Folder }
  | { ok: false; field: "name" | "form"; message: string };

async function codeOf(res: Response): Promise<string | undefined> {
  const parsed = ApiError.safeParse(await res.json().catch(() => undefined));
  return parsed.success ? parsed.data.error.code : undefined;
}

/** Has every list and every Deck fetched again, after something moved or went. */
export async function refreshLibrary(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: foldersQueryOptions().queryKey }),
    queryClient.invalidateQueries({ queryKey: decksQueryOptions().queryKey }),
  ]);
}

async function folderOutcomeOf(
  queryClient: QueryClient,
  send: () => Promise<Response>,
  failed: string,
): Promise<FolderOutcome> {
  let res: Response;
  try {
    res = await send();
  } catch {
    return { ok: false, field: "form", message: CANT_REACH };
  }
  if (res.ok) {
    const folder = FolderResponse.parse(await res.json());
    await queryClient.invalidateQueries({ queryKey: foldersQueryOptions().queryKey });
    return { ok: true, folder };
  }
  const code = await codeOf(res);
  if (code === "folder_name_taken") return { ok: false, field: "name", message: FOLDER_NAME_TAKEN };
  if (code === "not_found") {
    return { ok: false, field: "form", message: "This folder was deleted meanwhile." };
  }
  return { ok: false, field: "form", message: failed };
}

/** Creates a Folder in `parentId` (null for the Root) with `POST /api/folders`. */
export function createFolder(
  queryClient: QueryClient,
  body: { name: string; parentId: Place },
  client: ApiClient = api,
): Promise<FolderOutcome> {
  return folderOutcomeOf(
    queryClient,
    () => client.api.folders.$post({ json: body }),
    "Banki couldn't create the folder. Try again.",
  );
}

/** Renames a Folder with `PATCH /api/folders/:id`. */
export function renameFolder(
  queryClient: QueryClient,
  id: string,
  name: string,
  client: ApiClient = api,
): Promise<FolderOutcome> {
  return folderOutcomeOf(
    queryClient,
    () => client.api.folders[":id"].$patch({ param: { id }, json: { name } }),
    "Banki couldn't rename the folder. Try again.",
  );
}

/**
 * Deletes a Folder, with everything in it, with `DELETE /api/folders/:id`. A
 * Folder that is gone already counts as deleted. Answers a message when it
 * couldn't be deleted. The lists are left as they are until
 * {@link refreshLibrary}, so the Folder's page doesn't turn into "Folder not
 * found" before it is left.
 */
export async function deleteFolder(
  id: string,
  client: ApiClient = api,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await client.api.folders[":id"].$delete({ param: { id } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (!res.ok && res.status !== 404) {
    return { ok: false, message: "Banki couldn't delete the folder. Try again." };
  }
  return { ok: true };
}

/** The clash a move ran into: the item of its kind and name at the destination. */
export type Clash = NameClashError["clash"];

export type MoveOutcome =
  | { ok: true }
  | { ok: false; clash: Clash }
  | { ok: false; message: string };

/**
 * Moves a Deck or a Folder to `destination` with a PATCH. A clash with a name
 * there comes back for the popup, which sends the same move again with the
 * User's choice as `onClash`.
 */
export async function moveItem(
  queryClient: QueryClient,
  item: Item,
  destination: Place,
  onClash?: OnClash,
  client: ApiClient = api,
): Promise<MoveOutcome> {
  let res: Response;
  try {
    res =
      item.kind === "deck"
        ? await client.api.decks[":id"].$patch({
            param: { id: item.id },
            json: { folderId: destination, ...(onClash === undefined ? {} : { onClash }) },
          })
        : await client.api.folders[":id"].$patch({
            param: { id: item.id },
            json: { parentId: destination, ...(onClash === undefined ? {} : { onClash }) },
          });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (res.ok) {
    await refreshLibrary(queryClient);
    return { ok: true };
  }
  const body: unknown = await res.json().catch(() => undefined);
  const clash = NameClashError.safeParse(body);
  if (clash.success) return { ok: false, clash: clash.data.clash };
  const code = ApiError.safeParse(body).data?.error.code;
  if (code === "not_found") {
    await refreshLibrary(queryClient);
    return { ok: false, message: "It, or where it was going, was deleted meanwhile." };
  }
  if (code === "invalid_move") return { ok: false, message: "It can't move there." };
  return { ok: false, message: "Banki couldn't move it. Try again." };
}

/** Has both lists loaded, for a route that shows the tree. */
export const ensureLibrary = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.ensureQueryData(foldersQueryOptions()),
    queryClient.ensureQueryData(decksQueryOptions()),
  ]);
