import { randomUUID } from "node:crypto";
import {
  type CardResponse,
  type CardState,
  type CreateCardRequest,
  type UpdateCardRequest,
  deckRoom,
  sortTags,
} from "@banki/shared";
import { type SQLWrapper, and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { z } from "zod";
import type { Queryable } from "../db/database";
import { card, card_tag, deck, review } from "../db/schema";
import { resetProgress } from "./progress-resets";
import { replayCards, sameParameters } from "./replay";
import { deckSchedulingOf, rescheduleCards } from "./reviews";

export type Card = CardResponse;

export type CardRepository = ReturnType<typeof createCardRepository>;

/** A new Card, as `CreateCardRequest` parses it; no Tags or Grading notes unless given. */
export type NewCard = Omit<z.output<typeof CreateCardRequest>, "tags" | "gradingNotes"> & {
  tags?: readonly string[];
  gradingNotes?: string | null;
};

/** Changes to a Card, as `UpdateCardRequest` parses them. */
export type CardChanges = z.output<typeof UpdateCardRequest>;

/** A deleted thing's stamp: when, and the Deletion it went with (ADR-0016). */
export type DeletionStamp = { deletedAt: Date; deletionId: string; updatedAt: Date };

const COLUMNS = {
  id: card.id,
  deckId: card.deckId,
  front: card.front,
  back: card.back,
  gradingNotes: card.gradingNotes,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
  state: card.state,
} as const;

type Row = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  gradingNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  state: CardState;
};

const NO_TAGS: readonly string[] = [];

const toCard = ({ state, ...row }: Row, tags: readonly string[]): Card => ({
  ...row,
  tags: [...tags],
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  studied: state !== "new",
});

/** The User's Deck `id`, unless it is deleted. */
const liveDeck = (userId: string, id: string) =>
  and(eq(deck.userId, userId), eq(deck.id, id), isNull(deck.deletedAt));

export const isLiveDeck = (db: Queryable, userId: string, id: string) =>
  db.select({ id: deck.id }).from(deck).where(liveDeck(userId, id)).get() !== undefined;

/** A write refused because it would take a Deck past `DECK_CARDS_MAX` (ADR-0032): the Deck and its room. */
export type DeckFull = { deckFull: { id: string; name: string; room: number } };

/** How many live Cards the User's Deck `deckId` holds: its Cards in Recently deleted don't count. */
export const liveCardCount = (db: Queryable, userId: string, deckId: string) =>
  db
    .select({ count: count() })
    .from(card)
    .where(and(eq(card.userId, userId), eq(card.deckId, deckId), isNull(card.deletedAt)))
    .get()?.count ?? 0;

/**
 * The refusal for `adding` more Cards into the User's Deck `deckId` when that
 * would take it past `DECK_CARDS_MAX` live Cards, or undefined when it has
 * room for them. Expects to run in the write's own immediate transaction
 * (ADR-0032), so no other write can take the room in between.
 */
export function deckFullFor(
  db: Queryable,
  userId: string,
  deckId: string,
  adding: number,
): DeckFull | undefined {
  if (adding <= 0) return undefined;
  const room = deckRoom(liveCardCount(db, userId, deckId));
  if (adding <= room) return undefined;
  const name =
    db
      .select({ name: deck.name })
      .from(deck)
      .where(and(eq(deck.userId, userId), eq(deck.id, deckId)))
      .get()?.name ?? "";
  return { deckFull: { id: deckId, name, room } };
}

/** The Tags of the User's Cards `cardIds` picks, each Card's A–Z. */
function tagsOf(db: Queryable, userId: string, cardIds: SQLWrapper | string[]) {
  const rows = db
    .select({ cardId: card_tag.cardId, name: card_tag.name })
    .from(card_tag)
    .where(and(eq(card_tag.userId, userId), inArray(card_tag.cardId, cardIds)))
    .all();
  const byCard = new Map<string, string[]>();
  for (const { cardId, name } of rows) {
    const tags = byCard.get(cardId);
    if (tags === undefined) byCard.set(cardId, [name]);
    else tags.push(name);
  }
  for (const [cardId, tags] of byCard) byCard.set(cardId, sortTags(tags));
  return byCard;
}

/** Gives the User's Card `cardId` exactly these Tags, already parsed (`CardTags`). */
export function writeTags(db: Queryable, userId: string, cardId: string, tags: readonly string[]) {
  db.delete(card_tag)
    .where(and(eq(card_tag.userId, userId), eq(card_tag.cardId, cardId)))
    .run();
  if (tags.length > 0) {
    db.insert(card_tag)
      .values(tags.map((name) => ({ cardId, userId, name })))
      .run();
  }
}

/** The User's live Card `id` in a live Deck. */
export const findIn = (db: Queryable, userId: string, id: string): Card | undefined => {
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
  return row === undefined ? undefined : toCard(row, tagsOf(db, userId, [id]).get(id) ?? NO_TAGS);
};

/** How many of the Cards `ids` (no repeats) are the User's, live and in a live Deck. */
const liveCount = (db: Queryable, userId: string, ids: readonly string[]) =>
  db
    .select({ count: count() })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(
      and(
        eq(card.userId, userId),
        inArray(card.id, [...ids]),
        isNull(card.deletedAt),
        eq(deck.userId, userId),
        isNull(deck.deletedAt),
      ),
    )
    .get()?.count ?? 0;

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
 * The User's Cards, each with its Tags. Every query is scoped by the User
 * (ADR-0001), so another User's Card is as unknown as one that never existed,
 * and so is a deleted Card, or one whose Deck is deleted; so is a Deck that is
 * deleted or another User's, as a Deck to list or to create a Card in. Fronts
 * and Backs are expected already parsed (`CardSide`), and so are Grading notes
 * (`GradingNotes`), all stored exactly as given; Tags too (`CardTags`: lowercase, without duplicates). A soft delete
 * leaves a Card's Tags alone, so they come back with it on Restore.
 */
export function createCardRepository(db: Queryable) {
  return {
    /** The live Cards of the User's Deck `deckId`, newest first; "not_found" for no such Deck. */
    list(userId: string, deckId: string): Card[] | "not_found" {
      return db.transaction((tx) => {
        if (!isLiveDeck(tx, userId, deckId)) return "not_found";
        const live = and(eq(card.userId, userId), eq(card.deckId, deckId), isNull(card.deletedAt));
        const rows = tx
          .select(COLUMNS)
          .from(card)
          .where(live)
          .orderBy(desc(card.createdAt), desc(card.id))
          .all();
        const tags = tagsOf(tx, userId, tx.select({ id: card.id }).from(card).where(live));
        return rows.map((row) => toCard(row, tags.get(row.id) ?? NO_TAGS));
      });
    },

    /** The User's Card `id`, unless it, or its Deck, is deleted. */
    find: (userId: string, id: string) => findIn(db, userId, id),

    /**
     * Creates a Card in the User's Deck `deckId`, with its Tags, unless that
     * isn't a live Deck of the User's, or it has no room (`deckFull`). `id`
     * and `now` are for the Seed data and tests.
     */
    create(
      userId: string,
      deckId: string,
      { front, back, tags = NO_TAGS, gradingNotes = null }: NewCard,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): Card | DeckFull | "not_found" {
      return db.transaction(
        (tx) => {
          if (!isLiveDeck(tx, userId, deckId)) return "not_found";
          const full = deckFullFor(tx, userId, deckId, 1);
          if (full !== undefined) return full;
          const row = { id, deckId, front, back, gradingNotes, createdAt: now, updatedAt: now };
          tx.insert(card)
            .values({ ...row, userId })
            .run();
          writeTags(tx, userId, id, tags);
          return toCard({ ...row, state: "new" }, sortTags(tags));
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Changes a Card's Front, Back, Tags, Grading notes or any of them, Tags
     * given replacing all of its own; "not_found" for no such Card. With
     * `resetProgress`, in the same transaction, a studied Card goes back to New
     * and the Progress reset is logged (`resetProgress`); its Reviews stay. On
     * a New Card it does nothing: asked alone, the Card stays as it was, its
     * `updatedAt` too.
     */
    update(userId: string, id: string, changes: CardChanges, now = new Date()): Card | "not_found" {
      return db.transaction(
        (tx) => {
          const found = findIn(tx, userId, id);
          if (found === undefined) return "not_found";
          const edited =
            changes.front !== undefined ||
            changes.back !== undefined ||
            changes.gradingNotes !== undefined ||
            changes.tags !== undefined;
          const reset = changes.resetProgress === true && resetProgress(tx, userId, id, now);
          if (!edited && !reset) return found;
          tx.update(card)
            .set({
              ...(changes.front === undefined ? {} : { front: changes.front }),
              ...(changes.back === undefined ? {} : { back: changes.back }),
              ...(changes.gradingNotes === undefined ? {} : { gradingNotes: changes.gradingNotes }),
              updatedAt: now,
            })
            .where(and(eq(card.userId, userId), eq(card.id, id)))
            .run();
          if (changes.tags !== undefined) writeTags(tx, userId, id, changes.tags);
          return findIn(tx, userId, id) ?? "not_found";
        },
        { behavior: "immediate" },
      );
    },

    /**
     * The User's Tags that some live Card in a live Deck carries, A–Z: what
     * `GET /api/tags` answers. A deleted Card's Tags aren't among them until
     * it is restored.
     */
    tags(userId: string): string[] {
      const rows = db
        .selectDistinct({ name: card_tag.name })
        .from(card_tag)
        .innerJoin(card, eq(card.id, card_tag.cardId))
        .innerJoin(deck, eq(deck.id, card.deckId))
        .where(
          and(
            eq(card_tag.userId, userId),
            eq(card.userId, userId),
            isNull(card.deletedAt),
            eq(deck.userId, userId),
            isNull(deck.deletedAt),
          ),
        )
        .all();
      return sortTags(rows.map(({ name }) => name));
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

    /**
     * Moves the User's Cards `ids` into their Deck `deckId`, all of them or
     * none: "not_found" when one isn't a live Card in a live Deck of the
     * User's, or `deckId` isn't a live Deck of theirs. A moved Card is the same
     * Card: it keeps its ID, Front, Back, Tags, Grading notes and `createdAt`, and takes its
     * Reviews along (ADR-0021). One whose old Deck had other Parameters is
     * replayed under the new one's, keeping its due date (ADR-0033); then
     * one whose old Deck had another Desired retention is rescheduled for the
     * new one's. A Move may make a Duplicate.
     * One that would take the Deck past `DECK_CARDS_MAX` live Cards is refused
     * whole (`deckFull`); its Cards already in the Deck don't count.
     * Answers the moved Cards, newest first.
     */
    move(
      userId: string,
      ids: readonly string[],
      deckId: string,
      now = new Date(),
    ): Card[] | DeckFull | "not_found" {
      const unique = [...new Set(ids)];
      return db.transaction(
        (tx) => {
          if (!isLiveDeck(tx, userId, deckId)) return "not_found";
          if (liveCount(tx, userId, unique) !== unique.length) return "not_found";
          const entering =
            tx
              .select({ count: count() })
              .from(card)
              .where(
                and(eq(card.userId, userId), inArray(card.id, unique), ne(card.deckId, deckId)),
              )
              .get()?.count ?? 0;
          const full = deckFullFor(tx, userId, deckId, entering);
          if (full !== undefined) return full;
          const { desiredRetention: retention, parameters } = deckSchedulingOf(tx, userId, deckId);
          // Each Deck the Cards leave, with the Cards that leave it.
          const from = tx
            .selectDistinct({ deckId: card.deckId })
            .from(card)
            .where(and(eq(card.userId, userId), inArray(card.id, unique)))
            .all()
            .map(({ deckId: source }) => ({
              ...deckSchedulingOf(tx, userId, source),
              cardIds: tx
                .select({ id: card.id })
                .from(card)
                .where(
                  and(eq(card.userId, userId), eq(card.deckId, source), inArray(card.id, unique)),
                )
                .all()
                .map((row) => row.id),
            }));
          // The Cards whose Deck scheduled them under other Parameters.
          const replayed = from.flatMap((source) =>
            sameParameters(source.parameters, parameters) ? [] : source.cardIds,
          );
          // The Cards whose Deck scheduled them at another Desired retention.
          const rescheduled = from.flatMap((source) =>
            source.desiredRetention === retention ? [] : source.cardIds,
          );
          tx.update(card)
            .set({ deckId, updatedAt: now })
            .where(and(eq(card.userId, userId), inArray(card.id, unique)))
            .run();
          // Their history goes with them (ADR-0021).
          tx.update(review)
            .set({ deckId })
            .where(and(eq(review.userId, userId), inArray(review.cardId, unique)))
            .run();
          if (replayed.length > 0) replayCards(tx, userId, { cardIds: replayed });
          if (rescheduled.length > 0) rescheduleCards(tx, userId, rescheduled, retention, now);
          const rows = tx
            .select(COLUMNS)
            .from(card)
            .where(and(eq(card.userId, userId), inArray(card.id, unique)))
            .orderBy(desc(card.createdAt), desc(card.id))
            .all();
          const tags = tagsOf(tx, userId, unique);
          return rows.map((row) => toCard(row, tags.get(row.id) ?? NO_TAGS));
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Deletes the User's Cards `ids` softly at once, all of them or none, each
     * as a Deletion of its own (ADR-0016): "not_found" when one isn't a live
     * Card in a live Deck of the User's. Answers each Card's deletion ID.
     * `deletionIdFor` is for tests.
     */
    softDeleteAll(
      userId: string,
      ids: readonly string[],
      now = new Date(),
      deletionIdFor: (cardId: string) => string = () => randomUUID(),
    ): { cardId: string; deletionId: string }[] | "not_found" {
      const unique = [...new Set(ids)];
      return db.transaction(
        (tx) => {
          if (liveCount(tx, userId, unique) !== unique.length) return "not_found";
          return unique.map((cardId) => {
            const deletionId = deletionIdFor(cardId);
            tx.update(card)
              .set({ deletedAt: now, deletionId, updatedAt: now })
              .where(and(eq(card.userId, userId), eq(card.id, cardId)))
              .run();
            return { cardId, deletionId };
          });
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
