import { closedNow, type StatusDeps, statusView } from "../dispatch/dispatcher";
import { PREVIEW_ENVIRONMENTS } from "../dispatch/github";
import { ledger } from "../dispatch/ledger";
import type { ActiveRecord } from "../dispatch/lifecycle";
import { redactTokens } from "../dispatch/secrets";
import { logFacts } from "../dispatch/stage-log";
import type { StatusView } from "../dispatch/status";
import { errorText } from "../lib/config";
import { newestByName, unclaimedFor } from "./flags";

// One computation of the Now page's live view (ADR-0014): `runner status`'s
// view, with its one Linear token revoked at its end; the Previews'
// deployments the pull agent hasn't claimed, from GitHub; and the dollars
// each Stage running or paused has cost so far, from its logs. When Linear
// or GitHub can't be read, the view is what the volume holds alone, and says
// why. cache.ts shares it between viewers.

/** A Preview's deployment the pull agent hasn't claimed for `minutes`. */
export type Flag = {
  environment: string;
  name: string;
  state: string | null;
  minutes: number;
  createdAt: string;
};

export type LiveView = {
  at: string;
  status: StatusView;
  /** Why Linear or GitHub couldn't be read: then `status` is the volume's alone. */
  error?: string;
  flags: Flag[];
  flagsError?: string;
  /** Dollars so far, by issue, of each Stage running or paused. */
  spent: Record<string, number>;
  /** The Ceiling the gate's reading is held against. */
  ceiling: number;
};

export type LiveDeps = StatusDeps & {
  /** A Stage log's last lines, within a bound, by the path its record holds; none when it can't be read. */
  readLog: (path: string) => string[];
};

/** A Stage's dollars so far: its ended runs' own, and its current run's from its log. */
export function spentSoFar(record: ActiveRecord, readLog: (path: string) => string[]): number {
  return record.runs.reduce(
    (sum, run) =>
      sum + (run.endedAt === undefined ? logFacts(readLog(run.log)).costUsd : (run.costUsd ?? 0)),
    0,
  );
}

/** What the volume holds alone, for when Linear or GitHub can't be read. */
function volumeView(deps: StatusDeps, now: Date): StatusView {
  const active = deps.records.activeRecords();
  const stages = deps.records.stageRecords();
  const { costs, estimates } = ledger(stages, active);
  return {
    now,
    closed: closedNow(deps.config, now),
    running: active.filter((record) => record.state === "running"),
    paused: active.filter((record) => record.state === "paused"),
    queue: [],
    waiting: [],
    gate: deps.records.gate(),
    estimates,
    recent: stages
      .map((record, i) => ({ record, cost: costs[i] }))
      .slice(-10)
      .toReversed(),
    orphans: [],
  };
}

/**
 * The live view's computation, for cache.ts to share. It remembers the
 * deployments the pull agent has claimed, which never go back to unclaimed,
 * so it asks GitHub only about the others again.
 */
export function liveComputer(deps: LiveDeps): () => Promise<LiveView> {
  const claimed = new Set<number>();

  async function flags(now: Date): Promise<Flag[]> {
    const github = deps.github(() => deps.broker.githubToken());
    const listed = (
      await Promise.all(PREVIEW_ENVIRONMENTS.map((env) => github.recentDeployments(env)))
    ).flat();
    const found: Flag[] = [];
    for (const deployment of newestByName(listed)) {
      if (claimed.has(deployment.id)) continue;
      const { state } = await github.newestStatus(deployment.id);
      const minutes = unclaimedFor({ state, createdAt: deployment.createdAt }, now);
      if (minutes !== undefined) {
        found.push({
          environment: deployment.environment,
          name: deployment.name,
          state,
          minutes,
          createdAt: deployment.createdAt,
        });
      } else if (state !== null && state !== "queued") {
        claimed.add(deployment.id);
      }
    }
    return found;
  }

  return async () => {
    const now = deps.now();
    const spent = Object.fromEntries(
      deps.records
        .activeRecords()
        .map((record) => [record.issue, spentSoFar(record, deps.readLog)]),
    );
    const view: LiveView = {
      at: now.toISOString(),
      status: volumeView(deps, now),
      flags: [],
      spent,
      ceiling: deps.config.ceiling,
    };
    const [status, found] = await Promise.allSettled([statusView(deps), flags(now)]);
    if (status.status === "fulfilled") view.status = status.value;
    else view.error = redactTokens(errorText(status.reason));
    if (found.status === "fulfilled") view.flags = found.value;
    else view.flagsError = redactTokens(errorText(found.reason));
    return view;
  };
}
