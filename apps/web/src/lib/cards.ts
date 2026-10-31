import {
  CARD_SIDE_MAX_LENGTH,
  CardListResponse,
  CardResponse,
  DeleteCardsResponse,
  GRADING_NOTES_MAX_LENGTH,
  MoveCardsResponse,
  frontKey,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { CANT_REACH, deckQueryOptions, decksQueryOptions } from "./decks";
import { deletionIdOf, deletionsQueryOptions } from "./deletions";
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

/** A Card's two sides and its Grading notes, as typed: blank notes are none. */
export type CardFields = { front: string; back: string; gradingNotes: string };

/** What each field says is wrong with it. */
export type FieldErrors = { front?: string; back?: string; gradingNotes?: string };

/** A Card's fields as it was saved, to write it again from: none for notes is blank. */
export const fieldsOf = (card: Card): CardFields => ({
  front: card.front,
  back: card.back,
  gradingNotes: card.gradingNotes ?? "",
});

/** The fields as the API takes them: blank Grading notes are none. */
const bodyOf = ({ front, back, gradingNotes }: CardFields) => ({
  front,
  back,
  gradingNotes: gradingNotes.trim() === "" ? null : gradingNotes,
});

/** Each Card's Front key, worked out once per Card the cache holds. */
const frontKeys = new WeakMap<Card, string>();
const keyOf = (card: Card) => {
  let key = frontKeys.get(card);
  if (key === undefined) {
    key = frontKey(card.front);
    frontKeys.set(card, key);
  }
  return key;
};

/**
 * The Cards of `cards`, a Deck's live Cards, that a Card with `front` would be
 * a Duplicate of, newest first. The Card `selfId` names, the one being edited,
 * never matches itself, and a Front with an empty key matches nothing.
 */
export function duplicatesOf(front: string, cards: readonly Card[], selfId?: string): Card[] {
  const key = frontKey(front);
  if (key === "") return [];
  return cards
    .filter((card) => card.id !== selfId && keyOf(card) === key)
    .toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** What's wrong with a side, if anything, before it is sent; `name` is "Front" or "Back". */
export function sideProblem(side: string, name: "Front" | "Back"): string | undefined {
  if (side.trim() === "") return `Write the ${name}.`;
  if (side.length > CARD_SIDE_MAX_LENGTH) {
    return `Keep the ${name} to ${CARD_SIDE_MAX_LENGTH.toLocaleString("en-GB")} characters.`;
  }
  return undefined;
}

/** What's wrong with Grading notes, if anything, before they are sent: none are fine. */
export function gradingNotesProblem(notes: string): string | undefined {
  if (notes.trim() !== "" && notes.length > GRADING_NOTES_MAX_LENGTH) {
    return `Keep grading notes to ${GRADING_NOTES_MAX_LENGTH.toLocaleString("en-GB")} characters.`;
  }
  return undefined;
}

/** What's wrong with each field, empty when they may be sent. */
export function fieldErrors({ front, back, gradingNotes }: CardFields): FieldErrors {
  const errors: FieldErrors = {};
  const onFront = sideProblem(front, "Front");
  const onBack = sideProblem(back, "Back");
  const onNotes = gradingNotesProblem(gradingNotes);
  if (onFront !== undefined) errors.front = onFront;
  if (onBack !== undefined) errors.back = onBack;
  if (onNotes !== undefined) errors.gradingNotes = onNotes;
  return errors;
}

/** Whether the fields hold anything not saved: a change from `saved`, as typed. */
export const hasUnsavedChanges = (fields: CardFields, saved: CardFields) =>
  fields.front !== saved.front ||
  fields.back !== saved.back ||
  fields.gradingNotes !== saved.gradingNotes;

export type CardOutcome =
  | { ok: true; card: Card }
  | { ok: false; errors: FieldErrors }
  | { ok: false; notFound: true }
  | { ok: false; message: string };

/** How a create or a change went, checking the fields before anything is sent. */
async function outcomeOf(
  fields: CardFields,
  send: () => Promise<Response>,
  failed: string,
): Promise<CardOutcome> {
  const errors = fieldErrors(fields);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
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

/** Has the Deck's list, its count and the User's Tags fetched again. */
async function refreshDeck(queryClient: QueryClient, deckId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["tags"], exact: true }),
    queryClient.invalidateQueries({ queryKey: cardsQueryOptions(deckId).queryKey, exact: true }),
    queryClient.invalidateQueries({ queryKey: deckQueryOptions(deckId).queryKey, exact: true }),
    queryClient.invalidateQueries({ queryKey: decksQueryOptions().queryKey, exact: true }),
  ]);
}

/**
 * Creates a Card in a Deck, with its Tags and Grading notes, with
 * `POST /api/decks/:deckId/cards`, and says how it went.
 */
export async function createCard(
  queryClient: QueryClient,
  deckId: string,
  fields: CardFields,
  tags: readonly string[],
  client: ApiClient = api,
): Promise<CardOutcome> {
  const outcome = await outcomeOf(
    fields,
    () =>
      client.api.decks[":deckId"].cards.$post({
        param: { deckId },
        json: { ...bodyOf(fields), tags: [...tags] },
      }),
    "Banki couldn't save the card. Try again.",
  );
  if (outcome.ok) {
    queryClient.setQueryData(cardQueryOptions(outcome.card.id).queryKey, outcome.card);
    await refreshDeck(queryClient, deckId);
  }
  return outcome;
}

/**
 * Changes a Card's sides, Tags and Grading notes with `PATCH /api/cards/:id`,
 * and says how it went.
 */
export async function updateCard(
  queryClient: QueryClient,
  id: string,
  fields: CardFields,
  tags: readonly string[],
  client: ApiClient = api,
): Promise<CardOutcome> {
  const outcome = await outcomeOf(
    fields,
    () =>
      client.api.cards[":id"].$patch({
        param: { id },
        json: { ...bodyOf(fields), tags: [...tags] },
      }),
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
 * list at once, and answers its Deletion's ID for Undo. A Card that is gone
 * already counts as deleted, with no Deletion to undo. Answers a
 * message when it couldn't be deleted, putting it back in the list. The Card's
 * own cache entry stays until {@link forgetCard}, so its edit page doesn't turn
 * into "Card not found" before it is left.
 */
export async function deleteCard(
  queryClient: QueryClient,
  card: Card,
  client: ApiClient = api,
): Promise<{ ok: true; deletionId?: string } | { ok: false; message: string }> {
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
  const deletionId = await deletionIdOf(res);
  await Promise.all([
    refreshDeck(queryClient, card.deckId),
    queryClient.invalidateQueries({ queryKey: deletionsQueryOptions().queryKey }),
  ]);
  return { ok: true, deletionId };
}

export type MoveOutcome =
  | { ok: true; cards: Card[] }
  | { ok: false; notFound: true }
  | { ok: false; message: string };

/**
 * Moves Cards to the Deck `to` with `POST /api/cards/move`, all of them or
 * none, taking them out of their Deck's list, `from`, once moved. A Card or a
 * Deck that is gone meanwhile (404) moves nothing and says so.
 */
export async function moveCards(
  queryClient: QueryClient,
  ids: readonly string[],
  from: string,
  to: string,
  client: ApiClient = api,
): Promise<MoveOutcome> {
  let res: Response;
  try {
    res = await client.api.cards.move.$post({ json: { cardIds: [...ids], deckId: to } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  const status: number = res.status;
  if (status === 404) {
    await Promise.all([refreshDeck(queryClient, from), refreshDeck(queryClient, to)]);
    return { ok: false, notFound: true };
  }
  if (!res.ok) return { ok: false, message: "Banki couldn't move the cards. Try again." };
  const { cards } = MoveCardsResponse.parse(await res.json());
  const moved = new Set(cards.map((card) => card.id));
  queryClient.setQueryData(cardsQueryOptions(from).queryKey, (list) =>
    list?.filter((card) => !moved.has(card.id)),
  );
  for (const card of cards) queryClient.setQueryData(cardQueryOptions(card.id).queryKey, card);
  await Promise.all([refreshDeck(queryClient, from), refreshDeck(queryClient, to)]);
  return { ok: true, cards };
}

/**
 * Deletes Cards at once with `POST /api/cards/delete`, each as a Deletion of
 * its own, taking them out of their Deck's list at once, and answers their
 * Deletions' IDs for Undo. All of them are deleted or none: when one is gone
 * already, or the delete fails, they come back in the list with a message.
 */
export async function deleteCards(
  queryClient: QueryClient,
  deckId: string,
  ids: readonly string[],
  client: ApiClient = api,
): Promise<{ ok: true; deletionIds: string[] } | { ok: false; message: string }> {
  const gone = new Set(ids);
  queryClient.setQueryData(cardsQueryOptions(deckId).queryKey, (cards) =>
    cards?.filter((card) => !gone.has(card.id)),
  );
  let res: Response | undefined;
  try {
    res = await client.api.cards.delete.$post({ json: { cardIds: [...ids] } });
  } catch {
    res = undefined;
  }
  if (res === undefined || !res.ok) {
    await refreshDeck(queryClient, deckId);
    return {
      ok: false,
      message:
        res === undefined
          ? CANT_REACH
          : res.status === 404
            ? "Some of these cards are gone already, so nothing was deleted."
            : "Banki couldn't delete the cards. Try again.",
    };
  }
  const { deletions } = DeleteCardsResponse.parse(await res.json());
  await Promise.all([
    refreshDeck(queryClient, deckId),
    queryClient.invalidateQueries({ queryKey: deletionsQueryOptions().queryKey }),
  ]);
  return { ok: true, deletionIds: deletions.map((d) => d.deletionId) };
}

/** Drops a deleted Card's own cache entry. */
export function forgetCard(queryClient: QueryClient, id: string) {
  queryClient.removeQueries({ queryKey: cardQueryOptions(id).queryKey, exact: true });
}

/** "12 cards", "1 card", "No cards". */
export function cardCountLabel(count: number): string {
  if (count === 0) return "No cards";
  return count === 1 ? "1 card" : `${count} cards`;
}
