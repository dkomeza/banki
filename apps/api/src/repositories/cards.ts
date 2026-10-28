import { randomUUID } from "node:crypto";
import type { CardResponse, CreateCardRequest, UpdateCardRequest } from "@banki/shared";
import { type SQLWrapper, and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { Queryable } from "../db/database";
import { card, deck } from "../db/schema";

export type Card = CardResponse;

export type CardRepository = ReturnType<typeof createCardRepository>;

/** A new Card, as `CreateCardRequest` parses it. */
export type NewCard = z.output<typeof CreateCardRequest>;

/** Changes to a Card, as `UpdateCardRequest` parses them. */
export type CardChanges = z.output<typeof UpdateCardRequest>;

/** A deleted thing's stamp: when, and the Deletion it went with (ADR-0016). */
export type DeletionStamp = { deletedAt: Date; deletionId: string; updatedAt: Date };

const COLUMNS = {
  id: card.id,
  deckId: card.deckId,
  front: card.front,
  back: card.back,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
} as const;

type Row = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  createdAt: Date;
  updatedAt: Date;
};

const toCard = (row: Row): Card => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** The User's Deck `id`, unless it is deleted. */
const liveDeck = (userId: string, id: string) =>
  and(eq(deck.userId, userId), eq(deck.id, id), isNull(deck.deletedAt));

const isLiveDeck = (db: Queryable, userId: string, id: string) =>
  db.select({ id: deck.id }).from(deck).where(liveDeck(userId, id)).get() !== undefined;

/** The User's live Card `id` in a live Deck. */
const findIn = (db: Queryable, userId: string, id: string): Card | undefined => {
  const row = db
    .select(COLUMNS)
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(
      and(
        eq(card.userId, userId),
        eq(card.id, id),
        isNull(card.deletedAt),
        eq(deck.userId, userId),
        isNull(deck.deletedAt),
      ),
    )
    .get();
  return row === undefined ? undefined : toCard(row);
};

/**
 * Stamps every live Card of the User's in the Decks `deckIds` picks with a
 * Deletion's stamp, so they go with their Deck or Folder (ADR-0016). A Card
 * deleted before keeps its own Deletion.
 */
export function stampCards(
  db: Queryable,
  userId: string,
  deckIds: SQLWrapper | string[],
  stamp: DeletionStamp,
) {
  db.update(card)
    .set(stamp)
    .where(and(eq(card.userId, userId), inArray(card.deckId, deckIds), isNull(card.deletedAt)))
    .run();
}

/**
 * The User's Cards. Every query is scoped by the User (ADR-0001), so another
 * User's Card is as unknown as one that never existed, and so is a deleted
 * Card, or one whose Deck is deleted; so is a Deck that is deleted or another
 * User's, as a Deck to list or to create a Card in. Fronts and Backs are
 * expected already parsed (`CardSide`), and are stored exactly as given.
 */
export function createCardRepository(db: Queryable) {
  return {
    /** The live Cards of the User's Deck `deckId`, newest first; "not_found" for no such Deck. */
    list(userId: string, deckId: string): Card[] | "not_found" {
      return db.transaction((tx) => {
        if (!isLiveDeck(tx, userId, deckId)) return "not_found";
        return tx
          .select(COLUMNS)
          .from(card)
          .where(and(eq(card.userId, userId), eq(card.deckId, deckId), isNull(card.deletedAt)))
          .orderBy(desc(card.createdAt), desc(card.id))
          .all()
          .map(toCard);
      });
    },

    /** The User's Card `id`, unless it, or its Deck, is deleted. */
    find: (userId: string, id: string) => findIn(db, userId, id),

    /**
     * Creates a Card in the User's Deck `deckId`, unless that isn't a live
     * Deck of the User's. `id` and `now` are for the Seed data and tests.
     */
    create(
      userId: string,
      deckId: string,
      { front, back }: NewCard,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): Card | "not_found" {
      return db.transaction(
        (tx) => {
          if (!isLiveDeck(tx, userId, deckId)) return "not_found";
          const row = { id, deckId, front, back, createdAt: now, updatedAt: now };
          tx.insert(card)
            .values({ ...row, userId })
            .run();
          return toCard(row);
        },
        { behavior: "immediate" },
      );
    },

    /** Changes a Card's Front, Back or both; "not_found" for no such Card. */
    update(userId: string, id: string, changes: CardChanges, now = new Date()): Card | "not_found" {
      return db.transaction(
        (tx) => {
          if (findIn(tx, userId, id) === undefined) return "not_found";
          tx.update(card)
            .set({
              ...(changes.front === undefined ? {} : { front: changes.front }),
              ...(changes.back === undefined ? {} : { back: changes.back }),
              updatedAt: now,
            })
            .where(and(eq(card.userId, userId), eq(card.id, id)))
            .run();
          return findIn(tx, userId, id) ?? "not_found";
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Deletes a Card softly, as a Deletion of its own: `deletedAt` and a
     * deletion ID of its own (ADR-0016), answered. Undefined when there is no
     * such Card. `deletionId` is for the Seed data and tests.
     */
    softDelete(
      userId: string,
      id: string,
      now = new Date(),
      deletionId: string = randomUUID(),
    ): string | undefined {
      return db.transaction(
        (tx) => {
          if (findIn(tx, userId, id) === undefined) return undefined;
          tx.update(card)
            .set({ deletedAt: now, deletionId, updatedAt: now })
            .where(and(eq(card.userId, userId), eq(card.id, id)))
            .run();
          return deletionId;
        },
        { behavior: "immediate" },
      );
    },

    /** Whether the User has any Card at all, deleted ones too. */
    any(userId: string): boolean {
      return (
        db.select({ id: card.id }).from(card).where(eq(card.userId, userId)).limit(1).get() !==
        undefined
      );
    },
  };
}
