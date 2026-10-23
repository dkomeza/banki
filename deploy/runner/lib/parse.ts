// Small hand-written readers for the JSON the Runner gets back from GitHub,
// Linear, the broker and `claude`. It has no npm dependencies, so these stand
// in for a schema library: each one checks only the fields it reads, and
// names where a wrong one was found.

/** The part of `fetch` the adapters use, so tests can hand them a fake. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class ParseError extends Error {
  override name = "ParseError";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asObject(value: unknown, at: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ParseError(`${at}: expected an object`);
  return value;
}

export function asArray(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new ParseError(`${at}: expected an array`);
  return value;
}

export function asString(value: unknown, at: string): string {
  if (typeof value !== "string") throw new ParseError(`${at}: expected a string`);
  return value;
}

export function asNumber(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ParseError(`${at}: expected a number`);
  }
  return value;
}

/** A field that is a string, or undefined when it is missing or null. */
export function asOptionalString(value: unknown, at: string): string | undefined {
  return value === undefined || value === null ? undefined : asString(value, at);
}

/** The JSON in `text`, or a {@link ParseError} naming where it came from. */
export function parseJson(text: string, at: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ParseError(`${at}: expected JSON`);
  }
}
