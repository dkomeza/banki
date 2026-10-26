import { CARD_SIDE_MAX_LENGTH, CardListResponse, CardResponse } from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { CANT_REACH, deckQueryOptions, decksQueryOptions } from "./decks";
import { ApiRequestError } from "./query";

export type Card = CardResponse;

/** A Deck's live Cards, newest first, from `GET /api/decks/:deckId/cards`; null for no such Deck. */
export const cardsQueryOptions = (deckId: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["decks", deckId, "cards"],
    queryFn: async (): Promise<Card[] | null> => {
      const res = await client.api.decks[":deckId"].cards.$get({ param: { deckId } });
      // Widened: the client's types know only the statuses the route answers.
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return CardListResponse.parse(await res.json());
    },
  });

/** One Card, from `GET /api/cards/:id`; null when it, or its Deck, is unknown or deleted. */
export const cardQueryOptions = (id: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["cards", id],
    queryFn: async (): Promise<Card | null> => {
      const res = await client.api.cards[":id"].$get({ param: { id } });
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return CardResponse.parse(await res.json());
    },
  });

/** A Card's two sides, as typed. */
export type Sides = { front: string; back: string };

/** What each side's field says is wrong with it. */
export type SideErrors = { front?: string; back?: string };

/** What's wrong with a side, if anything, before it is sent; `name` is "Front" or "Back". */
export function sideProblem(side: string, name: "Front" | "Back"): string | undefined {
  if (side.trim() === "") return `Write the ${name}.`;
  if (side.length > CARD_SIDE_MAX_LENGTH) {
    return `Keep the ${name} to ${CARD_SIDE_MAX_LENGTH.toLocaleString("en-GB")} characters.`;
  }
  return undefined;
}

/** What's wrong with each side, empty when both may be sent. */
export function sideErrors({ front, back }: Sides): SideErrors {
  const errors: SideErrors = {};
  const onFront = sideProblem(front, "Front");
  const onBack = sideProblem(back, "Back");
  if (onFront !== undefined) errors.front = onFront;
  if (onBack !== undefined) errors.back = onBack;
  return errors;
}

/** Whether the fields hold anything not saved: a change from `saved`, as typed. */
export const hasUnsavedChanges = (fields: Sides, saved: Sides) =>
  fields.front !== saved.front || fields.back !== saved.back;

export type CardOutcome =
  | { ok: true; card: Card }
  | { ok: false; errors: SideErrors }
  | { ok: false; notFound: true }
  | { ok: false; message: string };

/** How a create or a change went, checking the sides before anything is sent. */
async function outcomeOf(
  sides: Sides,
  send: () => Promise<Response>,
  failed: string,
): Promise<CardOutcome> {
  const errors = sideErrors(sides);
  if (errors.front !== undefined || errors.back !== undefined) return { ok: false, errors };
  let res: Response;
  try {
    res = await send();
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (res.ok) return { ok: true, card: CardResponse.parse(await res.json()) };
  if (res.status === 404) return { ok: false, notFound: true };
  return { ok: false, message: failed };
}

/** Has the Deck's list, and its count, fetched again. */
async function refreshDeck(queryClient: QueryClient, deckId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: cardsQueryOptions(deckId).queryKey, exact: true }),
    queryClient.invalidateQueries({ queryKey: deckQueryOptions(deckId).queryKey, exact: true }),
    queryClient.invalidateQueries({ queryKey: decksQueryOptions().queryKey, exact: true }),
  ]);
}

/** Creates a Card in a Deck with `POST /api/decks/:deckId/cards`, and says how it went. */
export async function createCard(
  queryClient: QueryClient,
  deckId: string,
  sides: Sides,
  client: ApiClient = api,
): Promise<CardOutcome> {
  const outcome = await outcomeOf(
    sides,
    () => client.api.decks[":deckId"].cards.$post({ param: { deckId }, json: sides }),
    "Banki couldn't save the card. Try again.",
  );
  if (outcome.ok) {
    queryClient.setQueryData(cardQueryOptions(outcome.card.id).queryKey, outcome.card);
    await refreshDeck(queryClient, deckId);
  }
  return outcome;
}

/** Changes a Card's sides with `PATCH /api/cards/:id`, and says how it went. */
export async function updateCard(
  queryClient: QueryClient,
  id: string,
  sides: Sides,
  client: ApiClient = api,
): Promise<CardOutcome> {
  const outcome = await outcomeOf(
    sides,
    () => client.api.cards[":id"].$patch({ param: { id }, json: sides }),
    "Banki couldn't save the card. Try again.",
  );
  if (outcome.ok) {
    queryClient.setQueryData(cardQueryOptions(id).queryKey, outcome.card);
    await refreshDeck(queryClient, outcome.card.deckId);
  }
  return outcome;
}

/**
 * Deletes a Card with `DELETE /api/cards/:id`, taking it out of its Deck's
 * list at once. A Card that is gone already counts as deleted. Answers a
 * message when it couldn't be deleted, putting it back in the list.
 */
export async function deleteCard(
  queryClient: QueryClient,
  card: Card,
  client: ApiClient = api,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const listKey = cardsQueryOptions(card.deckId).queryKey;
  queryClient.setQueryData(listKey, (cards) => cards?.filter((c) => c.id !== card.id));
  let res: Response | undefined;
  try {
    res = await client.api.cards[":id"].$delete({ param: { id: card.id } });
  } catch {
    res = undefined;
  }
  if (res === undefined || (!res.ok && res.status !== 404)) {
    await refreshDeck(queryClient, card.deckId);
    return {
      ok: false,
      message: res === undefined ? CANT_REACH : "Banki couldn't delete the card. Try again.",
    };
  }
  queryClient.removeQueries({ queryKey: cardQueryOptions(card.id).queryKey, exact: true });
  await refreshDeck(queryClient, card.deckId);
  return { ok: true };
}

/**
 * Undoes a Card's delete with `POST /api/cards/:id/restore`, putting it back
 * in its Deck's list. Answers a message when it couldn't, such as when its
 * Deck was deleted meanwhile.
 */
export async function restoreCard(
  queryClient: QueryClient,
  card: Card,
  client: ApiClient = api,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await client.api.cards[":id"].restore.$post({ param: { id: card.id } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (res.status === 404) {
    return { ok: false, message: "Couldn't undo: the card's deck was deleted." };
  }
  if (!res.ok) return { ok: false, message: "Banki couldn't bring the card back. Try again." };
  queryClient.setQueryData(
    cardQueryOptions(card.id).queryKey,
    CardResponse.parse(await res.json()),
  );
  await refreshDeck(queryClient, card.deckId);
  return { ok: true };
}

/** "12 cards", "1 card", "No cards". */
export function cardCountLabel(count: number): string {
  if (count === 0) return "No cards";
  return count === 1 ? "1 card" : `${count} cards`;
}
