import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// How the Dashboard reads a Stage's logs (ADR-0015): a Stage writes them,
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

export type LogTail = {
  /** Its last whole lines, at most `maxLines` of them within `maxBytes`. */
  lines: string[];
  /**
   * How many bytes come before them, left out: where the first of them
   * starts, known without reading those bytes.
   */
  leftOutBytes: number;
  /** Where its last whole line ends: a stream goes on from there. */
  end: number;
};

/**
 * A log's newest whole lines for its page, and how many bytes before them
 * it leaves out. It reads its last `maxBytes` and nothing before them, so a
 * page's load costs the same however big the log has grown.
 */
export function logTail(path: string, maxLines = PAGE_LINES, maxBytes = PAGE_BYTES): LogTail {
  return (
    withFile(path, (fd, size) => {
      const start = Math.max(0, size - maxBytes);
      const bytes = bytesAt(fd, start, size - start);
      const last = bytes.lastIndexOf(0x0a);
      if (last === -1) return { lines: [], leftOutBytes: start, end: start };
      // Back from the last line, at most `maxLines` of them: `from` is where
      // the earliest kept starts. A line at the tail's start is cut short,
      // unless the tail is the whole file.
      let from = last + 1;
      for (let kept = 0; kept < maxLines; kept += 1) {
        const newline = from < 2 ? -1 : bytes.lastIndexOf(0x0a, from - 2);
        if (newline === -1 && start > 0) break;
        from = newline + 1;
        if (newline === -1) break;
      }
      const lines = from > last ? [] : bytes.subarray(from, last).toString("utf8").split("\n");
      return { lines, leftOutBytes: start + from, end: start + last + 1 };
    }) ?? { lines: [], leftOutBytes: 0, end: 0 }
  );
}

export type Chunk = {
  /** The whole lines read, without their newlines, each with the byte just past its newline. */
  lines: { text: string; end: number }[];
  /** Where the next read starts. */
  end: number;
  /** Set when a line ran on past `maxBytes`: its bytes so far are passed over, unread. */
  overlong: boolean;
};

/**
 * The whole lines of a file from `from`, at most `maxBytes` of them, each
 * with where it ends in bytes, for a stream to resume from. A line longer
 * than that comes back as `overlong`, its bytes so far passed over. Throws
 * when the file can't be read, such as once it is deleted.
 */
export function readChunk(path: string, from: number, maxBytes = CHUNK_BYTES): Chunk {
  const fd = openSync(path, "r");
  try {
    const bytes = bytesAt(fd, from, maxBytes);
    const last = bytes.lastIndexOf(0x0a);
    if (last === -1) {
      const overlong = bytes.length === maxBytes;
      return { lines: [], end: overlong ? from + bytes.length : from, overlong };
    }
    // Counted in the file's bytes, never in the text's characters.
    const lines: Chunk["lines"] = [];
    for (let start = 0; start <= last;) {
      const newline = bytes.indexOf(0x0a, start);
      lines.push({
        text: bytes.subarray(start, newline).toString("utf8"),
        end: from + newline + 1,
      });
      start = newline + 1;
    }
    return { lines, end: from + last + 1, overlong: false };
  } finally {
    closeSync(fd);
  }
}
