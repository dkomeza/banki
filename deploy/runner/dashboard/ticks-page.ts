import type { TickLine } from "../dispatch/tick-log";
import { markup, page, time } from "./html";

// The tick log's page (`/ticks`): the recent lines the tick and `run-now`
// logged, newest first, with consecutive identical lines collapsed into one
// with its count ("Tick on main abc1234 ×60"). Pure, so it is unit-tested.

/** How many of the newest lines the page reads. */
export const TICKS_SHOWN = 5_000;

export type Collapsed = { line: string; count: number; first: string; last: string };

/** The lines, newest first, each run of identical ones as one. */
export function collapse(lines: readonly TickLine[]): Collapsed[] {
  const out: Collapsed[] = [];
  for (const entry of lines.toReversed()) {
    const last = out.at(-1);
    if (last !== undefined && last.line === entry.line) {
      last.count += 1;
      last.first = entry.at;
    } else {
      out.push({ line: entry.line, count: 1, first: entry.at, last: entry.at });
    }
  }
  return out;
}

export function ticksPage(lines: readonly TickLine[], tz: string | undefined): string {
  const shown = collapse(lines.slice(-TICKS_SHOWN));
  return page({
    title: "Ticks",
    body: markup`<h1>The tick log</h1>
      <p class="meta">
        What the tick and <code>run-now</code> logged, newest first, from the last ${TICKS_SHOWN}
        lines. Kept 30 days.
      </p>
      ${
        shown.length === 0
          ? markup`<p class="empty">Nothing logged yet.</p>`
          : markup`<ol class="ticks">
              ${shown.map((entry) => markup`<li><span class="at">${entry.count > 1 ? markup`${time(entry.first, tz)} – ` : ""}${time(entry.last, tz)}</span> <code class="line">${entry.line}${entry.count > 1 ? markup` <span class="count">×${entry.count}</span>` : ""}</code></li>`)}
            </ol>`
      }`,
  });
}
