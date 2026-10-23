// Nothing the broker logs or returns on an error may hold a key, a secret or
// a token (ADR-0012). The adapters build their errors from a status and the
// upstream's own error code only, and everything goes through this on its way
// out, as a backstop.

/** Shorter values are left alone: they would match ordinary words. */
const MIN_LENGTH = 8;

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  // Longest first, so a secret holding another is replaced whole.
  const sorted = secrets
    .flatMap((secret) => secretParts(secret))
    .filter((part) => part.length >= MIN_LENGTH)
    .toSorted((a, b) => b.length - a.length);
  for (const part of sorted) out = out.replaceAll(part, "[redacted]");
  return out;
}

/** A secret, and each of its lines: a PEM key is quoted line by line, if at all. */
function secretParts(secret: string): string[] {
  const trimmed = secret.trim();
  return [trimmed, ...trimmed.split(/\r?\n/).map((line) => line.trim())];
}
