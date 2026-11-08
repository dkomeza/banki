import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGE_FORMATS,
  type ImageProblem,
  type ImportResponse,
  type Macro,
  type MacroPlanEntry,
  type NumberedCard,
  type SkippedDuplicate,
  frontKey,
  imageFormatOf,
  imageReferencesIn,
  sortTags,
} from "@banki/shared";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, card_import, deck, user_settings } from "../db/schema";
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
import { isLiveDeck, writeTags } from "./cards";
import { createImageRepository } from "./images";

export type ImportRepository = ReturnType<typeof createImportRepository>;

/** How long an unconfirmed Import is kept: 24 hours, as an Image no Card refers to. */
export const UNCONFIRMED_KEPT_MS = 24 * 60 * 60 * 1000;

/** A Card to confirm: one of the preview's, by its number, edited or not. */
export type ConfirmedCard = NumberedCard;

/** Why a confirm was refused. */
export type ConfirmRefusal = "not_found" | "confirmed" | "deck_gone" | "unknown_card";

/** The Settings' Macros of the User, under every Deck's own. */
const settingsMacros = (db: Queryable, userId: string): Macro[] =>
  db
    .select({ macros: user_settings.macros })
    .from(user_settings)
    .where(eq(user_settings.userId, userId))
    .get()?.macros ?? [];

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
    out +=
      text.slice(at, reference.start) + piece.replace(`images/${reference.file})`, `images/${to})`);
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
 * adds the ticked Cards in one transaction; `sweep` removes Imports never
 * confirmed. Every query but the sweep's is scoped by the User, so another
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
   * Duplicate, the Macro plan and the image problems as they stand against
   * its Deck now, or its report once confirmed. Undefined for no such Import.
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
        };
      }
      const { preview } = row;
      if (preview === null) return undefined;
      const duplicates = duplicatesOf(preview.cards, liveFronts(tx, userId, row.deckId));
      const images = new Map(Object.entries(preview.images));
      return {
        ...base,
        status: "unconfirmed" as const,
        total: preview.total,
        invalid: preview.invalid,
        cards: preview.cards.map((one, i) => ({ ...one, duplicateOf: duplicates[i] ?? null })),
        macros: planMacros(
          preview.macros,
          settingsMacros(tx, userId),
          deckMacros(tx, userId, row.deckId) ?? [],
        ),
        images: imageProblems(preview.cards, images, preview.zipped, hasImageOf(tx, userId)),
        stagedImages: Object.keys(preview.images).filter(
          (file) => preview.images[file] === "staged",
        ),
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
     * confirmed ("confirmed"), a Deck no longer live ("deck_gone"), or a
     * number the preview has no Card for ("unknown_card"). A Card that is a
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
          // its Front, as read, repeats the Deck or any Card before it, as the
          // preview locked it, and as left out otherwise.
          const added: NumberedCard[] = [];
          const duplicates: SkippedDuplicate[] = [];
          const taken = new Set(deckKeys);
          const before = new Set(deckKeys);
          let leftOut = 0;
          for (const original of preview.cards) {
            const chosen = sent.get(original.number);
            if (chosen === undefined) {
              const key = frontKey(original.front);
              if (key !== "" && (before.has(key) || taken.has(key))) {
                duplicates.push({ number: original.number, front: original.front });
              } else {
                leftOut += 1;
              }
              if (key !== "") before.add(key);
              continue;
            }
            const key = frontKey(chosen.front);
            if (key !== "" && taken.has(key)) {
              duplicates.push({ number: chosen.number, front: chosen.front });
            } else {
              added.push(chosen);
              if (key !== "") taken.add(key);
            }
            const read = frontKey(original.front);
            if (read !== "") before.add(read);
          }

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
          const plan: MacroPlanEntry[] = planMacros(
            preview.macros,
            settingsMacros(tx, userId),
            own,
          );
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
      rmSync(stagedDir(id), { recursive: true, force: true });
      return find(userId, id) ?? "not_found";
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
