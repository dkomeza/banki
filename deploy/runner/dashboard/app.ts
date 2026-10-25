import { join } from "node:path";
import type { DispatcherConfig } from "../dispatch/config";
import type { SessionDeps } from "../dispatch/session";
import { store } from "../dispatch/store";
import { readTickLines } from "../dispatch/tick-log";
import { keyedViews, sharedView } from "./cache";
import { liveComputer } from "./live";
import { localLog } from "./paths";
import type { ServerDeps } from "./server";
import { readTail } from "./files";
import { issueData, volumePaths } from "./volume";

// The Dashboard put together over a volume shaped like /work and a way to
// Linear and GitHub: main.ts gives it the real ones, through the Broker, and
// fixture.ts stand-ins, for looking at its pages locally.

const ASSETS = {
  css: join(import.meta.dir, "style.css"),
  js: join(import.meta.dir, "live.js"),
};

/** How many issues' page data the Dashboard keeps at once. */
const ISSUES_KEPT = 20;

export async function dashboard(options: {
  work: string;
  session: SessionDeps;
  config: DispatcherConfig;
  now: () => Date;
  log: (line: string) => void;
  /** The clock the 30-second caches go by, in ms: the real one unless a test gives its own. */
  clock?: () => number;
}): Promise<ServerDeps> {
  const clock = options.clock ?? (() => Date.now());
  const paths = volumePaths(options.work);
  const records = store(paths.dispatcher);
  const deps = { ...options.session, records, config: options.config, now: options.now };
  const live = sharedView({
    compute: liveComputer({ ...deps, readLog: (path) => readTail(localLog(paths.logs, path)) }),
    now: clock,
  });
  // Each issue's page data is shared as the live view is: a Linear token
  // for it at most once every 30 seconds, whoever asks and however often.
  const issues = keyedViews({
    compute: (issue: string) => issueData({ ...deps, logs: paths.logs }, issue),
    now: clock,
    max: ISSUES_KEPT,
  });
  return {
    live,
    issue: async (issue) => {
      // What it waits on now, from the live view of the last 30 seconds.
      const [data, view] = await Promise.all([
        issues.get(issue),
        live.get().catch(() => undefined),
      ]);
      const waiting = view?.status.waiting.find((wait) => wait.issue === issue);
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
