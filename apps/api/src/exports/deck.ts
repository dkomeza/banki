import { existsSync, readFileSync } from "node:fs";
import {
  CARD_FILE_VERSION,
  type CardFile,
  cardFileSchemaUrl,
  effectiveMacros,
} from "@banki/shared";
import { referencedFiles } from "../imports/read";
import { type ZipInput, writeZip } from "../imports/zip";
import type { CardRepository } from "../repositories/cards";
import type { DeckRepository } from "../repositories/decks";
import type { ImageRepository } from "../repositories/images";
import type { SettingsRepository } from "../repositories/settings";

// Exporting a Deck (BAN-34): a `.zip` holding a Card file of its live Cards
// and effective Macros, `<Deck name>.json`, with an `images/` folder beside it
// holding every Image of the User's those Cards refer to, under the name the
// reference already gives it, so nothing is rewritten (ADR-0019). It is the
// zip an Import reads. Cards only: no IDs, Reviews, Progress or Deck settings.

/** A Deck exported: the zip's file name, `<Deck name>.zip`, and its bytes. */
export type DeckExport = { fileName: string; zip: Uint8Array<ArrayBuffer> };

/** What a file name can't hold: `/ \ : * ? " < > |` and control characters. */
const UNSAFE = /[/\\:*?"<>|\p{Cc}]/gu;

/** `name` as a file name with no extension: unsafe characters as `-`, and `Deck` for a blank one. */
export function exportBaseName(name: string): string {
  const safe = name.replace(UNSAFE, "-").trim();
  return safe === "" ? "Deck" : safe;
}

/**
 * The `Content-Disposition` that saves a download as `fileName`: an ASCII
 * `filename` for old clients, with `_` for anything else, and the UTF-8 name
 * as `filename*` (RFC 6266), which every current browser prefers.
 */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Exports the User's Deck `deckId` for the installation at `origin`;
 * "not_found" for a Deck that is deleted, unknown or another User's.
 */
export function exportDeck(
  {
    decks,
    cards,
    settings,
    images,
  }: {
    decks: DeckRepository;
    cards: CardRepository;
    settings: SettingsRepository;
    images: ImageRepository;
  },
  userId: string,
  deckId: string,
  { origin, now = new Date() }: { origin: string; now?: Date },
): DeckExport | "not_found" {
  const deck = decks.find(userId, deckId);
  if (deck === undefined) return "not_found";
  const listed = cards.list(userId, deckId);
  if (listed === "not_found") return "not_found";
  // Listed newest first; a Card file holds them oldest first, as they were written.
  const live = listed.toReversed();

  const file: CardFile = {
    $schema: cardFileSchemaUrl(origin),
    format: "banki",
    version: CARD_FILE_VERSION,
    macros: effectiveMacros(settings.get(userId).macros, deck.macros),
    cards: live.map(({ front, back, tags, gradingNotes }) => ({
      front,
      back,
      tags,
      gradingNotes,
    })),
  };

  const base = exportBaseName(deck.name);
  const entries: ZipInput[] = [
    {
      name: `${base}.json`,
      data: new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`),
      deflate: true,
    },
  ];
  // Each Image once, in the order the Cards first refer to it. A reference to
  // anything that isn't one of the User's Images, or whose file is gone, stays
  // as written, with no file.
  for (const name of new Set(live.flatMap(referencedFiles))) {
    const found = images.find(userId, name);
    if (found === undefined || !existsSync(found.path)) continue;
    // Images are packed already: deflating them again gains nothing.
    entries.push({ name: `images/${name}`, data: readFileSync(found.path), deflate: false });
  }
  return { fileName: `${base}.zip`, zip: writeZip(entries, now) };
}
