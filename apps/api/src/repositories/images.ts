import { randomUUID } from "node:crypto";
import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGE_FORMAT_MESSAGE,
  IMAGE_FORMATS,
  IMAGE_MAX_BYTES,
  type ImageFormat,
  imageFormatOf,
  imageTooLargeMessage,
} from "@banki/shared";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, image } from "../db/schema";

export type ImageRepository = ReturnType<typeof createImageRepository>;

/** How long an Image no Card refers to, or a file in `uploads/` with no row, is kept: 24 hours. */
export const UNREFERENCED_KEPT_MS = 24 * 60 * 60 * 1000;

/** Why an upload was refused, with the message to show. */
export type ImageRefusal =
  | { refused: "too_large"; message: string }
  | { refused: "unsupported_format"; message: string };

/** What a sweep deleted: Images no Card refers to, and files in `uploads/` with no row. */
export type ImageSweep = { images: number; files: number };

/** The refusal of an Image of `bytes` bytes, over the limit. */
export const tooLarge = (bytes: number): ImageRefusal => ({
  refused: "too_large",
  message: imageTooLargeMessage(bytes),
});

const UNSUPPORTED: ImageRefusal = { refused: "unsupported_format", message: IMAGE_FORMAT_MESSAGE };

/** The file an Image is stored as, and the last part of its reference: `<id>.<ext>`. */
const fileName = (id: string, format: ImageFormat) => `${id}.${IMAGE_FORMATS[format].extension}`;

/**
 * The IDs a Card's Markdown refers to as Images: any `images/<id>.<ext>` in
 * it, written as an image or not, so nothing is deleted while any text could
 * still show it.
 */
const REFERRED = /images\/([\w-]+)\.[A-Za-z0-9]+/g;

/** Whether the User has any Image at all. */
export const hasImages = (db: Queryable, userId: string): boolean =>
  db.select({ id: image.id }).from(image).where(eq(image.userId, userId)).limit(1).get() !==
  undefined;

/**
 * The User's Images (ADR-0001, ADR-0019): stored byte for byte in `uploadsDir`
 * with a row each, served back by their reference, and deleted by the sweep
 * once no Card that isn't Removed refers to them. Every query but the sweep's
 * is scoped by the User, so another User's Image is as unknown as one that
 * never existed.
 */
export function createImageRepository(db: Queryable, uploadsDir: string) {
  return {
    /**
     * Stores `bytes` as a new Image of the User's, unless it is over 5 MB or
     * not a PNG, JPEG, WebP or GIF by its bytes, and answers its reference,
     * `images/<id>.<ext>`. The file is written before the row, so a failure
     * between them leaves only a file with no row, which the sweep deletes.
     * `id` and `now` are for the Seed data and tests.
     */
    store(
      userId: string,
      bytes: Uint8Array,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): { reference: string } | ImageRefusal {
      if (bytes.byteLength > IMAGE_MAX_BYTES) return tooLarge(bytes.byteLength);
      const format = imageFormatOf(bytes);
      if (format === undefined) return UNSUPPORTED;
      const name = fileName(id, format);
      writeFileSync(join(uploadsDir, name), bytes, { flag: "wx", mode: 0o600 });
      db.insert(image)
        .values({ id, userId, format, size: bytes.byteLength, uploadedAt: now })
        .run();
      return { reference: `images/${name}` };
    },

    /**
     * The User's Image named `file`, `<id>.<ext>`, as its path in `uploadsDir`
     * and its type; undefined when there is no such Image, or the extension
     * isn't its format's.
     */
    find(userId: string, file: string): { path: string; contentType: string } | undefined {
      const dot = file.lastIndexOf(".");
      if (dot <= 0) return undefined;
      const id = file.slice(0, dot);
      const row = db
        .select({ format: image.format })
        .from(image)
        .where(and(eq(image.userId, userId), eq(image.id, id)))
        .get();
      if (row === undefined || fileName(id, row.format) !== file) return undefined;
      return { path: join(uploadsDir, file), contentType: IMAGE_FORMATS[row.format].contentType };
    },

    /**
     * Deletes, row and file, every Image, any User's, uploaded 24 hours or more
     * before `now` that no Card of its User's refers to, live or deleted (a
     * Removed Card has no row left); then every file in `uploadsDir` with no
     * Image row, last changed 24 hours or more before `now`. The rows go in one
     * transaction with the reading of the Cards, so a Card saved meanwhile
     * waits for it and can't refer to an Image deleted under it.
     */
    sweep(now = new Date()): ImageSweep {
      const cutoff = new Date(now.getTime() - UNREFERENCED_KEPT_MS);
      const gone = db.transaction(
        (tx) => {
          const old = tx
            .select({ id: image.id, userId: image.userId, format: image.format })
            .from(image)
            .where(lte(image.uploadedAt, cutoff))
            .all();
          if (old.length === 0) return [];
          const referred = new Set<string>();
          const sides = tx
            .select({ userId: card.userId, front: card.front, back: card.back })
            .from(card)
            .where(inArray(card.userId, [...new Set(old.map((row) => row.userId))]))
            .all();
          for (const { userId, front, back } of sides) {
            for (const match of `${front}\n${back}`.matchAll(REFERRED)) {
              referred.add(`${userId}/${match[1]}`);
            }
          }
          const unreferred = old.filter((row) => !referred.has(`${row.userId}/${row.id}`));
          for (let at = 0; at < unreferred.length; at += 500) {
            const ids = unreferred.slice(at, at + 500).map((row) => row.id);
            tx.delete(image).where(inArray(image.id, ids)).run();
          }
          return unreferred;
        },
        { behavior: "immediate" },
      );
      for (const row of gone)
        rmSync(join(uploadsDir, fileName(row.id, row.format)), { force: true });

      const kept = new Set(
        db
          .select({ id: image.id, format: image.format })
          .from(image)
          .all()
          .map((row) => fileName(row.id, row.format)),
      );
      let files = 0;
      for (const name of readdirSync(uploadsDir)) {
        if (kept.has(name)) continue;
        const path = join(uploadsDir, name);
        const stats = statSync(path, { throwIfNoEntry: false });
        if (stats === undefined || !stats.isFile() || stats.mtimeMs > cutoff.getTime()) continue;
        rmSync(path, { force: true });
        files += 1;
      }
      return { images: gone.length, files };
    },
  };
}
