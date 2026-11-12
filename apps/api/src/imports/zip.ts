import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

// A reader of zip archives, enough for an Import's `.zip` (ADR-0026): the
// central directory's entries, and each one's bytes, stored or deflated. It
// trusts nothing the archive says: every offset is checked against the
// archive, and inflating stops at the size the entry claims. Beside it, the
// writer of an export's `.zip` (BAN-34), which the reader reads back.

/** One file in a zip: its path, and its sizes as the central directory gives them. */
export type ZipEntry = {
  name: string;
  /** Its size unpacked, in bytes. */
  size: number;
  compressedSize: number;
  method: number;
  encrypted: boolean;
  localHeaderOffset: number;
};

/** An archive Banki can't read, with the message to show. */
export class ZipError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** Whether `bytes` start as a zip does: a local file header, or the end of an empty archive. */
export const looksLikeZip = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));

/** The entries of the zip `bytes`, files only (no folders), in the central directory's order. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record: 22 bytes, then a comment of up to 64 KB.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw new ZipError("This zip can't be read: its end is missing");
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError(
      "This zip can't be read: Banki reads zips up to 4 GB with fewer than 65,535 files",
    );
  }
  if (offset + size > eocd) throw new ZipError("This zip can't be read: its directory is damaged");

  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError("This zip can't be read: its directory is damaged");
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localHeaderOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    entries.push({
      name,
      size: uncompressed,
      compressedSize,
      method,
      encrypted: (flags & 1) === 1,
      localHeaderOffset,
    });
  }
  return entries;
}

/** The unpacked bytes of `entry` in the zip `bytes`. */
export function zipEntryBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.encrypted) throw new ZipError(`This zip can't be read: ${entry.name} is encrypted`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localHeaderOffset;
  if (header + 30 > bytes.length || view.getUint32(header, true) !== LOCAL_SIGNATURE) {
    throw new ZipError(`This zip can't be read: ${entry.name} is damaged`);
  }
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipError(`This zip can't be read: ${entry.name} is damaged`);
  const data = bytes.subarray(start, end);
  if (entry.method === STORED) {
    if (data.length !== entry.size) {
      throw new ZipError(`This zip can't be read: ${entry.name} is damaged`);
    }
    return data;
  }
  if (entry.method !== DEFLATED) {
    throw new ZipError(
      `This zip can't be read: ${entry.name} is packed in a way Banki doesn't read`,
    );
  }
  let out: Uint8Array;
  try {
    // Never more than the entry claims, so a zip bomb can't unpack past its total.
    out = inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) });
  } catch {
    throw new ZipError(`This zip can't be read: ${entry.name} is damaged`);
  }
  if (out.length !== entry.size) {
    throw new ZipError(`This zip can't be read: ${entry.name} is damaged`);
  }
  return out;
}

/** A file to write into a zip: its path, its bytes, and whether to deflate them or store them as they are. */
export type ZipInput = { name: string; data: Uint8Array; deflate: boolean };

/** The most entries, and bytes, a zip without Zip64 can hold. */
const ZIP_MAX_ENTRIES = 0xffff;
const ZIP_MAX_BYTES = 0xffffffff;

/** Bit 11 of an entry's flags: its name is UTF-8. */
const UTF8_NAME = 1 << 11;

/** `date` as MS-DOS writes it, in local time, 1980 at the earliest: its time and its date. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * A zip archive of `files`, in their order, each dated `modified`: what the
 * reader above reads and other tools open. Each is deflated or stored as it
 * says, with its CRC and its name in UTF-8. No Zip64, so more than 65,535
 * files, or 4 GB, is an error.
 */
export function writeZip(
  files: readonly ZipInput[],
  modified = new Date(),
): Uint8Array<ArrayBuffer> {
  if (files.length >= ZIP_MAX_ENTRIES) throw new Error("A zip without Zip64 holds fewer files");
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modified);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.deflate ? new Uint8Array(deflateRawSync(file.data)) : file.data;
    const crc = crc32(file.data);
    const method = file.deflate ? DEFLATED : STORED;
    // The fields a local header and its central directory entry share, from "version needed" on.
    const shared = (view: DataView, at: number) => {
      view.setUint16(at, 20, true);
      view.setUint16(at + 2, UTF8_NAME, true);
      view.setUint16(at + 4, method, true);
      view.setUint16(at + 6, time, true);
      view.setUint16(at + 8, date, true);
      view.setUint32(at + 10, crc, true);
      view.setUint32(at + 14, data.length, true);
      view.setUint32(at + 18, file.data.length, true);
      view.setUint16(at + 22, name.length, true);
    };

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIGNATURE, true);
    shared(lv, 4);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIGNATURE, true);
    cv.setUint16(4, 20, true);
    shared(cv, 6);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
    if (offset > ZIP_MAX_BYTES) throw new Error("A zip without Zip64 holds up to 4 GB");
  }
  const directorySize = centrals.reduce((sum, central) => sum + central.length, 0);
  if (offset + directorySize > ZIP_MAX_BYTES) {
    throw new Error("A zip without Zip64 holds up to 4 GB");
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD_SIGNATURE, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + directorySize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
