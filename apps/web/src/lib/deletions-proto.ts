// Prototype only (BAN-13): the Deletions Recently deleted lists, as the spec's
// Seed data will hold them, timed relative to now, and the wording each Variant
// shows them with. There is no API yet: Restore and Delete permanently act on
// this list in the page alone, and a reload brings everything back.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A Deletion is removed this long after it. */
export const KEPT_MS = 30 * DAY_MS;

export type Kind = "folder" | "deck" | "card";

/** What Restore would do with a Deletion, as the API will answer it. */
export type RestoreOutcome =
  | { kind: "restored" }
  | { kind: "root" }
  | { kind: "renamed"; name: string }
  | { kind: "refused"; deck: string; deletionId: string };

export type Deletion = {
  id: string;
  deletedAt: Date;
  removesAt: Date;
  top: { kind: Kind; name: string };
  /** A Deck's or Folder's Folder names from the Root; a Card's Deck. */
  where: { path: string[] } | { deck: string };
  counts: { folders: number; decks: number; cards: number };
  restore: RestoreOutcome;
};

type Fixture = Omit<Deletion, "deletedAt" | "removesAt"> & { hoursAgo: number };

const FIXTURES: Fixture[] = [
  {
    id: "physics",
    hoursAgo: 3,
    top: { kind: "folder", name: "Physics" },
    where: { path: [] },
    counts: { folders: 1, decks: 2, cards: 30 },
    restore: { kind: "restored" },
  },
  {
    id: "madrugada",
    hoursAgo: 5.5,
    top: { kind: "card", name: "la madrugada" },
    where: { deck: "Spanish vocabulary" },
    counts: { folders: 0, decks: 0, cards: 0 },
    restore: { kind: "restored" },
  },
  {
    id: "statistics",
    hoursAgo: 26,
    top: { kind: "deck", name: "Statistics" },
    where: { path: ["Maths"] },
    counts: { folders: 0, decks: 0, cards: 12 },
    restore: { kind: "restored" },
  },
  {
    id: "spanish",
    hoursAgo: 4 * 24 + 3,
    top: { kind: "deck", name: "Spanish vocabulary" },
    where: { path: ["Languages"] },
    counts: { folders: 0, decks: 0, cards: 24 },
    restore: { kind: "renamed", name: "Spanish vocabulary (2)" },
  },
  {
    id: "old-semester",
    hoursAgo: 8 * 24 + 6,
    top: { kind: "folder", name: "Old semester" },
    where: { path: [] },
    counts: { folders: 0, decks: 1, cards: 9 },
    restore: { kind: "restored" },
  },
  {
    id: "linear-algebra",
    hoursAgo: 10 * 24 + 2,
    top: { kind: "deck", name: "Linear algebra" },
    where: { path: ["Old semester"] },
    counts: { folders: 0, decks: 0, cards: 16 },
    restore: { kind: "root" },
  },
  {
    id: "german",
    hoursAgo: 15 * 24 + 4,
    top: { kind: "deck", name: "German verbs" },
    where: { path: ["Languages"] },
    counts: { folders: 0, decks: 0, cards: 40 },
    restore: { kind: "restored" },
  },
  {
    id: "termin",
    hoursAgo: 20 * 24 + 1,
    top: { kind: "card", name: "der Termin" },
    where: { deck: "German verbs" },
    counts: { folders: 0, decks: 0, cards: 0 },
    restore: { kind: "refused", deck: "German verbs", deletionId: "german" },
  },
  {
    id: "calculus1",
    hoursAgo: 29 * 24 + 2,
    top: { kind: "deck", name: "Calculus 1" },
    where: { path: ["Maths", "Analysis"] },
    counts: { folders: 0, decks: 0, cards: 0 },
    restore: { kind: "restored" },
  },
];

/** The Deletions, newest first, as `GET /api/deletions` will answer them at `now`. */
export function seedDeletions(now = new Date()): Deletion[] {
  return FIXTURES.map(({ hoursAgo, ...rest }) => {
    const deletedAt = new Date(now.getTime() - hoursAgo * HOUR_MS);
    return { ...rest, deletedAt, removesAt: new Date(deletedAt.getTime() + KEPT_MS) };
  });
}

/** Whole days until Removal, rounded up: "29 days left", "1 day left". */
export function daysLeft(removesAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((removesAt.getTime() - now.getTime()) / DAY_MS));
}

export const daysLeftLabel = (days: number) => (days === 1 ? "1 day left" : `${days} days left`);

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "2 decks, 1 folder and 30 cards", or "" for nothing. */
export function countsLabel({ folders, decks, cards }: Deletion["counts"]): string {
  const parts = [];
  if (decks > 0) parts.push(counted(decks, "deck"));
  if (folders > 0) parts.push(counted(folders, "folder"));
  if (cards > 0) parts.push(counted(cards, "card"));
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** "with 2 decks, 1 folder and 30 cards", or "" for a Card or an empty Deck or Folder. */
export function withLabel(d: Deletion): string {
  const counts = countsLabel(d.counts);
  return counts === "" ? "" : `with ${counts}`;
}

/** Where it was: "Decks › Maths" for a Deck or Folder, the Deck for a Card. */
export function whereLabel(d: Deletion): string {
  return "deck" in d.where ? d.where.deck : ["Decks", ...d.where.path].join(" › ");
}

export const kindLabel = (kind: Kind) =>
  kind === "folder" ? "Folder" : kind === "deck" ? "Deck" : "Card";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Today, 10:00", "Yesterday, 11:00", "22 Oct". */
export function deletedLabel(deletedAt: Date, now = new Date()): string {
  const time = deletedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(deletedAt, now)) return `Today, ${time}`;
  if (sameDay(deletedAt, new Date(now.getTime() - DAY_MS))) return `Yesterday, ${time}`;
  return deletedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "3 hours ago", "yesterday", "4 days ago". */
export function agoLabel(deletedAt: Date, now = new Date()): string {
  const hours = Math.floor((now.getTime() - deletedAt.getTime()) / HOUR_MS);
  if (hours < 1) return "just now";
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The Delete permanently question, naming what goes. */
export function deleteQuestion(d: Deletion): string {
  const counts = countsLabel(d.counts);
  const what =
    d.top.kind === "card"
      ? `the card “${d.top.name}”`
      : counts === ""
        ? d.top.name
        : `${d.top.name} and the ${counts} in it`;
  return `Delete ${what} permanently? This can't be undone.`;
}

/** The toast after a Restore: "Physics restored", or why it went elsewhere or couldn't. */
export function restoredMessage(d: Deletion): string {
  const r = d.restore;
  if (r.kind === "root") return `${d.top.name} restored to Decks`;
  if (r.kind === "renamed") return `Restored as ${r.name}`;
  if (r.kind === "refused") return `Restore ${r.deck} first`;
  return d.top.kind === "card" ? "Card restored" : `${d.top.name} restored`;
}

/** Which Deletion each `?state=` acts on as the page loads. */
export const STATE_TARGETS = {
  restored: "physics",
  "restored-root": "linear-algebra",
  "restored-renamed": "spanish",
  refused: "termin",
  delete: "physics",
} as const;

export const DELETED_STATES = [
  "empty",
  "restored",
  "restored-root",
  "restored-renamed",
  "refused",
  "delete",
] as const;
export type DeletedState = (typeof DELETED_STATES)[number];

export function parseDeletedState(search: Record<string, unknown>): { state?: DeletedState } {
  const state = DELETED_STATES.find((s) => s === search["state"]);
  return state === undefined ? {} : { state };
}
