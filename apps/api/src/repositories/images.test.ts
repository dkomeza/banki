import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase, uploadsDirOf } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { image } from "../db/schema";
import { type CardRepository, createCardRepository } from "./cards";
import { createDeckRepository } from "./decks";
import { type DeletionRepository, createDeletionRepository } from "./deletions";
import { type ImageRepository, createImageRepository, hasImages } from "./images";
import { createUserRepository } from "./user";

let tempDir: string;
let uploads: string;
let opened: OpenedDatabase;
let images: ImageRepository;
let cards: CardRepository;
let deletions: DeletionRepository;
let deckId: string;

const USER = "user-1";
const OTHER = "user-2";
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-10-26T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

/** A PNG's signature and a few bytes more: enough to pass for one. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-images-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  uploads = uploadsDirOf(tempDir);
  createUserRepository(opened.db).createWithPassword({
    userId: USER,
    accountId: "a1",
    email: "u@x.y",
    passwordHash: "h",
  });
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${OTHER}, 'n', 'o@x.y', 1, 0, 0)`,
  );
  images = createImageRepository(opened.db, uploads);
  cards = createCardRepository(opened.db);
  deletions = createDeletionRepository(opened.db);
  const deck = createDeckRepository(opened.db).create(USER, {
    name: "D",
    description: null,
    folderId: null,
  });
  if (typeof deck === "string") throw new Error(deck);
  deckId = deck.id;
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Stores an Image uploaded `hours` ago and answers its reference and file name. */
const upload = (hours: number, userId = USER) => {
  const stored = images.store(userId, PNG, { now: hoursAgo(hours) });
  if (!("reference" in stored)) throw new Error(stored.message);
  return { reference: stored.reference, file: stored.reference.slice("images/".length) };
};

const write = (back: string) => {
  const created = cards.create(USER, deckId, { front: "f", back });
  if (typeof created === "string") throw new Error(created);
  return created.id;
};

const kept = (file: string) =>
  existsSync(join(uploads, file)) &&
  opened.db
    .select({ id: image.id })
    .from(image)
    .all()
    .some((row) => file.startsWith(`${row.id}.`));

describe("store", () => {
  test("writes the bytes as uploaded under uploads/, with a row, and answers the reference", () => {
    const stored = images.store(USER, PNG, { id: "abc", now: NOW });

    expect(stored).toEqual({ reference: "images/abc.png" });
    expect(new Uint8Array(readFileSync(join(uploads, "abc.png")))).toEqual(PNG);
    expect(opened.db.select().from(image).all()).toEqual([
      { id: "abc", userId: USER, format: "png", size: PNG.byteLength, uploadedAt: NOW },
    ]);
    expect(hasImages(opened.db, USER)).toBe(true);
    expect(hasImages(opened.db, OTHER)).toBe(false);
  });

  test("refuses what is over 5 MB or not an image by its bytes, storing nothing", () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);

    expect(images.store(USER, big)).toMatchObject({ refused: "too_large" });
    expect(images.store(USER, new TextEncoder().encode("<svg></svg>"))).toMatchObject({
      refused: "unsupported_format",
    });
    expect(readdirSync(uploads)).toEqual([]);
    expect(hasImages(opened.db, USER)).toBe(false);
  });

  test("replaces a file left behind at the same name, such as a fixed seed ID's after a rollback", () => {
    writeFileSync(join(uploads, "abc.png"), "left behind");

    expect(images.store(USER, PNG, { id: "abc", now: NOW })).toEqual({
      reference: "images/abc.png",
    });
    expect(new Uint8Array(readFileSync(join(uploads, "abc.png")))).toEqual(PNG);
    expect(readdirSync(uploads)).toEqual(["abc.png"]);
  });

  test("takes exactly 5 MB", () => {
    const limit = new Uint8Array(5 * 1024 * 1024);
    limit.set(PNG);

    expect(images.store(USER, limit)).toHaveProperty("reference");
  });
});

describe("find", () => {
  test("finds the User's Image by its file name, with its type", () => {
    const { file } = upload(0);

    expect(images.find(USER, file)).toEqual({
      path: join(uploads, file),
      contentType: "image/png",
    });
  });

  test("knows no other User's Image, an unknown one, or one under another extension", () => {
    const { file } = upload(0);
    const id = file.replace(".png", "");

    expect(images.find(OTHER, file)).toBeUndefined();
    expect(images.find(USER, "nope.png")).toBeUndefined();
    expect(images.find(USER, `${id}.jpg`)).toBeUndefined();
    expect(images.find(USER, id)).toBeUndefined();
  });
});

describe("sweep", () => {
  test("deletes an abandoned upload, row and file, once it is 24 hours old, and not before", () => {
    const old = upload(24);
    const fresh = upload(23);

    expect(images.sweep(NOW)).toEqual({ images: 1, files: 0 });
    expect(kept(old.file)).toBe(false);
    expect(existsSync(join(uploads, old.file))).toBe(false);
    expect(kept(fresh.file)).toBe(true);
  });

  test("keeps an Image a live Card refers to, however old", () => {
    const { reference, file } = upload(1000);
    write(`text\n![](${reference})`);

    expect(images.sweep(NOW)).toEqual({ images: 0, files: 0 });
    expect(kept(file)).toBe(true);
  });

  test("deletes an Image once an edit drops the reference to it", () => {
    const { reference, file } = upload(48);
    const id = write(`![](${reference})`);
    images.sweep(NOW);
    expect(kept(file)).toBe(true);

    cards.update(USER, id, { back: "no image now" });

    expect(images.sweep(NOW).images).toBe(1);
    expect(kept(file)).toBe(false);
  });

  test("keeps an Image two Cards share until neither refers to it", () => {
    const { reference, file } = upload(48);
    const first = write(`![](${reference})`);
    const second = write(`See ![](${reference})`);

    cards.update(USER, first, { back: "dropped" });
    images.sweep(NOW);
    expect(kept(file)).toBe(true);

    cards.update(USER, second, { back: "dropped too" });
    images.sweep(NOW);
    expect(kept(file)).toBe(false);
  });

  test("keeps a deleted Card's Image, and deletes it once the Card's Deletion is Removed", () => {
    const { reference, file } = upload(48);
    const id = write(`![](${reference})`);
    const deletionId = cards.softDelete(USER, id);
    if (deletionId === undefined) throw new Error("not deleted");

    images.sweep(NOW);
    expect(kept(file)).toBe(true);

    deletions.remove(USER, deletionId);
    // Removal itself deletes no Image: the sweep does.
    expect(kept(file)).toBe(true);
    images.sweep(NOW);
    expect(kept(file)).toBe(false);
  });

  test("keeps an Image only a Card's Grading notes refer to, until that Card is Removed", () => {
    const { reference, file } = upload(48);
    const created = cards.create(USER, deckId, {
      front: "f",
      back: "b",
      gradingNotes: `Like ![](${reference})`,
    });
    if (typeof created === "string") throw new Error(created);

    images.sweep(NOW);
    expect(kept(file)).toBe(true);

    const deletionId = cards.softDelete(USER, created.id);
    if (deletionId === undefined) throw new Error("not deleted");
    images.sweep(NOW);
    expect(kept(file)).toBe(true);

    deletions.remove(USER, deletionId);
    images.sweep(NOW);
    expect(kept(file)).toBe(false);
  });

  test("doesn't count another User's Card as referring to the User's Image", () => {
    const { reference, file } = upload(48);
    const theirs = createDeckRepository(opened.db).create(OTHER, {
      name: "Theirs",
      description: null,
      folderId: null,
    });
    if (typeof theirs === "string") throw new Error(theirs);
    cards.create(OTHER, theirs.id, { front: "f", back: `![](${reference})` });

    images.sweep(NOW);

    expect(kept(file)).toBe(false);
  });

  test("deletes files with no row once they are 24 hours old, and leaves newer ones", () => {
    const { file } = upload(0);
    const oldTime = hoursAgo(25);
    for (const name of ["left-behind.png", "half-written.tmp"]) {
      writeFileSync(join(uploads, name), "x");
      utimesSync(join(uploads, name), oldTime, oldTime);
    }
    writeFileSync(join(uploads, "just-written.png"), "x");
    // The Image's own file is old too, but it has its row.
    utimesSync(join(uploads, file), oldTime, oldTime);

    expect(images.sweep(NOW)).toEqual({ images: 0, files: 2 });
    expect(readdirSync(uploads).toSorted()).toEqual([file, "just-written.png"].toSorted());
  });
});
