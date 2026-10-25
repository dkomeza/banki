import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// How the Dashboard reads a Stage's logs (ADR-0014): a Stage writes them,
// so they can be any size, and the Dashboard has 256 MB. Never a whole log:
// its head, for the init event that comes first; its tail, for the result
// event that comes last and the newest lines; or, for a stream, the next
// chunk of it. A line it can't read whole within its bound is left out.

/** How much of a log's head tells whether `claude` started. */
export const HEAD_BYTES = 1 << 20;
/** How much of a log's tail holds its newest result event. */
export const TAIL_BYTES = 1 << 20;
/** The most of a log the log page shows: its last lines, within this many bytes. */
export const PAGE_LINES = 2_000;
export const PAGE_BYTES = 8 << 20;
/** The most a stream reads at once. */
export const CHUNK_BYTES = 1 << 20;

/** Runs `read` on an open file; undefined when it can't be opened or read. */
function withFile<T>(path: string, read: (fd: number, size: number) => T): T | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    return read(fd, fstatSync(fd).size);
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function bytesAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(Math.max(0, length));
  let filled = 0;
  while (filled < buffer.length) {
    const read = readSync(fd, buffer, filled, buffer.length - filled, position + filled);
    if (read === 0) break;
    filled += read;
  }
  return buffer.subarray(0, filled);
}

/** The lines in a file's first `maxBytes`; none when it can't be read. */
export function readHead(path: string, maxBytes = HEAD_BYTES): string[] {
  return (
    withFile(path, (fd, size) =>
      bytesAt(fd, 0, Math.min(size, maxBytes)).toString("utf8").split("\n"),
    ) ?? []
  );
}

/** The whole lines in a file's last `maxBytes`; none when it can't be read. */
export function readTail(path: string, maxBytes = TAIL_BYTES): string[] {
  return (
    withFile(path, (fd, size) => {
      const start = Math.max(0, size - maxBytes);
      const lines = bytesAt(fd, start, size - start)
        .toString("utf8")
        .split("\n");
      // The first is cut short, unless the tail is the whole file.
      return start === 0 ? lines : lines.slice(1);
    }) ?? []
  );
}

/** Newline bytes in a file's first `end` bytes, counted a chunk at a time. */
function linesBefore(fd: number, end: number): number {
  let count = 0;
  for (let position = 0; position < end; position += CHUNK_BYTES) {
    const bytes = bytesAt(fd, position, Math.min(CHUNK_BYTES, end - position));
    for (const byte of bytes) if (byte === 0x0a) count += 1;
  }
  return count;
}

export type LogTail = {
  /** Its last whole lines, at most `maxLines` of them within `maxBytes`. */
  lines: string[];
  /** How many whole lines came before them, left out. */
  skipped: number;
  /** Where its last whole line ends: a stream goes on from there. */
  end: number;
};

/** A log's newest whole lines for its page, and how many earlier ones are left out. */
export function logTail(path: string, maxLines = PAGE_LINES, maxBytes = PAGE_BYTES): LogTail {
  return (
    withFile(path, (fd, size) => {
      const start = Math.max(0, size - maxBytes);
      const bytes = bytesAt(fd, start, size - start);
      const last = bytes.lastIndexOf(0x0a);
      if (last === -1) return { lines: [], skipped: linesBefore(fd, start), end: start };
      const end = start + last + 1;
      let lines = bytes.subarray(0, last).toString("utf8").split("\n");
      if (start > 0) lines = lines.slice(1);
      const kept = lines.slice(-maxLines);
      return { lines: kept, skipped: linesBefore(fd, end) - kept.length, end };
    }) ?? { lines: [], skipped: 0, end: 0 }
  );
}

export type Chunk = {
  /** The whole lines read, each ending in a newline. */
  text: string;
  /** Where the next read starts. */
  end: number;
  /** Set when a line ran on past `maxBytes`: its bytes so far are passed over, unread. */
  overlong: boolean;
};

/**
 * The whole lines of a file from `from`, at most `maxBytes` of them. A line
 * longer than that comes back as `overlong`, its bytes so far passed over.
 * Throws when the file can't be read, such as once it is deleted.
 */
export function readChunk(path: string, from: number, maxBytes = CHUNK_BYTES): Chunk {
  const fd = openSync(path, "r");
  try {
    const bytes = bytesAt(fd, from, maxBytes);
    const last = bytes.lastIndexOf(0x0a);
    if (last === -1) {
      const overlong = bytes.length === maxBytes;
      return { text: "", end: overlong ? from + bytes.length : from, overlong };
    }
    return {
      text: bytes.subarray(0, last + 1).toString("utf8"),
      end: from + last + 1,
      overlong: false,
    };
  } finally {
    closeSync(fd);
  }
}
