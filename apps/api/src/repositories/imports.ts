import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGE_FORMATS,
  type ImageProblem,
  type ImportHistoryEntry,
  type ImportResponse,
  type Macro,
  type MacroPlanEntry,
  type NumberedCard,
  type SkippedDuplicate,
  type UndoImportResponse,
  deckRoom,
  frontKey,
  imageFormatOf,
  imageReferencesIn,
  sortTags,
} from "@banki/shared";
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, card_import, deck, review } from "../db/schema";
import type { ImportReport, StagedImport } from "../imports/stored";
import {
  type ImageStatus,
  type ReadFile,
  type Refused,
  duplicatesOf,
  imageProblems,
  planMacros,
  readUpload,
} from "../imports/read";
import { type DeckFull, deckFullFor, isLiveDeck, writeTags } from "./cards";
import { createImageRepository } from "./images";

export type ImportRepository = ReturnType<typeof createImportRepository>;

/** How long an unconfirmed Import is kept: 24 hours, as an Image no Card refers to. */
export const UNCONFIRMED_KEPT_MS = 24 * 60 * 60 * 1000;

/** A Card to confirm: one of the preview's, by its number, edited or not. */
export type ConfirmedCard = NumberedCard;

/** Why a confirm was refused: `deckFull` when the Cards it would add outnumber the Deck's room. */
export type ConfirmRefusal = "not_found" | "confirmed" | "deck_gone" | "unknown_card" | DeckFull;

/** Why an Undo was refused: no such confirmed Import, or no live Card stamped with it. */
export type UndoRefusal = "not_found" | "nothing_to_undo";

/** A count of the Cards a `where` picks that `condition` holds for. */
const countWhere = (condition: ReturnType<typeof sql>) =>
  sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`.mapWith(Number);

/**
 * How many of the User's live Cards stamped with the Import `id` there are,
 * and of them how many were studied (a Review or reps, which a Progress reset
 * zeroes but whose Reviews stay), edited (changed since they were added) and
 * moved out of its Deck `deckId`.
 */
const liveCardsOf = (tx: Queryable, userId: string, id: string, deckId: string) =>
  tx
    .select({
      live: sql<number>`count(*)`.mapWith(Number),
      studied: countWhere(
        sql`${card.reps} > 0 or exists (select 1 from ${review} where ${review.userId} = ${card.userId} and ${review.cardId} = ${card.id})`,
      ),
      edited: countWhere(sql`${card.updatedAt} > ${card.createdAt}`),
      moved: countWhere(sql`${card.deckId} <> ${deckId}`),
    })
    .from(card)
    .where(and(eq(card.userId, userId), eq(card.importId, id), isNull(card.deletedAt)))
    .get() ?? { live: 0, studied: 0, edited: 0, moved: 0 };

/** The User's Deck `deckId`'s own Macros, deleted or not; undefined for no such Deck. */
const deckMacros = (db: Queryable, userId: string, deckId: string): Macro[] | undefined =>
  db
    .select({ macros: deck.macros })
    .from(deck)
    .where(and(eq(deck.userId, userId), eq(deck.id, deckId)))
    .get()?.macros;

/** The live Cards of the Deck `deckId`, their IDs and Fronts, oldest first. */
const liveFronts = (db: Queryable, userId: string, deckId: string) =>
  db
    .select({ id: card.id, front: card.front })
    .from(card)
    .where(and(eq(card.userId, userId), eq(card.deckId, deckId), isNull(card.deletedAt)))
    .orderBy(card.createdAt, card.id)
    .all();

/** The User's Import `id`, unconfirmed or not. */
const rowOf = (tx: Queryable, userId: string, id: string) =>
  tx
    .select()
    .from(card_import)
    .where(and(eq(card_import.userId, userId), eq(card_import.id, id)))
    .get();

/** `text` with each Image reference to a file `renamed` names pointing at its new name. */
function rewriteReferences(text: string, renamed: ReadonlyMap<string, string>): string {
  let out = "";
  let at = 0;
  for (const reference of imageReferencesIn(text)) {
    const to = renamed.get(reference.file);
    if (to === undefined) continue;
    const piece = text.slice(reference.start, reference.end);
    // The destination is the reference's end: alt text may hold the same words.
    const target = `images/${reference.file})`;
    out +=
      text.slice(at, reference.start) +
      piece.slice(0, piece.length - target.length) +
      `images/${to})`;
    at = reference.end;
  }
  return out + text.slice(at);
}

/** Whether `file` is safe as a name in a staging folder: one name, as references allow. */
const SAFE_FILE = /^[\w-]+\.[A-Za-z0-9]+$/;

/**
 * The User's Imports (CONTEXT.md, ADR-0026). `create` reads a file into an
 * unconfirmed Import, its images staged in `importsDir`; `find` answers its
 * preview, planned against the Deck as it is now, or its report; `confirm`
 * adds the ticked Cards in one transaction; `history` lists a Deck's confirmed
 * ones; `undo` takes a confirmed one's Cards back out (ADR-0030); `sweep`
 * removes Imports never confirmed. Every query but the sweep's is scoped by the User, so another
 * User's Import is as unknown as one that never existed.
 */
export function createImportRepository(db: Queryable, importsDir: string, uploadsDir: string) {
  mkdirSync(importsDir, { recursive: true });
  const stagedDir = (id: string) => join(importsDir, id);

  const hasImageOf = (tx: Queryable, userId: string) => {
    const images = createImageRepository(tx, uploadsDir);
    return (file: string) => images.find(userId, file) !== undefined;
  };

  /**
   * The User's Import `id`: its preview while unconfirmed, with each Card's
   * Duplicate, the Macro plan, the image problems and the room as they stand
   * against its Deck now, or its report once confirmed, with how many of its Cards
   * are live now and whether it is undone. Undefined for no such Import.
   */
  const find = (userId: string, id: string): ImportResponse | undefined =>
    db.transaction((tx) => {
      const row = rowOf(tx, userId, id);
      if (row === undefined) return undefined;
      const base = {
        id: row.id,
        deckId: row.deckId,
        fileName: row.fileName,
        source: row.source,
        createdAt: row.createdAt.toISOString(),
      };
      if (row.confirmedAt !== null) {
        const report = row.report;
        if (report === null) return undefined;
        return {
          ...base,
          ...report,
          status: "confirmed" as const,
          confirmedAt: row.confirmedAt.toISOString(),
          ...liveCardsOf(tx, userId, row.id, row.deckId),
          undoneAt: row.undoneAt?.toISOString() ?? null,
          undoDeletionId: row.undoDeletionId,
        };
      }
      const { preview } = row;
      if (preview === null) return undefined;
      const deckCards = liveFronts(tx, userId, row.deckId);
      const duplicates = duplicatesOf(preview.cards, deckCards);
      const images = new Map(Object.entries(preview.images));
      return {
        ...base,
        status: "unconfirmed" as const,
        total: preview.total,
        invalid: preview.invalid,
        cards: preview.cards.map((one, i) => ({ ...one, duplicateOf: duplicates[i] ?? null })),
        macros: planMacros(preview.macros, deckMacros(tx, userId, row.deckId) ?? []),
        images: imageProblems(preview.cards, images, preview.zipped, hasImageOf(tx, userId)),
        stagedImages: Object.keys(preview.images).filter(
          (file) => preview.images[file] === "staged",
        ),
        room: deckRoom(deckCards.length),
      };
    });

  return {
    find,

    /**
     * Reads an upload (`readUpload`) into a new unconfirmed Import into the
     * User's live Deck `deckId`: "not_found" for no such Deck, its problems
     * for a refused file, which creates nothing. `id` and `now` are for the
     * Seed data and tests.
     */
    create(
      userId: string,
      deckId: string,
      upload: { bytes: Uint8Array; kind: "paste" | "file"; fileName: string },
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): { id: string } | Refused | "not_found" {
      if (!isLiveDeck(db, userId, deckId)) return "not_found";
      const read: ReadFile | Refused = readUpload(upload.bytes, upload.kind);
      if ("problems" in read) return read;
      const images: Record<string, ImageStatus> = {};
      // Staged before the row, so a failure between leaves only a folder with no
      // row, which the sweep removes.
      for (const [file, image] of read.images) {
        if (image.status !== "ok") {
          images[file] = { problem: image.status, message: image.message };
          continue;
        }
        if (!SAFE_FILE.test(file)) continue;
        mkdirSync(stagedDir(id), { recursive: true, mode: 0o700 });
        writeFileSync(join(stagedDir(id), file), image.bytes, { mode: 0o600 });
        images[file] = "staged";
      }
      const preview: StagedImport = {
        total: read.total,
        cards: read.cards,
        invalid: read.invalid,
        macros: read.macros,
        zipped: read.source === "zip",
        images,
      };
      db.insert(card_import)
        .values({
          id,
          userId,
          deckId,
          fileName: upload.kind === "paste" ? "pasted JSON" : upload.fileName,
          source: read.source,
          createdAt: now,
          preview,
        })
        .run();
      return { id };
    },

    /**
     * A staged image of the User's unconfirmed Import `id`, by its file name
     * in the zip's `images/`, as its path and type; undefined for none.
     */
    stagedImage(userId: string, id: string, file: string) {
      const row = rowOf(db, userId, id);
      if (row === undefined || row.confirmedAt !== null || !SAFE_FILE.test(file)) return undefined;
      if (row.preview?.images[file] !== "staged") return undefined;
      const path = join(stagedDir(id), file);
      const head = (() => {
        try {
          return readFileSync(path).subarray(0, 12);
        } catch {
          return undefined;
        }
      })();
      const format = head === undefined ? undefined : imageFormatOf(head);
      if (format === undefined) return undefined;
      return { path, contentType: IMAGE_FORMATS[format].contentType };
    },

    /**
     * Confirms the User's Import `id` with the ticked Cards `ticked`, each one
     * of the preview's by its number (edited or not), in one transaction:
     * refused, adding nothing, for no such Import ("not_found"), one already
     * confirmed ("confirmed"), a Deck no longer live ("deck_gone"), a
     * number the preview has no Card for ("unknown_card"), or Cards to add,
     * Duplicates skipped, that outnumber the Deck's room now (`deckFull`,
     * ADR-0034). A Card that is a
     * Duplicate of the Deck's live Cards now, or of an earlier ticked Card, is
     * skipped and reported. The rest are added in file order, the first the
     * oldest, each stamped with the Import; each zip image they refer to
     * becomes a new Image, their references rewritten to it; and the Macro
     * plan, made against the Deck now, is applied to its own Macros. The
     * report is stored, and the staged files deleted. `now` and `cardIdFor`
     * (each added Card's ID, by its number) are for the Seed data and tests.
     */
    confirm(
      userId: string,
      id: string,
      ticked: readonly ConfirmedCard[],
      {
        now = new Date(),
        cardIdFor = () => randomUUID(),
      }: { now?: Date; cardIdFor?: (number: number) => string } = {},
    ): ImportResponse | ConfirmRefusal {
      const refusal = db.transaction(
        (tx): ConfirmRefusal | undefined => {
          const row = rowOf(tx, userId, id);
          if (row === undefined) return "not_found";
          if (row.confirmedAt !== null) return "confirmed";
          if (!isLiveDeck(tx, userId, row.deckId)) return "deck_gone";
          const { preview } = row;
          if (preview === null) return "not_found";
          const byNumber = new Map(preview.cards.map((one) => [one.number, one]));
          if (ticked.some((one) => !byNumber.has(one.number))) return "unknown_card";

          const deckCards = liveFronts(tx, userId, row.deckId);
          const deckKeys = new Set(deckCards.map((one) => frontKey(one.front)));
          deckKeys.delete("");
          const sent = new Map(ticked.map((one) => [one.number, one]));
          // The Cards to add: each ticked one but a Duplicate of the Deck or of
          // one added before it. One not ticked is reported as a Duplicate when
          // its Front, as read, repeats the Deck or a Card added before it, as
          // the preview locked it (by the Deck and the earlier ticked Cards),
          // and as left out otherwise.
          const added: NumberedCard[] = [];
          const duplicates: SkippedDuplicate[] = [];
          const taken = new Set(deckKeys);
          let leftOut = 0;
          for (const original of preview.cards) {
            const chosen = sent.get(original.number);
            const key = frontKey((chosen ?? original).front);
            const duplicate = key !== "" && taken.has(key);
            if (duplicate) {
              duplicates.push({ number: original.number, front: (chosen ?? original).front });
            } else if (chosen === undefined) {
              leftOut += 1;
            } else {
              added.push(chosen);
              if (key !== "") taken.add(key);
            }
          }

          const full = deckFullFor(tx, userId, row.deckId, added.length);
          if (full !== undefined) return full;

          // The zip's images the added Cards refer to, each a new Image.
          const images = createImageRepository(tx, uploadsDir);
          const renamed = new Map<string, string>();
          for (const one of added) {
            for (const reference of [one.front, one.back, one.gradingNotes ?? ""].flatMap(
              imageReferencesIn,
            )) {
              const { file } = reference;
              if (renamed.has(file) || preview.images[file] !== "staged") continue;
              const stored = images.store(userId, readFileSync(join(stagedDir(id), file)), { now });
              if ("reference" in stored)
                renamed.set(file, stored.reference.slice("images/".length));
            }
          }
          const problems: ImageProblem[] = imageProblems(
            added,
            new Map(Object.entries(preview.images)),
            preview.zipped,
            (file) => images.find(userId, file) !== undefined,
          );

          // In file order, the first the oldest, a millisecond apart.
          for (const [i, one] of added.entries()) {
            const cardId = cardIdFor(one.number);
            const at = new Date(now.getTime() - (added.length - 1 - i));
            tx.insert(card)
              .values({
                id: cardId,
                userId,
                deckId: row.deckId,
                front: rewriteReferences(one.front, renamed),
                back: rewriteReferences(one.back, renamed),
                gradingNotes:
                  one.gradingNotes === null ? null : rewriteReferences(one.gradingNotes, renamed),
                createdAt: at,
                updatedAt: at,
                importId: id,
              })
              .run();
            writeTags(tx, userId, cardId, sortTags(one.tags));
          }

          const own = deckMacros(tx, userId, row.deckId) ?? [];
          const plan: MacroPlanEntry[] = planMacros(preview.macros, own);
          const gained = plan.flatMap((entry) =>
            entry.outcome === "added" ? [{ name: entry.name, definition: entry.definition }] : [],
          );
          if (gained.length > 0) {
            tx.update(deck)
              .set({ macros: [...own, ...gained], updatedAt: now })
              .where(and(eq(deck.userId, userId), eq(deck.id, row.deckId)))
              .run();
          }

          const report: ImportReport = {
            total: preview.total,
            invalid: preview.invalid,
            imported: added.length,
            leftOut,
            duplicates,
            macros: plan,
            images: problems,
            imageCount: renamed.size,
          };
          tx.update(card_import)
            .set({ confirmedAt: now, preview: null, report })
            .where(eq(card_import.id, id))
            .run();
          return undefined;
        },
        { behavior: "immediate" },
      );
      if (refusal !== undefined) return refusal;
      try {
        rmSync(stagedDir(id), { recursive: true, force: true });
      } catch {
        // Committed already: a folder left behind goes with the sweep.
      }
      return find(userId, id) ?? "not_found";
    },

    /**
     * The confirmed Imports into the User's live Deck `deckId`, newest first,
     * each with how many Cards it added and how many of those are live now,
     * wherever they are; "not_found" for no such Deck. An unconfirmed Import
     * is never listed (ADR-0026).
     */
    history(userId: string, deckId: string): ImportHistoryEntry[] | "not_found" {
      return db.transaction((tx) => {
        if (!isLiveDeck(tx, userId, deckId)) return "not_found";
        const rows = tx
          .select({
            id: card_import.id,
            fileName: card_import.fileName,
            source: card_import.source,
            confirmedAt: card_import.confirmedAt,
            report: card_import.report,
            undoneAt: card_import.undoneAt,
          })
          .from(card_import)
          .where(
            and(
              eq(card_import.userId, userId),
              eq(card_import.deckId, deckId),
              isNotNull(card_import.confirmedAt),
            ),
          )
          .orderBy(desc(card_import.confirmedAt), desc(card_import.id))
          .all();
        const live = new Map(
          (rows.length === 0
            ? []
            : tx
                .select({ id: card.importId, count: sql<number>`count(*)`.mapWith(Number) })
                .from(card)
                .where(
                  and(
                    eq(card.userId, userId),
                    inArray(
                      card.importId,
                      rows.map((row) => row.id),
                    ),
                    isNull(card.deletedAt),
                  ),
                )
                .groupBy(card.importId)
                .all()
          ).map((row) => [row.id, row.count]),
        );
        return rows.map((row) => ({
          id: row.id,
          fileName: row.fileName,
          source: row.source,
          confirmedAt: (row.confirmedAt ?? new Date(0)).toISOString(),
          imported: row.report?.imported ?? 0,
          live: live.get(row.id) ?? 0,
          undoneAt: row.undoneAt?.toISOString() ?? null,
        }));
      });
    },

    /**
     * Undoes the User's confirmed Import `id` (ADR-0030): every live Card
     * stamped with it, wherever it is now, edited or studied, is soft-deleted
     * as one Deletion, which the Import records with when, all in one
     * transaction. A Card deleted on its own before keeps its own Deletion.
     * The Macros it added, the Images and the Reviews stay. Refused for no
     * such confirmed Import ("not_found") and for one with no live Card
     * ("nothing_to_undo"). The Cards' `updatedAt` is left alone, so a Card
     * is still counted as edited only when it was. `now` and `deletionId` are
     * for the Seed data and tests.
     */
    undo(
      userId: string,
      id: string,
      { now = new Date(), deletionId = randomUUID() }: { now?: Date; deletionId?: string } = {},
    ): UndoImportResponse | UndoRefusal {
      return db.transaction(
        (tx) => {
          const row = rowOf(tx, userId, id);
          if (row === undefined || row.confirmedAt === null) return "not_found";
          const taken = tx
            .update(card)
            .set({ deletedAt: now, deletionId })
            .where(and(eq(card.userId, userId), eq(card.importId, id), isNull(card.deletedAt)))
            .returning({ id: card.id })
            .all();
          if (taken.length === 0) return "nothing_to_undo";
          tx.update(card_import)
            .set({ undoneAt: now, undoDeletionId: deletionId })
            .where(eq(card_import.id, id))
            .run();
          return { deletionId, cards: taken.length };
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Removes every Import, any User's, never confirmed and made 24 hours or
     * more before `now`, with its staged files; then every staging folder
     * with no unconfirmed Import, last changed 24 hours or more before `now`.
     * A confirmed Import is never removed. Answers how many Imports went.
     */
    sweep(now = new Date()): number {
      const cutoff = new Date(now.getTime() - UNCONFIRMED_KEPT_MS);
      const gone = db
        .delete(card_import)
        .where(and(isNull(card_import.confirmedAt), lte(card_import.createdAt, cutoff)))
        .returning({ id: card_import.id })
        .all();
      for (const { id } of gone) rmSync(stagedDir(id), { recursive: true, force: true });
      const waiting = new Set(
        db
          .select({ id: card_import.id })
          .from(card_import)
          .where(isNull(card_import.confirmedAt))
          .all()
          .map((row) => row.id),
      );
      for (const name of readdirSync(importsDir)) {
        if (waiting.has(name)) continue;
        const path = join(importsDir, name);
        const stats = statSync(path, { throwIfNoEntry: false });
        if (stats === undefined || stats.mtimeMs > cutoff.getTime()) continue;
        rmSync(path, { recursive: true, force: true });
      }
      return gone.length;
    },
  };
}

/** Whether the User has any Import, confirmed or not. */
export const hasImports = (db: Queryable, userId: string): boolean =>
  db
    .select({ id: card_import.id })
    .from(card_import)
    .where(eq(card_import.userId, userId))
    .limit(1)
    .get() !== undefined;
