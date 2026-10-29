import { randomUUID } from "node:crypto";
import {
  type CreateDeckRequest,
  type DeckResponse,
  type UpdateDeckRequest,
  deckNameKey,
  nextFreeName,
} from "@banki/shared";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Queryable } from "../db/database";
import { card, deck } from "../db/schema";
import { stampCards } from "./cards";
import { type Clash, type Place, type Refusal, isLivePlace, placeIs } from "./places";
import { deckRetentionOf, rescheduleCards } from "./reviews";

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
  folderId: deck.folderId,
  createdAt: deck.createdAt,
  desiredRetention: deck.desiredRetention,
  /** Its live Cards. Spelt out: Drizzle leaves a column's table off inside `sql`. */
  cardCount:
    sql<number>`(SELECT count(*) FROM "card" WHERE "card"."deck_id" = "deck"."id" AND "card"."user_id" = "deck"."user_id" AND "card"."deleted_at" IS NULL)`.mapWith(
      Number,
    ),
} as const;

type Row = {
  id: string;
  name: string;
  description: string | null;
  folderId: string | null;
  createdAt: Date;
  desiredRetention: number | null;
  cardCount: number;
};

const toDeck = (row: Row): Deck => ({ ...row, createdAt: row.createdAt.toISOString() });

/** The User's Deck `id`, unless it is deleted. */
const live = (userId: string, id: string) =>
  and(eq(deck.userId, userId), eq(deck.id, id), isNull(deck.deletedAt));

const findIn = (db: Queryable, userId: string, id: string): Deck | undefined => {
  const row = db.select(COLUMNS).from(deck).where(live(userId, id)).get();
  return row === undefined ? undefined : toDeck(row);
};

/** The live Deck in `place` named `name`, ignoring case, other than `except`. */
export const deckNamed = (
  db: Queryable,
  userId: string,
  place: Place,
  name: string,
  except?: string,
) =>
  db
    .select({ id: deck.id, name: deck.name })
    .from(deck)
    .where(
      and(
        eq(deck.userId, userId),
        placeIs(deck.folderId, place),
        eq(deck.nameKey, deckNameKey(name)),
        isNull(deck.deletedAt),
        except === undefined ? undefined : ne(deck.id, except),
      ),
    )
    .get();

/**
 * Deletes the Deck `id` softly with its live Cards, as a Deletion of its own
 * (ADR-0016). Expects to run inside a transaction. Answers the deletion ID,
 * or undefined when there is no such Deck.
 */
const deleteDeck = (
  db: Queryable,
  userId: string,
  id: string,
  now: Date,
  deletionId: string = randomUUID(),
): string | undefined => {
  const stamp = { deletedAt: now, deletionId, updatedAt: now };
  const deleted =
    db.update(deck).set(stamp).where(live(userId, id)).returning({ id: deck.id }).all().length > 0;
  if (!deleted) return undefined;
  stampCards(db, userId, [id], stamp);
  return deletionId;
};

/**
 * The User's Decks. Every query is scoped by the User (ADR-0001), so another
 * User's Deck is as unknown as one that never existed, and a deleted Deck is
 * too; so is a Folder that is deleted or another User's, as a place to put a
 * Deck in. Names are expected already parsed (trimmed, 1 to 100 characters).
 */
export function createDeckRepository(db: Queryable) {
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
    find: (userId: string, id: string) => findIn(db, userId, id),

    /**
     * Creates a Deck in `folderId` (null for the Root), unless that isn't a
     * live Folder of the User's, or another live Deck there has its name.
     * `id` and `now` are for the Seed data and tests.
     */
    create(
      userId: string,
      { name, description, folderId }: NewDeck,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): Deck | "not_found" | "taken" {
      return db.transaction(
        (tx) => {
          if (!isLivePlace(tx, userId, folderId)) return "not_found";
          if (deckNamed(tx, userId, folderId, name) !== undefined) return "taken";
          tx.insert(deck)
            .values({
              id,
              userId,
              folderId,
              name,
              nameKey: deckNameKey(name),
              description,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          return toDeck({
            id,
            name,
            description,
            folderId,
            createdAt: now,
            desiredRetention: null,
            cardCount: 0,
          });
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Changes a Deck's name, description or both, and moves it to `folderId`.
     * A new name another Deck beside it has is refused ("taken"). A move
     * refuses a destination that isn't a live Folder ("not_found"), and a move
     * into a place where a Deck has its name answers the clash, unless
     * `onClash` says what to do: `replace` deletes that Deck first, as a
     * Deletion of its own; `keepBoth` takes the next free "Name (n)". Its
     * creation time stays, so the Newest sort keeps it in place.
     */
    update(
      userId: string,
      id: string,
      { name: newName, description, folderId, onClash, desiredRetention }: DeckChanges,
      now = new Date(),
    ): Deck | Refusal | { clash: Clash } {
      return db.transaction(
        (tx) => {
          const current = findIn(tx, userId, id);
          if (current === undefined) return "not_found";
          let name = newName ?? current.name;
          const moving = folderId !== undefined && folderId !== current.folderId;
          const place = moving ? folderId : current.folderId;
          if (moving) {
            if (!isLivePlace(tx, userId, place)) return "not_found";
            const existing = deckNamed(tx, userId, place, name);
            if (existing !== undefined) {
              if (onClash === undefined) return { clash: { ...existing, replaceAllowed: true } };
              if (onClash === "replace") deleteDeck(tx, userId, existing.id, now);
              else name = nextFreeName(name, (n) => deckNamed(tx, userId, place, n) !== undefined);
            }
          } else if (
            newName !== undefined &&
            deckNamed(tx, userId, place, name, id) !== undefined
          ) {
            return "taken";
          }
          const retentionBefore = deckRetentionOf(tx, userId, id);
          tx.update(deck)
            .set({
              name,
              nameKey: deckNameKey(name),
              folderId: place,
              ...(description === undefined ? {} : { description }),
              ...(desiredRetention === undefined ? {} : { desiredRetention }),
              updatedAt: now,
            })
            .where(live(userId, id))
            .run();
          const retention = deckRetentionOf(tx, userId, id);
          if (retention !== retentionBefore) {
            const cards = tx
              .select({ id: card.id })
              .from(card)
              .where(and(eq(card.userId, userId), eq(card.deckId, id)));
            rescheduleCards(tx, userId, cards, retention, now);
          }
          return findIn(tx, userId, id) ?? "not_found";
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Deletes a Deck softly with its live Cards, setting `deletedAt` and a
     * deletion ID of its own on all of them (ADR-0016), and answers it;
     * undefined when there is no such Deck. `deletionId` is for the Seed data
     * and tests.
     */
    softDelete(
      userId: string,
      id: string,
      now = new Date(),
      deletionId: string = randomUUID(),
    ): string | undefined {
      return db.transaction((tx) => deleteDeck(tx, userId, id, now, deletionId), {
        behavior: "immediate",
      });
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
