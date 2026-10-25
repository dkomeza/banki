import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { store } from "../dispatch/store";
import { fakeLinear } from "../dispatch/test-fakes";
import { dashboard } from "./app";
import { ACTIVE, github, issues, NOW, writeVolume } from "./fixtures/ban-11";
import { CSP, handler, type ServerDeps } from "./server";

// The Dashboard's HTTP side, on the BAN-11 fixture's volume, with Linear,
// GitHub and the Broker faked: GET only, the strict CSP everywhere, the
// pages whole without JavaScript, nothing served outside an issue's logs,
// and the two streams.

const work = mkdtempSync(join(tmpdir(), "banki-dashboard-server-"));
writeVolume(work);
writeFileSync(join(work, "outside.log"), "s3cr3t\n");
afterAll(() => rmSync(work, { recursive: true, force: true }));

async function setup(options: Partial<ServerDeps> = {}) {
  const linear = fakeLinear(issues());
  const minted: string[] = [];
  const revoked: string[] = [];
  const deps = await dashboard({
    work,
    session: {
      broker: {
        linearToken: async () => {
          minted.push("token");
          return { id: `token-${minted.length}`, token: "lin" };
        },
        endLinearToken: async (id) => {
          revoked.push(id);
        },
        githubToken: async () => "gh",
      },
      linear: () => linear.client,
      github: () => github(),
      log: () => undefined,
    },
    config: {
      window: { night: { start: 60, end: 420 }, openDays: new Set([6, 0]) },
      ceiling: 0.6,
      maxStages: 2,
      timeZone: "UTC",
    },
    now: () => NOW,
    log: () => undefined,
  });
  const fetch = handler({ ...deps, ...options });
  const get = (path: string, init?: RequestInit) => fetch(new Request(`http://dash${path}`, init));
  return { get, minted, revoked };
}

const PAGES = [
  "/",
  "/ticks",
  "/issues/BAN-11",
  "/issues/BAN-11/logs/2026-10-24T04-50-00Z-design.jsonl",
  "/issues/BAN-11/logs/2026-10-23T23-00-05Z-design.log",
];

describe("the Dashboard's server", () => {
  test("answers anything but GET with 405", async () => {
    const { get } = await setup();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const res = await get("/", { method });

      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    }
  });

  test("sends the strict CSP, and no caching, with every response", async () => {
    const { get } = await setup();
    for (const path of [...PAGES, "/style.css", "/live.js", "/nowhere"]) {
      const res = await get(path);

      expect(res.headers.get("content-security-policy")).toBe(CSP);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).not.toContain("unsafe-inline");
  });

  test("renders every page whole without JavaScript: no inline script or style, and none from elsewhere", async () => {
    const { get } = await setup();
    for (const path of PAGES) {
      const res = await get(path);
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).toContain("</main>");
      expect(text).not.toMatch(/<script(?![^>]*\bsrc="\/live\.js")/);
      expect(text).not.toMatch(/\sstyle=|<style/);
      expect(text).not.toMatch(/(src|href)="(https?:)?\/\//);
    }
  });

  test("serves no file outside the issue's logs: a path that leaves it answers 404", async () => {
    const { get } = await setup();
    for (const path of [
      "/issues/BAN-11/logs/..%2F..%2Foutside.log",
      "/issues/BAN-11/logs/../../outside.log",
      "/issues/BAN-11/logs/%2E%2E%2F..%2Fdispatcher%2Fgate.json",
      "/issues/BAN-11/logs/2026-10-24T04-50-00Z-design.jsonl/../../../outside.log",
      "/issues/..%2F..%2Fdispatcher/logs/gate.log",
      "/issues/BAN-12/logs/2026-10-24T04-50-00Z-design.jsonl",
      "/issues/BAN-11/logs/missing.jsonl",
      "/issues/BAN-11/logs/%E0%A4%A",
    ]) {
      const res = await get(path);

      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("s3cr3t");
    }
  });

  test("shows on the Now page everything runner status shows, the waits' deadlines and the pull agent's flags", async () => {
    const { get } = await setup();
    // The page's own markup wraps its lines as it likes; what it says is what counts.
    const text = (await (await get("/")).text()).replaceAll(/\s+/g, " ").replaceAll("> <", "><");

    for (const words of [
      "Running",
      '<a href="/issues/BAN-12">BAN-12</a>',
      "$1.10",
      "Paused",
      "BAN-13",
      'BAN-14</a> implement: <span class="no">waits: 2 Stages are running or paused already',
      "Waiting for the Slug Previews since",
      "<code>ban-11-b</code>: queued, 47 min of 60",
      "the pull agent hasn&#39;t claimed it for 47 min",
      "<code>PR #38</code>: queued, 30 min of 60",
      "the pull agent hasn&#39;t claimed it for 20 min",
      "the week at <strong>42%</strong> of the Ceiling's 60%",
      "Estimates:",
      '<a href="/issues/BAN-16">BAN-16</a>',
      "Recent Stages",
      'data-stream="/events"',
    ]) {
      expect(text).toContain(words);
    }
    expect(text).not.toContain("ban-11-a</code> (slug-preview)");
  });

  test("computes the live view once for any number of viewers, with one Linear token, revoked", async () => {
    const { get, minted, revoked } = await setup();

    await Promise.all(Array.from({ length: 20 }, () => get("/")));

    expect(minted).toHaveLength(1);
    expect(revoked).toEqual(["token-1"]);
  });

  test("shows a Stage log one line per event, never raw JSON, escaped and redacted, then its result", async () => {
    const { get } = await setup();
    const done = await (await get("/issues/BAN-11/logs/2026-10-24T04-50-00Z-design.jsonl")).text();
    const crashed = await (
      await get("/issues/BAN-11/logs/2026-10-23T23-30-00Z-design.jsonl")
    ).text();

    expect(done).toContain("say: &lt;script&gt;alert(&#39;a log line&#39;)&lt;/script&gt;");
    expect(done).not.toContain("<script>alert");
    expect(done).not.toContain("&quot;type&quot;");
    expect(done).toContain("Built two Variants of the deck list");
    expect(done).not.toContain("data-stream");
    expect(crashed).toContain("tool: Bash GH_TOKEN=[redacted] gh pr list");
    expect(crashed).toContain('class="outcome outcome-crashed"');
  });

  test("streams a running Stage's log as it grows, and ends with its run", async () => {
    const { get } = await setup({ pollMs: 10, pingMs: 1_000 });
    const file = "2026-10-24T07-20-00Z-implement.jsonl";
    const path = join(work, "logs", "BAN-12", file);
    const page = await (await get(`/issues/BAN-12/logs/${file}`)).text();
    const from = /events\?from=(\d+)/.exec(page)?.[1];

    expect(from).toBeDefined();
    const res = await get(`/issues/BAN-12/logs/${file}/events?from=${from}`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error("no stream");
    const decoder = new TextDecoder();
    let seen = "";
    const until = async (words: string) => {
      while (!seen.includes(words)) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value);
      }
    };

    appendFileSync(
      path,
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "<b>new</b>" }] } })}\n`,
    );
    await until("say:");
    expect(seen).toContain("event: line\n");
    expect(seen).toContain("data: say: <b>new</b>");
    expect(seen).not.toContain("Going on from the parser tests");

    const records = store(join(work, "dispatcher"));
    const running = ACTIVE[0];
    if (running === undefined) throw new Error("no running Stage");
    records.removeActive(running.issue);
    await until("event: end");
    expect(seen).toContain("event: end");
    records.saveActive(running);
  });

  test("sends the Now page's live view over its stream", async () => {
    const { get } = await setup({ liveEveryMs: 10, pingMs: 1_000 });
    const res = await get("/events");
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error("no stream");
    let seen = "";
    while (!seen.includes("Recent Stages")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    await reader.cancel();

    expect(seen).toContain("event: view\n");
    expect(seen).toMatch(/data: .*As of/);
  });

  test("collapses the tick log's consecutive identical lines", async () => {
    const { get } = await setup();
    const text = await (await get("/ticks")).text();

    expect(text).toContain('Tick on main def5678 <span class="count">×8</span>');
    expect(text).toContain('Tick on main abc1234 <span class="count">×16</span>');
  });
});
