import { redact } from "../broker/redact";

// What the Dispatcher posts from a Stage's log never shows a token: the
// ones it knows (the Claude token, the Linear token the Stage was given),
// and anything shaped like a GitHub or Linear token, or sent as an
// Authorization header. Pure, so it is unit-tested.

const REDACTED = "[redacted]";

const SHAPES: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\blin_[a-z]+_[A-Za-z0-9]{16,}/g,
];

export function redactTokens(text: string, known: readonly string[] = []): string {
  let out = redact(text, known);
  for (const shape of SHAPES) out = out.replaceAll(shape, REDACTED);
  out = out.replaceAll(/\b(Bearer\s+)(?!\[redacted\])[^\s"'`]+/gi, `$1${REDACTED}`);
  out = out.replaceAll(
    /\b(Authorization:\s*)(?!Bearer\b)(?:[A-Za-z]+\s+)?(?!\[redacted\])[^\s"'`]+/gi,
    `$1${REDACTED}`,
  );
  return out;
}
