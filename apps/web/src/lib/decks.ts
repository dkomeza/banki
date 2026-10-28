import {
  ApiError,
  DECK_DESCRIPTION_MAX_LENGTH,
  DECK_NAME_MAX_LENGTH,
  DeckListResponse,
  DeckResponse,
  type UpdateDeckRequest,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { deletionIdOf, deletionsQueryOptions } from "./deletions";
import { ApiRequestError } from "./query";

export type Deck = DeckResponse;

/** The User's Decks that aren't deleted, from `GET /api/decks`. */
export const decksQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["decks"],
    queryFn: async (): Promise<Deck[]> => {
      const res = await client.api.decks.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return DeckListResponse.parse(await res.json());
    },
  });

/** One Deck, from `GET /api/decks/:id`; null when it is unknown or deleted. */
export const deckQueryOptions = (id: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["decks", id],
    queryFn: async (): Promise<Deck | null> => {
      const res = await client.api.decks[":id"].$get({ param: { id } });
      // Widened: the client's types know only the statuses the route answers.
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return DeckResponse.parse(await res.json());
    },
  });

// What creating, editing and deleting a Deck say, and under which field.

export const CANT_REACH = "Can't reach Banki. Check your connection and try again.";

/** What the name field says when another Deck beside it has the name. */
export const NAME_TAKEN = "There's already a deck with this name here.";

export type DeckOutcome =
  | { ok: true; deck: Deck }
  | { ok: false; field: "name" | "form"; message: string };

/** What's wrong with a name, if anything, before it is sent. */
export function deckNameProblem(name: string): string | undefined {
  if (name.trim() === "") return "Give the deck a name.";
  if (name.trim().length > DECK_NAME_MAX_LENGTH) return "Keep the name to 100 characters.";
  return undefined;
}

/** What's wrong with a description, if anything, before it is sent. */
export function deckDescriptionProblem(description: string): string | undefined {
  if (description.trim().length > DECK_DESCRIPTION_MAX_LENGTH) {
    return "Keep the description to 1,000 characters.";
  }
  return undefined;
}

/** How a create or an edit went, from the API's answer. */
async function outcomeOf(send: () => Promise<Response>, failed: string): Promise<DeckOutcome> {
  let res: Response;
  try {
    res = await send();
  } catch {
    return { ok: false, field: "form", message: CANT_REACH };
  }
  if (res.ok) return { ok: true, deck: DeckResponse.parse(await res.json()) };
  const parsed = ApiError.safeParse(await res.json().catch(() => undefined));
  const code = parsed.success ? parsed.data.error.code : undefined;
  if (code === "deck_name_taken") return { ok: false, field: "name", message: NAME_TAKEN };
  if (code === "not_found") {
    return {
      ok: false,
      field: "form",
      message: "This deck, or its folder, was deleted meanwhile.",
    };
  }
  return { ok: false, field: "form", message: failed };
}

/** Puts a created or changed Deck into the cache, and has the list fetched again. */
async function remember(queryClient: QueryClient, outcome: DeckOutcome) {
  if (!outcome.ok) return;
  queryClient.setQueryData(deckQueryOptions(outcome.deck.id).queryKey, outcome.deck);
  await queryClient.invalidateQueries({ queryKey: decksQueryOptions().queryKey, exact: true });
}

/** Creates a Deck with `POST /api/decks`, in `folderId` (null for the Root), and says how it went. */
export async function createDeck(
  queryClient: QueryClient,
  body: { name: string; description: string | null; folderId: string | null },
  client: ApiClient = api,
): Promise<DeckOutcome> {
  const outcome = await outcomeOf(
    () => client.api.decks.$post({ json: body }),
    "Banki couldn't create the deck. Try again.",
  );
  await remember(queryClient, outcome);
  return outcome;
}

/** Changes a Deck with `PATCH /api/decks/:id`, and says how it went. */
export async function updateDeck(
  queryClient: QueryClient,
  id: string,
  body: UpdateDeckRequest,
  client: ApiClient = api,
): Promise<DeckOutcome> {
  const outcome = await outcomeOf(
    () => client.api.decks[":id"].$patch({ param: { id }, json: body }),
    "Banki couldn't save the deck. Try again.",
  );
  await remember(queryClient, outcome);
  return outcome;
}

/**
 * Deletes a Deck with `DELETE /api/decks/:id`, answering its Deletion's ID for
 * Undo. A Deck that is gone already counts as deleted, with no Deletion to
 * undo. Answers a message when it couldn't be deleted. The Deck's own
 * cache entry stays until {@link forgetDeck}, so its page doesn't turn into
 * "Deck not found" before it is left.
 */
export async function deleteDeck(
  queryClient: QueryClient,
  id: string,
  client: ApiClient = api,
): Promise<{ ok: true; deletionId?: string } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await client.api.decks[":id"].$delete({ param: { id } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (!res.ok && res.status !== 404) {
    return { ok: false, message: "Banki couldn't delete the deck. Try again." };
  }
  const deletionId = await deletionIdOf(res);
  queryClient.setQueryData(decksQueryOptions().queryKey, (decks) =>
    decks?.filter((deck) => deck.id !== id),
  );
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: decksQueryOptions().queryKey, exact: true }),
    queryClient.invalidateQueries({ queryKey: deletionsQueryOptions().queryKey }),
  ]);
  return { ok: true, deletionId };
}

/** How Home and every Folder's page sort their Folders and their Decks. */
export type DeckSort = "alphabetical" | "newest";

/** What the sorts need of a Deck or a Folder. */
type Sortable = { id: string; name: string; createdAt: string };

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Decks or Folders in `sort` order. Alphabetical ignores case and puts numbers in
 * natural order ("Calculus 2" before "Calculus 10"); Newest is by creation
 * time, newest first. Ties fall back to the other order, then the ID, so the
 * order never changes between loads.
 */
export function sortItems<T extends Sortable>(items: readonly T[], sort: DeckSort): T[] {
  const newest = (a: T, b: T) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const alphabetical = (a: T, b: T) => byName.compare(a.name, b.name);
  const [first, second] = sort === "newest" ? [newest, alphabetical] : [alphabetical, newest];
  return items.toSorted(
    (a, b) => first(a, b) || second(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** A short creation date: "12 Sept" this year, "12 Sept 2025" before. */
export function createdLabel(createdAt: string, now = new Date()): string {
  const date = new Date(createdAt);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Drops a deleted Deck's own cache entries, its Cards' list too, once its page is left. */
export function forgetDeck(queryClient: QueryClient, id: string) {
  queryClient.removeQueries({ queryKey: deckQueryOptions(id).queryKey });
}
