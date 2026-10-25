import { percent } from "../dispatch/gate";
import { logLines } from "../dispatch/stage-log";
import { dollars, duration, markup, issueLink, page, time } from "./html";
import { PAGE_LINES } from "./files";
import { outcome } from "./parts";
import { closingDetail, type Entry } from "./timeline";

// The Stage-log page (`/issues/BAN-N/logs/<file>`): a Stage's stream-json
// log as the one-line summaries `runner stage` prints, never the raw JSON,
// or its supervisor's `.log` line by line; then the Stage's result, from the
// Runner's records and its closing comment. A running Stage's log streams
// its new lines over SSE from where the page ends. Pure, so it is
// unit-tested.

/** The lines a log shows: one per event of a `.jsonl`, the supervisor's own of a `.log`. */
export function shownLines(file: string, lines: readonly string[]): string[] {
  if (file.endsWith(".jsonl")) return logLines(lines);
  return lines.filter((line) => line.trim() !== "");
}

export type LogView = {
  issue: string;
  file: string;
  /** The lines shown, as `shownLines` makes them, of the log's last lines. */
  lines: string[];
  /** How many of the log's lines came before those, left out. */
  skipped: number;
  /** Where in the file the page ends, in bytes: the stream goes on from there. */
  offset: number;
  /** Whether this is the log of a Stage's run going on now. */
  running: boolean;
  /** The attempt this log is a run of, if the Runner's records have it. */
  attempt?: Extract<Entry, { type: "attempt" }>;
  /** Why the closing comments couldn't be read, if they couldn't. */
  linearError?: string;
};

export const streamOf = (issue: string, file: string, offset: number) =>
  `/issues/${encodeURIComponent(issue)}/logs/${encodeURIComponent(file)}/events?from=${offset}`;

export function logPage(view: LogView, tz: string | undefined): string {
  const { attempt } = view;
  const lines = markup`<ol
    class="log"
    ${view.running ? markup` id="log" data-stream="${streamOf(view.issue, view.file, view.offset)}" data-mode="append"` : ""}
  >
    ${view.lines.map((line) => markup`<li>${line}</li>`)}
  </ol>`;
  const result =
    attempt === undefined
      ? markup`<p class="empty">
          The Runner's records hold no Stage with this log: a Stage run by hand with
          <code>runner stage</code>, or one whose record is gone.
        </p>`
      : markup`<p class="head">${attempt.stage} Stage: ${outcome(attempt.label)}</p>
          <p class="reason">${attempt.reason}</p>
          <p class="meta">
            ${attempt.share === undefined ? "week's share not known" : `${percent(attempt.share)} of the week`},
            ${dollars(attempt.usd)} ·
            ${duration(attempt.durationMs)}${attempt.endedAt === undefined ? "" : markup` · ended ${time(attempt.endedAt, tz)}`}
          </p>
          ${attempt.closing === undefined ? "" : closingDetail(attempt.closing, tz)}`;
  return page({
    title: `${view.issue} ${view.file}`,
    streams: view.running,
    refreshS: view.running ? 30 : undefined,
    body: markup`<h1>${issueLink(view.issue)}: <code>${view.file}</code></h1>
      ${view.running ? markup`<p class="meta">Running: new lines follow as the Stage logs them.</p>` : ""}
      <section>
        <h2>Events</h2>
        ${view.skipped === 0 ? "" : markup`<p class="meta">The log's first ${view.skipped} lines are left out: only its last ${PAGE_LINES} at most are shown here.</p>`}
${view.lines.length === 0 && !view.running ? markup`<p class="empty">The log is empty.</p>` : lines}
      </section>
      <section>
        <h2>The Stage's result</h2>
        ${view.linearError === undefined ? "" : markup`<p class="error">The closing comments couldn't be read: ${view.linearError}</p>`}
        ${view.running ? markup`<p class="empty">Not yet: the Stage is running.</p>` : result}
      </section>`,
  });
}
