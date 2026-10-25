import { join } from "node:path";
import type { DispatcherConfig } from "../dispatch/config";
import type { SessionDeps } from "../dispatch/session";
import { store } from "../dispatch/store";
import { readTickLines } from "../dispatch/tick-log";
import { sharedView } from "./cache";
import { liveComputer } from "./live";
import { localLog } from "./paths";
import type { ServerDeps } from "./server";
import { issueData, readLines, volumePaths } from "./volume";

// The Dashboard put together over a volume shaped like /work and a way to
// Linear and GitHub: main.ts gives it the real ones, through the Broker, and
// fixture.ts stand-ins, for looking at its pages locally.

const ASSETS = {
  css: join(import.meta.dir, "style.css"),
  js: join(import.meta.dir, "live.js"),
};

export async function dashboard(options: {
  work: string;
  session: SessionDeps;
  config: DispatcherConfig;
  now: () => Date;
  log: (line: string) => void;
}): Promise<ServerDeps> {
  const paths = volumePaths(options.work);
  const records = store(paths.dispatcher);
  const deps = { ...options.session, records, config: options.config, now: options.now };
  const live = sharedView({
    compute: liveComputer({ ...deps, readLog: (path) => readLines(localLog(paths.logs, path)) }),
    now: () => Date.now(),
  });
  return {
    live,
    issue: async (issue) => {
      const data = await issueData({ ...deps, logs: paths.logs }, issue);
      const waiting = live.peek()?.status.waiting.find((wait) => wait.issue === issue);
      return waiting === undefined ? data : { ...data, waiting };
    },
    logs: paths.logs,
    activeRecords: () => records.activeRecords(),
    ticks: () => readTickLines(paths.ticks),
    tz: options.config.timeZone,
    assets: { css: await Bun.file(ASSETS.css).text(), js: await Bun.file(ASSETS.js).text() },
    log: options.log,
  };
}
