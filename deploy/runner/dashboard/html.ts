import { redactTokens } from "../dispatch/secrets";

// What every page of the Dashboard is built from (ADR-0015). The Stages'
// logs and the issues' comments are untrusted text, so everything shown goes
// through `show`: redacted of anything shaped like a token, then
// HTML-escaped. A page is one document with a same-origin stylesheet and, on
// the pages that stream, a same-origin script; the CSP allows nothing else.
// Pure, so it is unit-tested.

/** Text made safe to put in HTML, in an element or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Untrusted text, redacted and escaped: the only way text gets onto a page. */
export const show = (text: string): string => escapeHtml(redactTokens(text));

/** HTML that is already safe, built from `show`n text and the page's own markup. */
export type Html = { html: string };
export const raw = (safe: string): Html => ({ html: safe });

/** A tagged template whose interpolations are shown (strings, numbers) or kept (Html, lists of Html). */
export function markup(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? "");
  });
  return { html: out };
}

function render(value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "object" && "html" in value && typeof value.html === "string")
    return value.html;
  if (typeof value === "string") return show(value);
  if (typeof value === "number" || typeof value === "boolean") return show(String(value));
  return "";
}

/** A link to an issue's page. */
export const issueLink = (issue: string): Html =>
  markup`<a href="/issues/${encodeURIComponent(issue)}">${issue}</a>`;

/** A time, in the server's timezone, to the minute: `2026-10-24 01:47`. */
export function when(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** A time element, its machine-readable value beside the shown one. */
export const time = (iso: string, timeZone: string | undefined): Html =>
  markup`<time datetime="${iso}">${when(iso, timeZone)}</time>`;

/** A duration: `47 min`, `1 h 13 min`, or `under a minute`. */
export function duration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes === 0) return "under a minute";
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const dollars = (usd: number): string => `$${usd.toFixed(2)}`;

export type PageOptions = {
  title: string;
  /** The page's main content. */
  body: Html;
  /** Whether the page streams: then it gets the script, which follows its `data-stream` element. */
  streams?: boolean;
  /** Reloads the page this often without JavaScript, for the pages that stream. */
  refreshS?: number;
};

const NAV = markup`<nav><a href="/">Now</a> <a href="/ticks">Ticks</a></nav>`;

/** A whole page: the stylesheet, the nav, the content, and the script only where it streams. */
export function page(options: PageOptions): string {
  const refresh =
    options.refreshS === undefined
      ? ""
      : `<noscript><meta http-equiv="refresh" content="${options.refreshS}"></noscript>`;
  return markup`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="referrer" content="no-referrer" />
        ${raw(refresh)}
        <title>${options.title} · Banki Runner</title>
        <link rel="stylesheet" href="/style.css" />
        ${options.streams === true ? raw('<script src="/live.js" defer></script>') : ""}
      </head>
      <body>
        <header>${NAV}</header>
        <main>${options.body}</main>
      </body>
    </html> `.html;
}
