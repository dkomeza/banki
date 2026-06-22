import Database from "better-sqlite3";
import { unzipSync } from "fflate";
import { decompress } from "fzstd";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "@/lib/db";
import { cards, decks, importReports, media } from "@/lib/db/schema";
import { containsMath } from "@/lib/math";
import { renderAnkiCard, rewriteMedia, type AnkiModel } from "@/lib/anki-template";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 10_000;

export type ImportReport = {
  id: string;
  deckId: string | null;
  fileName: string;
  importedCards: number;
  skippedCards: number;
  importedMedia: number;
  warnings: string[];
};

export function assertArchiveLimits(buffer: Uint8Array) {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The package exceeds the 64 MB upload limit.");
  let total = 0;
  let files = 0;
  for (let offset = 0; offset + 46 < buffer.length; offset++) {
    if (buffer[offset] !== 0x50 || buffer[offset + 1] !== 0x4b || buffer[offset + 2] !== 0x01 || buffer[offset + 3] !== 0x02) continue;
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 46);
    total += view.getUint32(24, true);
    const nameLength = view.getUint16(28, true);
    const name = new TextDecoder().decode(buffer.slice(offset + 46, offset + 46 + nameLength));
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) throw new Error("The package contains an unsafe file path.");
    files++;
    if (files > MAX_FILES || total > MAX_EXPANDED_BYTES) throw new Error("The package expands beyond safe limits.");
  }
}

function mimeType(name: string) {
  const ext = path.extname(name).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

type MediaManifestEntry = { name: string; size?: number; modern: boolean };

function readVarint(data: Uint8Array, offset: number) {
  let value = 0; let shift = 0; let cursor = offset;
  while (cursor < data.length && shift < 70) {
    const byte = data[cursor++]; value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return { value, offset: cursor };
    shift += 7;
  }
  throw new Error("Invalid protobuf varint.");
}

type ProtoValue = { wire: number; bytes?: Uint8Array; number?: number };

function decodeProto(data: Uint8Array) {
  const fields = new Map<number, ProtoValue[]>();
  let offset = 0;
  while (offset < data.length) {
    const key = readVarint(data, offset); offset = key.offset;
    const field = key.value >>> 3; const wire = key.value & 7;
    let value: ProtoValue;
    if (wire === 2) {
      const length = readVarint(data, offset); offset = length.offset;
      value = { wire, bytes: data.slice(offset, offset + length.value) }; offset += length.value;
    } else if (wire === 0) {
      const decoded = readVarint(data, offset); offset = decoded.offset; value = { wire, number: decoded.value };
    } else if (wire === 5) { value = { wire, bytes: data.slice(offset, offset + 4) }; offset += 4; }
    else if (wire === 1) { value = { wire, bytes: data.slice(offset, offset + 8) }; offset += 8; }
    else throw new Error("Unsupported protobuf wire type.");
    fields.set(field, [...(fields.get(field) ?? []), value]);
  }
  return fields;
}

function protoString(fields: Map<number, ProtoValue[]>, field: number) {
  const bytes = fields.get(field)?.[0]?.bytes;
  return bytes ? new TextDecoder().decode(bytes) : "";
}

function decodeMediaEntry(data: Uint8Array, fallbackIndex: number) {
  let offset = 0; let name = ""; let size: number | undefined; let archiveIndex = fallbackIndex;
  while (offset < data.length) {
    const key = readVarint(data, offset); offset = key.offset;
    const field = key.value >>> 3; const wire = key.value & 7;
    if (wire === 2) {
      const length = readVarint(data, offset); offset = length.offset;
      const value = data.slice(offset, offset + length.value); offset += length.value;
      if (field === 1) name = new TextDecoder().decode(value);
    } else if (wire === 0) {
      const value = readVarint(data, offset); offset = value.offset;
      if (field === 2) size = value.value;
      if (field === 255) archiveIndex = value.value;
    } else if (wire === 5) offset += 4;
    else if (wire === 1) offset += 8;
    else throw new Error("Unsupported protobuf wire type.");
  }
  return { archiveName: String(archiveIndex), name, size };
}

function mediaManifest(files: Record<string, Uint8Array>, warnings: string[]) {
  try {
    const value = files.media ? JSON.parse(new TextDecoder().decode(files.media)) : {};
    return new Map<string, MediaManifestEntry>(Object.entries(value).map(([archiveName, originalName]) => [archiveName, { name: String(originalName), modern: false }]));
  } catch {
    if (!files.media) return new Map<string, MediaManifestEntry>();
    try {
      let data = files.media;
      try { data = decompress(data); } catch { /* Legacy-2 manifests may be uncompressed protobuf. */ }
      const result = new Map<string, MediaManifestEntry>();
      let offset = 0; let index = 0;
      while (offset < data.length) {
        const key = readVarint(data, offset); offset = key.offset;
        if ((key.value >>> 3) !== 1 || (key.value & 7) !== 2) throw new Error("Unexpected media manifest field.");
        const length = readVarint(data, offset); offset = length.offset;
        const entry = decodeMediaEntry(data.slice(offset, offset + length.value), index++); offset += length.value;
        if (entry.name) result.set(entry.archiveName, { name: entry.name, size: entry.size, modern: true });
      }
      return result;
    } catch {
      warnings.push("The modern media manifest could not be decoded; card text was still imported.");
      return new Map<string, MediaManifestEntry>();
    }
  }
}

function isSqliteDatabase(data?: Uint8Array) {
  if (!data || data.byteLength < 16) return false;
  return new TextDecoder().decode(data.slice(0, 16)) === "SQLite format 3\0";
}

function chooseCollection(files: Record<string, Uint8Array>, warnings: string[]) {
  const modern = files["collection.anki21b"] ?? files["collection.21b"];
  if (modern) {
    try {
      const expanded = Uint8Array.from(decompress(modern));
      if (isSqliteDatabase(expanded)) return expanded;
      warnings.push("The modern collection did not decompress to a SQLite database; trying a compatibility database.");
    }
    catch { warnings.push("Modern collection decompression failed; trying a compatibility database."); }
  }
  for (const name of ["collection.anki21", "collection.anki2"]) {
    if (isSqliteDatabase(files[name])) return files[name];
  }
  return undefined;
}

function tableExists(source: Database.Database, name: string) {
  return Boolean(source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function tableHasColumn(source: Database.Database, table: string, column: string) {
  return (source.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
}

function neutralizeAnkiCollation(databaseFile: string) {
  const writable = new Database(databaseFile);
  try {
    const objects = writable.prepare("SELECT type, name FROM sqlite_master WHERE sql LIKE '%COLLATE unicase%'").all() as Array<{ type: string; name: string }>;
    if (!objects.length) return;
    for (const object of objects.filter((item) => item.type === "index")) {
      writable.exec(`DROP INDEX IF EXISTS "${object.name.replaceAll('"', '""')}"`);
    }
    writable.unsafeMode(true);
    writable.pragma("writable_schema = ON");
    writable.prepare("UPDATE sqlite_master SET sql = replace(sql, ' COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%'").run();
    writable.pragma("writable_schema = OFF");
    const version = writable.pragma("schema_version", { simple: true }) as number;
    writable.pragma(`schema_version = ${version + 1}`);
  } finally {
    writable.close();
  }
}

function queryAll<T>(source: Database.Database, sql: string, stage: string, parameters: unknown[] = []): T[] {
  try {
    return source.prepare(sql).all(...parameters) as T[];
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown database error"}`);
  }
}

function queryByOrdinal<T>(source: Database.Database, table: "fields" | "templates", columns: string, noteTypeId: number): T[] {
  const rows: T[] = [];
  let consecutiveMisses = 0;
  for (let ordinal = 0; ordinal < 128 && consecutiveMisses < 8; ordinal++) {
    try {
      const row = source.prepare(`SELECT ${columns} FROM ${table} WHERE ntid = ? AND ord = ?`).get(noteTypeId, ordinal) as T | undefined;
      if (row) {
        rows.push(row);
        consecutiveMisses = 0;
      } else {
        consecutiveMisses++;
      }
    } catch (error) {
      throw new Error(`${table} for note type ${noteTypeId}, ordinal ${ordinal}: ${error instanceof Error ? error.message : "unknown database error"}`);
    }
  }
  return rows;
}

function loadCollectionMetadata(source: Database.Database, warnings: string[]) {
  let col: { models: string; decks: string } | undefined;
  try {
    col = source.prepare("SELECT models, decks FROM col LIMIT 1").get() as typeof col;
  } catch (error) {
    throw new Error(`collection header: ${error instanceof Error ? error.message : "unknown database error"}`);
  }
  if (!col) throw new Error("The Anki collection is empty.");
  const models = JSON.parse(col.models || "{}") as Record<string, AnkiModel>;
  let sourceDecks = JSON.parse(col.decks || "{}") as Record<string, { name?: string; desc?: string }>;
  if (Object.keys(models).length) return { models, sourceDecks };

  if (!tableExists(source, "notetypes") || !tableExists(source, "fields") || !tableExists(source, "templates")) {
    throw new Error("The package uses an unsupported Anki note-type schema.");
  }
  const materializedTemplates = tableHasColumn(source, "templates", "front");
  const noteTypeConfigAvailable = tableHasColumn(source, "notetypes", "config");
  const noteTypeIds = queryAll<{ mid: number }>(source, "SELECT mid FROM notes GROUP BY mid", "note-type ids");
  for (const { mid } of noteTypeIds) {
    const noteTypeColumns = noteTypeConfigAvailable ? "id, name, config" : "id, name, X'' AS config";
    const noteType = queryAll<{ id: number; name: string; config: Uint8Array }>(
      source, `SELECT ${noteTypeColumns} FROM notetypes WHERE id = ?`, `note type ${mid}`, [mid],
    )[0];
    if (!noteType) {
      warnings.push(`Note type ${mid} was referenced by cards but missing from the package.`);
      continue;
    }
    const fieldsForType = queryByOrdinal<{ ntid: number; ord: number; name: string }>(source, "fields", "ntid, ord, name", noteType.id);
    const templateColumns = materializedTemplates ? "ntid, ord, name, front, back, css" : "ntid, ord, name, config";
    const templatesForType = queryByOrdinal<{ ntid: number; ord: number; name: string; front?: string; back?: string; css?: string; config?: Uint8Array }>(source, "templates", templateColumns, noteType.id);
    const noteTypeConfig = decodeProto(Uint8Array.from(noteType.config));
    models[String(noteType.id)] = {
      type: noteTypeConfig.get(1)?.[0]?.number === 1 || noteType.name.toLowerCase().includes("cloze") ? 1 : 0,
      flds: fieldsForType.map(({ name, ord }) => ({ name, ord })),
      tmpls: templatesForType.map((row) => {
        const config = row.config ? decodeProto(Uint8Array.from(row.config)) : null;
        return { name: row.name, ord: row.ord, qfmt: row.front ?? (config ? protoString(config, 1) : ""), afmt: row.back ?? (config ? protoString(config, 2) : "") };
      }),
      css: materializedTemplates ? templatesForType[0]?.css ?? "" : protoString(noteTypeConfig, 3),
    };
  }
  if (tableExists(source, "decks")) {
    try {
      const modernDecks = queryAll<{ id: number; name: string }>(source, "SELECT id, name FROM decks", "decks");
      sourceDecks = Object.fromEntries(modernDecks.map((deck) => [String(deck.id), { name: deck.name }]));
    } catch {
      warnings.push("Deck names could not be read; the package filename was used instead.");
    }
  }
  if (Object.values(models).some((model) => model.tmpls?.some((template) => !template.qfmt || !template.afmt))) warnings.push("Some modern templates did not expose materialized front/back markup and may be skipped.");
  return { models, sourceDecks };
}

type ImportedCardRow = { card_id: number; ord: number; nid: number; guid: string; mid: number; tags: string; flds: string; due?: number };

function loadCardRows(source: Database.Database): ImportedCardRow[] {
  try {
    return source.prepare(`
      SELECT c.id AS card_id, c.ord, c.nid, n.guid, n.mid, n.tags, n.flds, c.due
      FROM cards AS c JOIN notes AS n ON n.id = c.nid
    `).all() as ImportedCardRow[];
  } catch {
    // Some exported collections carry planner metadata that makes the join unusable
    // outside Anki. Independent table scans avoid those index constraints.
    const noteRows = queryAll<{ id: number; guid: string; mid: number; tags: string; flds: string }>(
      source, "SELECT id, guid, mid, tags, flds FROM notes", "notes table scan",
    );
    const cardRows = queryAll<{ id: number; ord: number; nid: number; due: number }>(
      source, "SELECT id, ord, nid, due FROM cards", "cards table scan",
    );
    const notesById = new Map(noteRows.map((note) => [note.id, note]));
    return cardRows.flatMap((card) => {
      const note = notesById.get(card.nid);
      return note ? [{ card_id: card.id, ord: card.ord, nid: card.nid, due: card.due, ...note }] : [];
    });
  }
}

export async function importApkg(fileName: string, archive: Uint8Array): Promise<ImportReport> {
  assertArchiveLimits(archive);
  const files = unzipSync(archive);
  const warnings: string[] = [];
  const collection = chooseCollection(files, warnings);
  if (!collection) throw new Error("No supported Anki collection database was found.");
  const deckId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const now = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "banki-apkg-"));
  const databaseFile = path.join(tempDir, "collection.sqlite");
  fs.writeFileSync(databaseFile, collection);
  neutralizeAnkiCollation(databaseFile);
  const source = new Database(databaseFile, { readonly: true, fileMustExist: true });

  try {
    let metadata: ReturnType<typeof loadCollectionMetadata>;
    try {
      metadata = loadCollectionMetadata(source, warnings);
    } catch (error) {
      throw new Error(`Could not read Anki note types: ${error instanceof Error ? error.message : "unknown database error"}`);
    }
    const { models, sourceDecks } = metadata;
    const deckName = Object.values(sourceDecks).find((item) => item.name && item.name !== "Default")?.name ?? path.basename(fileName, path.extname(fileName));
    const description = Object.values(sourceDecks).find((item) => item.desc)?.desc ?? "";

    db.insert(decks).values({ id: deckId, name: deckName, description, sourceName: fileName, createdAt: now, updatedAt: now }).run();
    const manifest = mediaManifest(files, warnings);
    const mediaMap = new Map<string, string>();
    const defaultMediaDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "media");
    const mediaDir = path.join(process.env.MEDIA_DIR ?? defaultMediaDir, deckId);
    fs.mkdirSync(mediaDir, { recursive: true });
    let importedMedia = 0;
    for (const [archiveName, entry] of manifest) {
      let content = files[archiveName];
      if (!content) { warnings.push(`Missing media file: ${entry.name}`); continue; }
      if (entry.modern && entry.size && content.byteLength !== entry.size) {
        try {
          const expanded = decompress(content);
          if (expanded.byteLength === entry.size) content = Uint8Array.from(expanded);
        } catch { warnings.push(`Could not decompress media file: ${entry.name}`); }
      }
      const safeName = `${crypto.randomUUID()}${path.extname(entry.name).toLowerCase()}`;
      fs.writeFileSync(path.join(mediaDir, safeName), content);
      const publicPath = `/media/${deckId}/${safeName}`;
      mediaMap.set(entry.name, publicPath);
      db.insert(media).values({ id: crypto.randomUUID(), deckId, originalName: entry.name, storedName: safeName, mimeType: mimeType(entry.name), size: content.byteLength, createdAt: now }).run();
      importedMedia++;
    }

    let rows: ImportedCardRow[];
    try {
      rows = loadCardRows(source).sort((a, b) => (a.due ?? 0) - (b.due ?? 0) || a.card_id - b.card_id);
    } catch (error) {
      throw new Error(`Could not read Anki cards: ${error instanceof Error ? error.message : "unknown database error"}`);
    }
    let importedCards = 0;
    let skippedCards = 0;
    for (const row of rows) {
      const rendered = renderAnkiCard(models[String(row.mid)] ?? {}, row.flds.split("\x1f"), row.ord);
      if (!rendered || !rendered.frontHtml.trim()) { skippedCards++; continue; }
      const frontHtml = rewriteMedia(rendered.frontHtml, mediaMap);
      const backHtml = rewriteMedia(rendered.backHtml, mediaMap);
      const unresolvedTemplate = /\{\{[^{}\n]{1,80}\}\}/.test(frontHtml) || /\{\{[^{}\n]{1,80}\}\}/.test(backHtml);
      if (unresolvedTemplate && warnings.length < 30) warnings.push(`Card ${row.card_id} contains an unsupported template filter.`);
      db.insert(cards).values({
        id: crypto.randomUUID(), deckId, sourceGuid: `${row.guid}:${row.ord}`,
        frontHtml, backHtml, tags: JSON.stringify(row.tags.trim().split(/\s+/).filter(Boolean)),
        position: importedCards, due: now, createdAt: now, updatedAt: now,
      }).run();
      importedCards++;
    }
    if (rows.some((row) => containsMath(row.flds))) warnings.push("Mathematical content detected and enabled for MathJax rendering.");
    const report: ImportReport = { id: reportId, deckId, fileName, importedCards, skippedCards, importedMedia, warnings: [...new Set(warnings)] };
    db.insert(importReports).values({ ...report, warnings: JSON.stringify(report.warnings), createdAt: now }).run();
    return report;
  } catch (error) {
    db.delete(decks).where((await import("drizzle-orm")).eq(decks.id, deckId)).run();
    throw error;
  } finally {
    source.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
