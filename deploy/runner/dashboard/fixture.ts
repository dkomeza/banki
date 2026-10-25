import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeLinear } from "../dispatch/test-fakes";
import { dashboard } from "./app";
import { github, issues, NOW, writeVolume } from "./fixtures/ban-11";
import { handler } from "./server";

// The Dashboard over a fixture shaped like BAN-11's night
// (fixtures/ban-11.ts), with Linear, GitHub and the Broker faked and the
// clock fixed, for looking at its pages in a browser without the home
// server. Nothing in it is real, and it listens on 127.0.0.1 alone:
//
//   bun deploy/runner/dashboard/fixture.ts [port]

const port = Number(process.argv[2] ?? 8790);
const work = mkdtempSync(join(tmpdir(), "banki-dashboard-fixture-"));
writeVolume(work);
const linear = fakeLinear(issues());

const deps = await dashboard({
  work,
  session: {
    broker: {
      linearToken: async () => ({ id: "fixture", token: "fixture" }),
      endLinearToken: async () => undefined,
      githubToken: async () => "fixture",
    },
    linear: () => linear.client,
    github: () => github(),
    log: (line) => console.log(line),
  },
  config: {
    window: { night: { start: 60, end: 420 }, openDays: new Set([6, 0]) },
    ceiling: 0.6,
    maxStages: 2,
    timeZone: "UTC",
  },
  now: () => NOW,
  log: (line) => console.log(line),
});

const server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 60, fetch: handler(deps) });
console.log(`The Dashboard's fixture: http://127.0.0.1:${server.port}/ (volume ${work})`);
const end = () => {
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", end);
process.on("SIGTERM", end);
