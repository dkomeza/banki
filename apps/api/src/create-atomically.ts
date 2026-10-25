import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, rmSync, writeSync } from "node:fs";

const isErrorCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

/**
 * Writes `content` to `file` all at once, readable by its owner only: it goes
 * to a temp file beside it first and is then hard-linked into place, so `file`
 * never exists half written, even if the process dies. Returns false when
 * `file` already exists, leaving it alone; throws on any other failure.
 */
export function createAtomically(file: string, content: string): boolean {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(temp, file);
    return true;
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) return false;
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}
