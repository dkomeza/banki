import { randomUUID } from "node:crypto";
import {
  type CreateDeckRequest,
  type DeckResponse,
  type UpdateDeckRequest,
  deckNameKey,
} from "@banki/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { z } from "zod";
import type { Queryable } from "../db/database";
import { deck } from "../db/schema";

export type Deck = DeckResponse;

export type DeckRepository = ReturnType<typeof createDeckRepository>;

/** A new Deck, as `CreateDeckRequest` parses it. */
export type NewDeck = z.output<typeof CreateDeckRequest>;

/** Changes to a Deck, as `UpdateDeckRequest` parses them. */
export type DeckChanges = z.output<typeof UpdateDeckRequest>;

const COLUMNS = {
  id: deck.id,
  name: deck.name,
  description: deck.description,
  createdAt: deck.createdAt,
} as const;

type Row = { id: string; name: string; description: string | null; createdAt: Date };

const toDeck = (row: Row): Deck => ({ ...row, createdAt: row.createdAt.toISOString() });

/** The User's Deck `id`, unless it is deleted. */
const live = (userId: string, id: string) =>
  and(eq(deck.userId, userId), eq(deck.id, id), isNull(deck.deletedAt));

/** Whether another of the User's Decks that isn't deleted has `name`, ignoring case. */
const nameTaken = (db: Queryable, userId: string, name: string, except?: string) =>
  db
    .select({ id: deck.id })
    .from(deck)
    .where(
      and(
        eq(deck.userId, userId),
        eq(deck.nameKey, deckNameKey(name)),
        isNull(deck.deletedAt),
        except === undefined ? undefined : ne(deck.id, except),
      ),
    )
    .get() !== undefined;

/**
 * The User's Decks. Every query is scoped by the User (ADR-0001), so another
 * User's Deck is as unknown as one that never existed, and a deleted Deck is
 * too. Names are expected already parsed (trimmed, 1 to 100 characters).
 */
export function createDeckRepository(db: Queryable) {
  const find = (userId: string, id: string): Deck | undefined => {
    const row = db.select(COLUMNS).from(deck).where(live(userId, id)).get();
    return row === undefined ? undefined : toDeck(row);
  };

  return {
    /** The User's Decks that aren't deleted, oldest first. */
    list(userId: string): Deck[] {
      return db
        .select(COLUMNS)
        .from(deck)
        .where(and(eq(deck.userId, userId), isNull(deck.deletedAt)))
        .orderBy(deck.createdAt, deck.id)
        .all()
        .map(toDeck);
    },

    /** The User's Deck `id`, unless it is deleted. */
    find,

    /**
     * Creates a Deck, unless another of the User's Decks that isn't deleted
     * has its name. `id` and `now` are for the Seed data and tests.
     */
    create(
      userId: string,
      { name, description }: NewDeck,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): Deck | "taken" {
      return db.transaction(
        (tx) => {
          if (nameTaken(tx, userId, name)) return "taken";
          tx.insert(deck)
            .values({
              id,
              userId,
              name,
              nameKey: deckNameKey(name),
              description,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          return toDeck({ id, name, description, createdAt: now });
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Changes a Deck's name, description or both, unless the new name is
     * another Deck's. Its creation time stays, so the Newest sort keeps it in
     * place.
     */
    update(
      userId: string,
      id: string,
      changes: DeckChanges,
      now = new Date(),
    ): Deck | "not_found" | "taken" {
      return db.transaction(
        (tx) => {
          if (tx.select({ id: deck.id }).from(deck).where(live(userId, id)).get() === undefined) {
            return "not_found";
          }
          if (changes.name !== undefined && nameTaken(tx, userId, changes.name, id)) {
            return "taken";
          }
          tx.update(deck)
            .set({
              ...(changes.name === undefined
                ? {}
                : { name: changes.name, nameKey: deckNameKey(changes.name) }),
              ...(changes.description === undefined ? {} : { description: changes.description }),
              updatedAt: now,
            })
            .where(live(userId, id))
            .run();
          return createDeckRepository(tx).find(userId, id) ?? "not_found";
        },
        { behavior: "immediate" },
      );
    },

    /** Deletes a Deck softly, setting `deletedAt`; false when there is no such Deck. */
    softDelete(userId: string, id: string, now = new Date()): boolean {
      const deleted = db
        .update(deck)
        .set({ deletedAt: now, updatedAt: now })
        .where(live(userId, id))
        .returning({ id: deck.id })
        .all();
      return deleted.length > 0;
    },

    /** Whether the User has any Deck at all, deleted ones too. */
    any(userId: string): boolean {
      return (
        db.select({ id: deck.id }).from(deck).where(eq(deck.userId, userId)).limit(1).get() !==
        undefined
      );
    },
  };
}
