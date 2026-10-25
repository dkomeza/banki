import { basename } from "node:path";
import type { ActiveRecord } from "../dispatch/lifecycle";
import { supervisorLog } from "../dispatch/spawn";
import type { TickLine } from "../dispatch/tick-log";
import { errorText } from "../lib/config";
import type { SharedView } from "./cache";
import { redactTokens } from "../dispatch/secrets";
import { markup, page } from "./html";
import { type Chunk, logTail, readChunk } from "./files";
import type { LiveView } from "./live";
import { logPage, shownLines } from "./log-page";
import { nowFragment, nowPage } from "./now-page";
import { isIssue, servedLogPath } from "./paths";
import { ticksPage } from "./ticks-page";
import { attemptOf, type IssueData, issuePage, timeline } from "./timeline";

// The Dashboard's HTTP side (ADR-0015), a thin adapter over the pages'
// builders: `GET` only (anything else answers 405), every response with the
// strict CSP and no caching, and two SSE streams: the Now page's live view
// every 30 seconds, and a running Stage's log as it grows. It trusts
// whatever reaches it: Pangolin's SSO, in front of it, is the only auth.
//
//   GET /                              Now
//   GET /events                        Now's live view, every 30 s (SSE)
//   GET /issues/BAN-N                  the issue's timeline
//   GET /issues/BAN-N/logs/<file>      one Stage log
//   GET /issues/BAN-N/logs/<file>/events?from=<byte>   its new lines (SSE)
//   GET /ticks                         the tick log
//   GET /style.css, /live.js           the page's own stylesheet and script

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

export type ServerDeps = {
  live: SharedView<LiveView>;
  /** An issue's page data: the volume's records and logs, and Linear's comments and moves. */
  issue: (issue: string) => Promise<IssueData>;
  /** The logs directory, /work/logs. */
  logs: string;
  activeRecords: () => ActiveRecord[];
  ticks: () => TickLine[];
  tz: string | undefined;
  assets: { css: string; js: string };
  log: (line: string) => void;
  /** How often a log's stream looks for new lines. */
  pollMs?: number;
  /** How often the Now page's stream sends the live view. */
  liveEveryMs?: number;
  /** How often a stream says it is still there, so nothing in between drops it. */
  pingMs?: number;
  /** How a log's stream reads its next lines: files.ts's `readChunk`, but in tests. */
  readChunk?: (path: string, from: number) => Chunk;
  /** How many bytes a stream holds for a client that is behind, before it waits for it. */
  streamBufferBytes?: number;
};

const respond = (body: string, status: number, type: string, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { ...HEADERS, "Content-Type": `${type}; charset=utf-8`, ...extra },
  });

const htmlPage = (body: string, status = 200) => respond(body, status, "text/html");

const notFound = () =>
  htmlPage(
    page({
      title: "Not found",
      body: markup`<h1>Not found</h1>
        <p><a href="/">Now</a></p>`,
    }),
    404,
  );

/** One SSE message: its event, the id the client resumes from, and its data line by line. */
export function sseMessage(event: string, data: string, id?: string): string {
  const lines = data.split(/\r?\n|\r/).map((line) => `data: ${line}`);
  return `event: ${event}\n${id === undefined ? "" : `id: ${id}\n`}${lines.join("\n")}\n\n`;
}

/** What a log's stream says for a line too long to read whole; `id` is the byte past its end. */
const tooLong = (id?: number) =>
  sseMessage("line", "(an event too long to show)", id === undefined ? undefined : String(id));

/** How many bytes a stream holds for a client that is behind, by default. */
export const STREAM_BUFFER_BYTES = 64 << 10;

/**
 * An SSE response: `produce` sends messages until it returns or the client
 * goes, with a ping in between so an idle connection isn't dropped. The
 * stream holds `bufferBytes` at most for a client that is behind: `send`
 * waits until the client has read enough, so a big log or a slow client
 * never piles up in memory, and a ping goes out only when nothing waits to
 * be read. A producer that fails, such as on a log deleted under it, is
 * logged, its client told the stream has ended, and the stream closed:
 * never the process's end.
 */
function sse(
  request: Request,
  options: { pingMs: number; bufferBytes: number; log: (line: string) => void },
  produce: (send: (message: string) => Promise<void>, open: () => boolean) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let ping: Timer | undefined;
  /** The producer's wait for room, ended by a read, or by the client going. */
  let wake: (() => void) | undefined;
  const woken = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const enqueue = (message: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(message));
          } catch {
            closed = true;
          }
        };
        const open = () => !closed && !request.signal.aborted;
        const send = async (message: string) => {
          enqueue(message);
          while (open() && (controller.desiredSize ?? 0) <= 0) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        };
        const stop = () => {
          if (closed) return;
          closed = true;
          clearInterval(ping);
          woken();
          try {
            controller.close();
          } catch {
            // Closed already.
          }
        };
        request.signal.addEventListener("abort", stop, { once: true });
        ping = setInterval(() => {
          // Only into an empty stream: behind a client that doesn't read, pings would pile up.
          if ((controller.desiredSize ?? 0) >= options.bufferBytes) enqueue(": ping\n\n");
        }, options.pingMs);
        enqueue("retry: 5000\n\n");
        void (async () => {
          try {
            await produce(send, open);
          } catch (error) {
            options.log(`${new URL(request.url).pathname} failed: ${errorText(error)}`);
            enqueue(sseMessage("end", "the stream failed"));
          } finally {
            stop();
          }
        })();
      },
      // The client has read: there is room for more.
      pull() {
        woken();
      },
      cancel() {
        closed = true;
        clearInterval(ping);
        woken();
      },
    },
    { highWaterMark: options.bufferBytes, size: (chunk) => chunk?.byteLength ?? 0 },
  );
  return new Response(stream, {
    headers: { ...HEADERS, "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

const sleep = (ms: number, open: () => boolean) =>
  new Promise<void>((resolve) => {
    const step = Math.min(ms, 250);
    let waited = 0;
    const timer = setInterval(() => {
      waited += step;
      if (waited >= ms || !open()) {
        clearInterval(timer);
        resolve();
      }
    }, step);
  });

export function handler(deps: ServerDeps): (request: Request) => Promise<Response> {
  const pollMs = deps.pollMs ?? 1_000;
  const liveEveryMs = deps.liveEveryMs ?? 30_000;
  const pingMs = deps.pingMs ?? 15_000;
  const read = deps.readChunk ?? ((path: string, from: number) => readChunk(path, from));
  const streams = {
    pingMs,
    bufferBytes: deps.streamBufferBytes ?? STREAM_BUFFER_BYTES,
    log: deps.log,
  };

  /** Whether this log is a run going on now: the newest run of a Stage running, or its supervisor's. */
  const running = (issue: string, file: string) =>
    deps.activeRecords().some((record) => {
      const log = record.runs.at(-1)?.log;
      return (
        record.issue === issue &&
        record.state === "running" &&
        log !== undefined &&
        record.runs.at(-1)?.endedAt === undefined &&
        (basename(log) === file || basename(supervisorLog(log)) === file)
      );
    });

  async function logView(issue: string, file: string, path: string): Promise<Response> {
    const tail = logTail(path);
    const isRunning = running(issue, file);
    const data = await deps.issue(issue);
    return htmlPage(
      logPage(
        {
          issue,
          file,
          lines: shownLines(file, tail.lines),
          skipped: tail.skipped,
          offset: tail.end,
          running: isRunning,
          attempt: attemptOf(timeline(data), issue, file),
          linearError: "error" in data.linear ? data.linear.error : undefined,
        },
        deps.tz,
      ),
    );
  }

  function logEvents(request: Request, issue: string, file: string, path: string): Response {
    const url = new URL(request.url);
    const resume = Number(request.headers.get("last-event-id") ?? url.searchParams.get("from"));
    let offset = Number.isSafeInteger(resume) && resume >= 0 ? resume : 0;
    /** Set while passing over a line too long to read whole, until its end. */
    let passing = false;
    return sse(request, streams, async (send, open) => {
      while (open()) {
        const still = running(issue, file);
        // A chunk at a time, until it has caught up with the file.
        for (;;) {
          const chunk = read(path, offset);
          if (chunk.end === offset) break;
          offset = chunk.end;
          if (chunk.overlong) {
            passing = true;
            continue;
          }
          // Each line's id is the byte just past it, so a client that resumes
          // with it goes on from the line after its last.
          for (const [i, line] of chunk.lines.entries()) {
            if (i === 0 && passing) {
              // The rest of the line passed over: said once, at its end.
              passing = false;
              await send(tooLong(line.end));
              continue;
            }
            // Plain text, redacted: live.js sets it as a line's textContent, never as HTML.
            for (const shown of shownLines(file, [line.text]))
              await send(sseMessage("line", redactTokens(shown), String(line.end)));
            if (!open()) return;
          }
        }
        if (!still) {
          if (passing) await send(tooLong());
          await send(sseMessage("end", "the Stage's run has ended"));
          return;
        }
        await sleep(pollMs, open);
      }
    });
  }

  function nowEvents(request: Request): Response {
    return sse(request, streams, async (send, open) => {
      while (open()) {
        await sleep(liveEveryMs, open);
        if (!open()) return;
        try {
          await send(sseMessage("view", nowFragment(await deps.live.get(), deps.tz)));
        } catch (error) {
          deps.log(`The live view failed: ${errorText(error)}`);
        }
      }
    });
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let parts: string[];
    try {
      parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    } catch {
      return notFound();
    }
    const [first, issue, third, file, fifth, ...rest] = parts;
    if (parts.length === 1 && first === "")
      return htmlPage(nowPage(await deps.live.get(), deps.tz));
    if (parts.length === 1 && first === "events") return nowEvents(request);
    if (parts.length === 1 && first === "ticks") return htmlPage(ticksPage(deps.ticks(), deps.tz));
    if (parts.length === 1 && first === "style.css")
      return respond(deps.assets.css, 200, "text/css");
    if (parts.length === 1 && first === "live.js")
      return respond(deps.assets.js, 200, "text/javascript");
    if (first !== "issues" || issue === undefined || !isIssue(issue)) return notFound();
    if (parts.length === 2) return htmlPage(issuePage(await deps.issue(issue), deps.tz));
    if (third !== "logs" || file === undefined || rest.length > 0) return notFound();
    const path = servedLogPath(deps.logs, issue, file);
    if (path === undefined) return notFound();
    if (parts.length === 4) return logView(issue, file, path);
    if (parts.length === 5 && fifth === "events") return logEvents(request, issue, file, path);
    return notFound();
  }

  return async (request) => {
    if (request.method !== "GET") {
      return respond("Only GET: the Dashboard is read-only.\n", 405, "text/plain", {
        Allow: "GET",
      });
    }
    try {
      return await route(request);
    } catch (error) {
      deps.log(`${new URL(request.url).pathname} failed: ${errorText(error)}`);
      return htmlPage(
        page({
          title: "Error",
          body: markup`<h1>Something failed</h1>
            <p class="error">${errorText(error)}</p>`,
        }),
        500,
      );
    }
  };
}
