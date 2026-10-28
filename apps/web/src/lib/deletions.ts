import {
  DeleteResponse,
  DeletionListResponse,
  type DeletionKind,
  type DeletionResponse,
  PlaceDeletedError,
  RestoreResponse,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { CANT_REACH } from "./decks";
import { ROOT_NAME } from "./folders";
import { ApiRequestError } from "./query";

export type Deletion = DeletionResponse;
export type Restored = RestoreResponse;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The User's Deletions not removed, newest first, from `GET /api/deletions`. */
export const deletionsQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["deletions"],
    queryFn: async (): Promise<Deletion[]> => {
      const res = await client.api.deletions.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return DeletionListResponse.parse(await res.json());
    },
  });

/** The `deletionId` a `DELETE` of a Card, Deck or Folder answers, if it answered one. */
export async function deletionIdOf(res: Response): Promise<string | undefined> {
  if (!res.ok) return undefined;
  const parsed = DeleteResponse.safeParse(await res.json().catch(() => undefined));
  return parsed.success ? parsed.data.deletionId : undefined;
}

/**
 * Has everything a Restore or a Removal can change fetched again: Recently
 * deleted, the Folders and Decks, each Deck's Cards and each Card.
 */
export async function refreshAfterDeletion(queryClient: QueryClient) {
  await Promise.all(
    [["deletions"], ["folders"], ["decks"], ["cards"]].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

export type RestoreOutcome =
  | { ok: true; restored: Restored }
  | { ok: false; placeDeleted: { id: string; name: string } }
  | { ok: false; message: string };

/**
 * Restores a Deletion with `POST /api/deletions/:id/restore`, and says how it
 * went: where it came back and under which name, or which Deck must be
 * restored first. One that's gone already says so.
 */
export async function restoreDeletion(
  queryClient: QueryClient,
  id: string,
  client: ApiClient = api,
): Promise<RestoreOutcome> {
  let res: Response;
  try {
    res = await client.api.deletions[":id"].restore.$post({ param: { id } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  const status: number = res.status;
  if (res.ok) {
    const restored = RestoreResponse.parse(await res.json());
    await refreshAfterDeletion(queryClient);
    return { ok: true, restored };
  }
  if (status === 409) {
    const refused = PlaceDeletedError.safeParse(await res.json().catch(() => undefined));
    if (refused.success) return { ok: false, placeDeleted: refused.data.deck };
  }
  if (status === 404) {
    await refreshAfterDeletion(queryClient);
    return { ok: false, message: "It's no longer in Recently deleted." };
  }
  return { ok: false, message: "Banki couldn't restore it. Try again." };
}

/**
 * Removes a Deletion at once with `DELETE /api/deletions/:id` (Delete
 * permanently), taking it out of Recently deleted. One that's gone already
 * counts as removed. Answers a message when it couldn't be removed.
 */
export async function removeDeletion(
  queryClient: QueryClient,
  id: string,
  client: ApiClient = api,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await client.api.deletions[":id"].$delete({ param: { id } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (!res.ok && res.status !== 404) {
    return { ok: false, message: "Banki couldn't delete it permanently. Try again." };
  }
  queryClient.setQueryData(deletionsQueryOptions().queryKey, (all) =>
    all?.filter((d) => d.id !== id),
  );
  await queryClient.invalidateQueries({ queryKey: deletionsQueryOptions().queryKey });
  return { ok: true };
}

// How Recently deleted words a Deletion.

/** Whole days until Removal, rounded up, never below 0. */
export function daysLeft(removesAt: string, now = new Date()): number {
  return Math.max(0, Math.ceil((Date.parse(removesAt) - now.getTime()) / DAY_MS));
}

/** "29 days left", "1 day left". */
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

/** A Card's name: the first line of its Front with something on it. */
export function firstLine(front: string): string {
  return (
    front
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? front.trim()
  );
}

/** What Recently deleted calls its top item: a Card by its Front's first line. */
export const nameOf = (d: Deletion) => (d.top.kind === "card" ? firstLine(d.top.name) : d.top.name);

/** Where it was: "Decks › Maths" for a Deck or Folder, its Deck for a Card. */
export function whereLabel(d: Deletion): string {
  if (d.deck !== null) return d.deck.name;
  return [ROOT_NAME, ...(d.path ?? [])].join(" › ");
}

export const kindLabel = (kind: DeletionKind) =>
  kind === "folder" ? "Folder" : kind === "deck" ? "Deck" : "Card";

/** The start of `date`'s day, in this device's timezone. */
const midnight = (date: Date) => new Date(date.toDateString()).getTime();

/** How many days, by this device's calendar, lie between `deletedAt` and `now`. */
const calendarDays = (deletedAt: string, now: Date) =>
  Math.round((midnight(now) - midnight(new Date(deletedAt))) / DAY_MS);

/**
 * "just now", "3 hours ago", "yesterday", "4 days ago". Past a day it counts
 * calendar days, as `groupOf` does, so a tile never says "yesterday" under
 * "This week".
 */
export function agoLabel(deletedAt: string, now = new Date()): string {
  const hours = Math.floor((now.getTime() - Date.parse(deletedAt)) / HOUR_MS);
  if (hours < 1) return "just now";
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = calendarDays(deletedAt, now);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Which group Recently deleted shows it under: "Today", "Yesterday", "This week" or "Earlier". */
export function groupOf(deletedAt: string, now = new Date()): string {
  const days = calendarDays(deletedAt, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

/** The Delete permanently question, naming what goes. */
export function deleteQuestion(d: Deletion): string {
  const counts = countsLabel(d.counts);
  const what =
    d.top.kind === "card"
      ? `the card “${nameOf(d)}”`
      : counts === ""
        ? d.top.name
        : `${d.top.name} and the ${counts} in it`;
  return `Delete ${what} permanently? This can't be undone.`;
}

/**
 * The toast after a Restore or an Undo: "Maths restored", "Calculus 2 restored
 * to Decks" or "Restored as Spanish vocabulary (2)", with a second line saying
 * where it is now. `was` is its name before, and `where` where it was.
 */
export function restoredToast(restored: Restored, was: string, where: string) {
  const { kind, name, movedToRoot, renamed } = restored;
  if (renamed) {
    const place = movedToRoot ? ROOT_NAME : where;
    return {
      title: `Restored as ${name}`,
      description: `${place} already has a ${kind} called ${was}${movedToRoot ? ", and its folder is deleted" : ""}.`,
    };
  }
  if (movedToRoot) {
    return {
      title: `${name} restored to ${ROOT_NAME}`,
      description: `Its folder is deleted, so it's back at the top of ${ROOT_NAME}.`,
    };
  }
  return {
    title: kind === "card" ? "Card restored" : `${name} restored`,
    description: `Back in ${where}.`,
  };
}
