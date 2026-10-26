// PROTOTYPE (BAN-10): an in-memory stand-in for the folders and decks APIs,
// holding the Seed data's folders and decks, so each Variant shows real
// density on a Slug Preview. Changes last until the page reloads. Throwaway:
// the implementation replaces it with /api/folders and /api/decks.
import { useSearch } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { DeckResponse } from "@banki/shared";
import type { DeckSort } from "@/lib/decks";
import { splitState } from "./style";

export type Folder = { id: string; name: string; parentId: string | null; createdAt: string };
export type Deck = {
  id: string;
  name: string;
  description: string | null;
  folderId: string | null;
  createdAt: string;
};
/** A folder's ID, or null for the root. */
export type Place = string | null;
export type Item = { kind: "deck" | "folder"; id: string };

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

// The same IDs as SEED_IDS in apps/api/src/seed/seed-ids.ts.
const F = {
  languages: "5eed0000-0000-4000-8000-0000000000f1",
  maths: "5eed0000-0000-4000-8000-0000000000f2",
  analysis: "5eed0000-0000-4000-8000-0000000000f3",
  archive: "5eed0000-0000-4000-8000-0000000000f4",
};

let folders: Folder[] = [
  { id: F.languages, name: "Languages", parentId: null, createdAt: ago(45) },
  { id: F.maths, name: "Maths", parentId: null, createdAt: ago(33) },
  { id: F.analysis, name: "Analysis", parentId: F.maths, createdAt: ago(31) },
  { id: F.archive, name: "Archive", parentId: null, createdAt: ago(6) },
];

let decks: Deck[] = [
  {
    id: "5eed0000-0000-4000-8000-000000000001",
    name: "Spanish vocabulary",
    description:
      "Everyday words from class and the café down the street.\nSpanish on the front, English on the back.\n\nOne word per card, with an example sentence.",
    folderId: F.languages,
    createdAt: ago(41),
  },
  {
    id: "5eed0000-0000-4000-8000-000000000002",
    name: "Calculus 2",
    description: "Integrals, sequences and series: the second semester.",
    folderId: F.analysis,
    createdAt: ago(30),
  },
  {
    id: "5eed0000-0000-4000-8000-000000000003",
    name: "Calculus 10",
    description: null,
    folderId: F.analysis,
    createdAt: ago(2),
  },
  {
    id: "5eed0000-0000-4000-8000-000000000004",
    name: "Organic chemistry: reaction mechanisms, named reactions and the reagents behind each of the steps",
    description: null,
    folderId: null,
    createdAt: ago(12),
  },
  {
    id: "5eed0000-0000-4000-8000-000000000005",
    name: "Japanese kanji (JLPT N4)",
    description: "Readings on the back, with one example word each.",
    folderId: F.languages,
    createdAt: ago(20),
  },
];

type Snapshot = { folders: readonly Folder[]; decks: readonly Deck[] };
let snapshot: Snapshot = { folders, decks };
const listeners = new Set<() => void>();
function commit() {
  snapshot = { folders, decks };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useLibrary(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortItems<T extends { name: string; createdAt: string }>(
  list: readonly T[],
  sort: DeckSort,
): T[] {
  return list.toSorted((a, b) =>
    sort === "newest"
      ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
      : collator.compare(a.name, b.name),
  );
}

export function folderById(id: string): Folder | undefined {
  return folders.find((f) => f.id === id);
}

/** What sits in a place: its folders and its decks, unsorted. */
export function contentsOf(lib: Snapshot, place: Place) {
  return {
    folders: lib.folders.filter((f) => f.parentId === place),
    decks: lib.decks.filter((d) => d.folderId === place),
  };
}

/** The folders from the root down to `id`, `id` last. */
export function pathTo(lib: Snapshot, id: string | null): Folder[] {
  const path: Folder[] = [];
  let at = id === null ? undefined : lib.folders.find((f) => f.id === id);
  while (at !== undefined) {
    path.unshift(at);
    const parent = at.parentId;
    at = parent === null ? undefined : lib.folders.find((f) => f.id === parent);
  }
  return path;
}

/** Every folder inside `id`, at any depth. */
export function foldersInside(lib: Snapshot, id: string): Set<string> {
  const inside = new Set<string>();
  const walk = (parent: string) => {
    for (const f of lib.folders) {
      if (f.parentId === parent && !inside.has(f.id)) {
        inside.add(f.id);
        walk(f.id);
      }
    }
  };
  walk(id);
  return inside;
}

/** How many decks and folders are inside a folder, at any depth. */
export function countInside(lib: Snapshot, id: string) {
  const inside = foldersInside(lib, id);
  const places = new Set([id, ...inside]);
  return {
    folders: inside.size,
    decks: lib.decks.filter((d) => d.folderId !== null && places.has(d.folderId)).length,
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "2 decks and 1 folder", "1 deck", or "" when empty. */
export function countLabel(count: { decks: number; folders: number }): string {
  const parts = [
    count.decks > 0 && plural(count.decks, "deck"),
    count.folders > 0 && plural(count.folders, "folder"),
  ];
  return parts.filter(Boolean).join(" and ");
}

export function placeName(lib: Snapshot, place: Place): string {
  return place === null ? "Decks" : (lib.folders.find((f) => f.id === place)?.name ?? "Decks");
}

/** Where an item is now. */
export function placeOf(lib: Snapshot, item: Item): Place {
  return item.kind === "deck"
    ? (lib.decks.find((d) => d.id === item.id)?.folderId ?? null)
    : (lib.folders.find((f) => f.id === item.id)?.parentId ?? null);
}

/** Why an item can't move to a place, if it can't: it's there already, or it's itself or inside itself. */
export function cantMoveTo(
  lib: Snapshot,
  item: Item,
  place: Place,
): "current" | "self" | "inside" | undefined {
  if (placeOf(lib, item) === place) return "current";
  if (item.kind === "folder" && place !== null) {
    if (place === item.id) return "self";
    if (foldersInside(lib, item.id).has(place)) return "inside";
  }
  return undefined;
}

export type TreeRow = { place: Place; name: string; depth: number; hasChildren: boolean };

/** The whole folder tree as rows, "Decks" (the root) on top, each level A–Z. */
export function treeRows(lib: Snapshot): TreeRow[] {
  const rows: TreeRow[] = [
    { place: null, name: "Decks", depth: 0, hasChildren: lib.folders.some((f) => !f.parentId) },
  ];
  const walk = (parent: string | null, depth: number) => {
    for (const f of sortItems(
      lib.folders.filter((x) => x.parentId === parent),
      "alphabetical",
    )) {
      rows.push({
        place: f.id,
        name: f.name,
        depth,
        hasChildren: lib.folders.some((x) => x.parentId === f.id),
      });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  return rows;
}

const key = (name: string) => name.trim().toLocaleLowerCase();
export const FOLDER_NAME_TAKEN = "There's already a folder with this name here.";
export const DECK_NAME_TAKEN = "There's already a deck with this name here.";

function nameProblem(kind: "deck" | "folder", name: string): string | undefined {
  if (name.trim() === "") return `Give the ${kind} a name.`;
  if (name.trim().length > 100) return "Keep the name to 100 characters.";
  return undefined;
}

function sibling(kind: "deck" | "folder", place: Place, name: string, except?: string) {
  const list =
    kind === "deck"
      ? decks.filter((d) => d.folderId === place)
      : folders.filter((f) => f.parentId === place);
  return list.find((x) => x.id !== except && key(x.name) === key(name));
}

export type Result = { ok: true; id: string } | { ok: false; error: string };

export function createFolder(name: string, parentId: Place): Result {
  const problem =
    nameProblem("folder", name) ?? (sibling("folder", parentId, name) && FOLDER_NAME_TAKEN);
  if (problem) return { ok: false, error: problem };
  const folder = {
    id: crypto.randomUUID(),
    name: name.trim(),
    parentId,
    createdAt: new Date().toISOString(),
  };
  folders = [...folders, folder];
  commit();
  return { ok: true, id: folder.id };
}

export function renameFolder(id: string, name: string): Result {
  const at = folderById(id);
  if (!at) return { ok: false, error: "This folder was deleted meanwhile." };
  const problem =
    nameProblem("folder", name) ?? (sibling("folder", at.parentId, name, id) && FOLDER_NAME_TAKEN);
  if (problem) return { ok: false, error: problem };
  folders = folders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f));
  commit();
  return { ok: true, id };
}

const clean = (d: string) => (d.trim() === "" ? null : d.trim());

export function createDeck(name: string, description: string, folderId: Place): Result {
  const problem = nameProblem("deck", name) ?? (sibling("deck", folderId, name) && DECK_NAME_TAKEN);
  if (problem) return { ok: false, error: problem };
  const deck = {
    id: crypto.randomUUID(),
    name: name.trim(),
    description: clean(description),
    folderId,
    createdAt: new Date().toISOString(),
  };
  decks = [...decks, deck];
  commit();
  return { ok: true, id: deck.id };
}

export function updateDeck(id: string, name: string, description: string): Result {
  const at = decks.find((d) => d.id === id);
  if (!at) return { ok: false, error: "This deck was deleted meanwhile." };
  const problem =
    nameProblem("deck", name) ?? (sibling("deck", at.folderId, name, id) && DECK_NAME_TAKEN);
  if (problem) return { ok: false, error: problem };
  decks = decks.map((d) =>
    d.id === id ? { ...d, name: name.trim(), description: clean(description) } : d,
  );
  commit();
  return { ok: true, id };
}

export function deleteFolder(id: string): void {
  const gone = new Set([id, ...foldersInside(snapshot, id)]);
  folders = folders.filter((f) => !gone.has(f.id));
  decks = decks.filter((d) => d.folderId === null || !gone.has(d.folderId));
  commit();
}

export function deleteDeck(id: string): void {
  decks = decks.filter((d) => d.id !== id);
  commit();
}

/** "Cells (2)", then "(3)", cut short to stay within 100 characters. */
export function nextFreeName(name: string, taken: (candidate: string) => boolean): string {
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = name.slice(0, 100 - suffix.length).trimEnd() + suffix;
    if (!taken(candidate)) return candidate;
  }
}

export type Clash = {
  item: Item;
  itemName: string;
  destination: Place;
  destinationName: string;
  existing: { id: string; name: string; inside: string };
  replaceAllowed: boolean;
  keepBothName: string;
};

export type MoveOutcome = { ok: true } | { ok: false; clash: Clash } | { ok: false; error: string };

/** Moves an item, or answers the clash a same-named neighbour at the destination makes. */
export function move(
  item: Item,
  destination: Place,
  onClash?: "replace" | "keepBoth",
): MoveOutcome {
  const why = cantMoveTo(snapshot, item, destination);
  if (why === "self" || why === "inside")
    return { ok: false, error: "A folder can't go inside itself." };
  if (why === "current") return { ok: true };
  const own = item.kind === "deck" ? decks.find((d) => d.id === item.id) : folderById(item.id);
  if (!own) return { ok: false, error: "This was deleted meanwhile." };
  const existing = sibling(item.kind, destination, own.name);
  let name = own.name;
  if (existing) {
    const replaceAllowed =
      item.kind === "deck" ||
      !(existing.id === item.id || pathTo(snapshot, item.id).some((f) => f.id === existing.id));
    if (onClash === undefined) {
      return {
        ok: false,
        clash: {
          item,
          itemName: own.name,
          destination,
          destinationName: placeName(snapshot, destination),
          existing: {
            id: existing.id,
            name: existing.name,
            inside: item.kind === "folder" ? countLabel(countInside(snapshot, existing.id)) : "",
          },
          replaceAllowed,
          keepBothName: nextFreeName(
            own.name,
            (c) => sibling(item.kind, destination, c) !== undefined,
          ),
        },
      };
    }
    if (onClash === "replace") {
      if (!replaceAllowed) return { ok: false, error: "Replace isn't possible here." };
      if (item.kind === "deck") deleteDeck(existing.id);
      else deleteFolder(existing.id);
    } else {
      name = nextFreeName(own.name, (c) => sibling(item.kind, destination, c) !== undefined);
    }
  }
  if (item.kind === "deck") {
    decks = decks.map((d) => (d.id === item.id ? { ...d, folderId: destination, name } : d));
  } else {
    folders = folders.map((f) => (f.id === item.id ? { ...f, parentId: destination, name } : f));
  }
  commit();
  return { ok: true };
}

// The states' fixtures.

/**
 * `deep`: a chain five folders deep (Maths › Analysis › Real analysis ›
 * Measure theory › Lebesgue integration), added once, with one deck at its end.
 * Answers the deepest folder's ID.
 */
export function ensureDeep(): string {
  const found = folders.find((f) => f.name === "Lebesgue integration");
  if (found) return found.id;
  const real = { id: "deep-1", name: "Real analysis", parentId: F.analysis, createdAt: ago(10) };
  const measure = { id: "deep-2", name: "Measure theory", parentId: real.id, createdAt: ago(9) };
  const lebesgue = {
    id: "deep-3",
    name: "Lebesgue integration",
    parentId: measure.id,
    createdAt: ago(8),
  };
  folders = [...folders, real, measure, lebesgue];
  decks = [
    ...decks,
    {
      id: "deep-deck",
      name: "Dominated convergence",
      description: "The theorem, its proof and the examples where it fails.",
      folderId: lebesgue.id,
      createdAt: ago(7),
    },
  ];
  commit();
  return lebesgue.id;
}

/** `clash` on the folder page: Analysis moved into Archive, which already has an Analysis. */
export function folderClashFixture(folder: Folder): Clash {
  return {
    item: { kind: "folder", id: folder.id },
    itemName: folder.name,
    destination: F.archive,
    destinationName: "Archive",
    existing: { id: "clash-folder", name: folder.name, inside: "3 decks" },
    replaceAllowed: true,
    keepBothName: `${folder.name} (2)`,
  };
}

/** `clash` on the deck page: the deck moved to the root, which already has a deck of its name. */
export function deckClashFixture(deck: Deck): Clash {
  return {
    item: { kind: "deck", id: deck.id },
    itemName: deck.name,
    destination: null,
    destinationName: "Decks",
    existing: { id: "clash-deck", name: deck.name, inside: "" },
    replaceAllowed: true,
    keepBothName: nextFreeName(deck.name, () => false),
  };
}

/** The `?state=` a Variant's screen opens in, so every state has a URL. */
export function useProtoState(): string | undefined {
  const search: Record<string, unknown> = useSearch({ strict: false });
  return splitState(search["state"]).state;
}

/** Whether this device drags with a mouse or trackpad: touch moves with Move… only. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = matchMedia("(pointer: fine)");
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => matchMedia("(pointer: fine)").matches,
  );
}

// Drag and drop: the item being dragged, shared between tiles and breadcrumb items.
let dragging: Item | undefined;
const dragListeners = new Set<() => void>();
export function setDragging(item: Item | undefined) {
  dragging = item;
  for (const l of dragListeners) l();
}
export function useDragging(): Item | undefined {
  return useSyncExternalStore(
    (l) => {
      dragListeners.add(l);
      return () => {
        dragListeners.delete(l);
      };
    },
    () => dragging,
  );
}

/** What DeckDialog's success carries; the prototype's screens read the store instead. */
export function protoDeck(id: string, form: { name: string; description: string }): DeckResponse {
  return {
    id,
    name: form.name,
    description: form.description,
    createdAt: new Date().toISOString(),
  };
}
