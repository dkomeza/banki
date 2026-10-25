import { broker } from "../cli/broker-client";
import { dispatcherConfig } from "../dispatch/config";
import { github } from "../dispatch/github";
import { linear } from "../dispatch/linear";
import { errorText } from "../lib/config";
import { run } from "../lib/run";
import { dashboard } from "./app";
import { watchHead } from "./head";
import { handler } from "./server";

// The Dashboard (ADR-0014), the `dashboard` service in compose.yaml: run by
// bin/dashboard from the clone of `main` on the Runner's volume, mounted
// read-only, like the tick. It reads Linear and GitHub through the Broker's
// socket, as `runner status` does, and holds no secret of its own. It
// listens on 8790, which compose.yaml publishes on the host's 127.0.0.1
// alone, for a Pangolin resource behind its SSO. Every 30 seconds it looks
// at the clone's HEAD, and once that has moved it exits, so Docker starts it
// again on the new `main`.

const WORK = "/work";
const CLONE = "/work/banki";
const PORT = Number(process.env.BANKI_DASHBOARD_PORT ?? 8790);
const HEAD_EVERY_MS = 30_000;

const log = (line: string) => console.log(line);

async function head(): Promise<string | undefined> {
  const result = await run(["git", "-C", CLONE, "rev-parse", "HEAD"], { timeoutMs: 30_000 });
  const sha = result.stdout.trim();
  return result.exitCode === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

let deps: Awaited<ReturnType<typeof dashboard>>;
try {
  deps = await dashboard({
    work: WORK,
    session: {
      broker: broker(),
      linear: (token) => linear(token),
      github: (token) => github(token),
      log,
    },
    config: dispatcherConfig(process.env),
    now: () => new Date(),
    log,
  });
} catch (error) {
  console.error(`The Dashboard can't start: ${errorText(error)}`);
  process.exit(1);
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  // Its streams ping every 15 seconds.
  idleTimeout: 60,
  fetch: handler(deps),
});
log(`The Dashboard listens on ${server.port}`);

const given = process.env.BANKI_DASHBOARD_HEAD?.trim() ?? "";
await watchHead({
  // bin/dashboard's reading, from before this code was loaded.
  started: /^[0-9a-f]{40}$/.test(given) ? given : undefined,
  read: head,
  everyMs: HEAD_EVERY_MS,
  onMove: (now) => {
    log(`The clone is on main ${now.slice(0, 7)} now: exiting, for Docker to start it on that`);
    void server.stop(true).finally(() => process.exit(0));
  },
});
