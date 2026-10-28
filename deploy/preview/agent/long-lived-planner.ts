import { imageRef, LONG_LIVED_ENVIRONMENTS, type LongLivedEnvironment } from "./naming";
import { isRecord } from "./parse";
import {
  type DeploymentStatus,
  type ImageDigests,
  isWaiting,
  type PlanParts,
  type ServiceState,
} from "./planner";

// The long-lived pool's one decision, beside planner.ts's and
// slug-planner.ts's (ADR-0017): given what Docker says of Edge and
// Production and their newest `edge` and `production` Deployments, which
// actions bring them in line. There is no cap and no eviction here, and
// neither Preview pool ever sees these installations. It is pure, and the
// agent keeps no state of its own: the previous images to roll back to are
// read back from the Deployments, so a restart loses nothing (ADR-0008).

/** An `edge` or `production` Deployment, as main-images (and a Release) create it. */
export type LongLivedDeployment = {
  environment: LongLivedEnvironment;
  id: number;
  /** The commit it deploys: the Deployment's ref. */
  sha: string;
  createdAt: Date;
  /** Its latest status, or undefined when it has none yet. */
  status: DeploymentStatus | undefined;
  description: string | undefined;
  /** Its payload, decoded but not yet checked: see {@link longLivedPayload}. */
  payload: unknown;
};

/** The installation's Compose project, from its containers' labels. */
export type LongLivedProject = {
  sha: string | undefined;
  deployedAt: Date | undefined;
  digests: ImageDigests | undefined;
  api: ServiceState;
  web: ServiceState;
};

/** The installation's data volume: missing, or there, with the Deployment whose first boot made it. */
export type LongLivedVolume =
  | { exists: false }
  | { exists: true; deploymentId: number | undefined };

export type LongLivedInstallation = {
  project: LongLivedProject | undefined;
  volume: LongLivedVolume;
};

export type LongLivedPlanInput = {
  installations: Record<LongLivedEnvironment, LongLivedInstallation>;
  /** Every `edge` and `production` Deployment read, good payloads or not. */
  deployments: LongLivedDeployment[];
  now: Date;
};

/** The images a Deployment deploys, and the commit they were built from. */
export type Release = { deploymentId: number; sha: string; digests: ImageDigests };

/** Every long-lived pool action says so. */
type InLongLivedPool<T> = T & { pool: "long-lived"; environment: LongLivedEnvironment };

export type LongLivedAction = InLongLivedPool<
  /**
   * Deploy the newest Deployment onto the installation, keeping its data:
   * see long-lived-deploy.ts.
   */
  | {
      kind: "deploy";
      sha: string;
      deploymentId: number;
      digests: ImageDigests;
      /**
       * The data volume as it is: `missing` and `own` (left by this same
       * Deployment's interrupted first boot) make a first boot, and `kept` is
       * the installation's data, which is never removed.
       */
      volume: "missing" | "own" | "kept";
      /**
       * A Reset of Edge (see {@link isReset}): the data volume is cleared,
       * then set up and seeded, after its Snapshot. Never on Production.
       */
      reset: boolean;
      /** The newest `success` Deployment's images, to roll back to, if there is one. */
      rollbackTo: Release | undefined;
      /** Images of the installation's own older Deployments, removed after a success. */
      staleImages: string[];
      deployedAt: Date;
    }
  | { kind: "mark-inactive"; deploymentId: number; reason: "superseded" }
  /** Mark a Deployment whose payload isn't `{ sha, api, web }` for its commit a failure. */
  | { kind: "mark-invalid"; deploymentId: number }
>;

type Deploy = Extract<LongLivedAction, { kind: "deploy" }>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * The images a Deployment's payload names, or undefined for any payload but
 * `{ sha, api, web }`: each digest `sha256:` and 64 hex characters, and `sha`
 * the Deployment's own commit. Other fields, such as a reset mark, are
 * ignored.
 */
export function longLivedPayload(
  deployment: Pick<LongLivedDeployment, "sha" | "payload">,
): ImageDigests | undefined {
  const payload = deployment.payload;
  if (!isRecord(payload)) return undefined;
  const { sha, api, web } = payload;
  if (typeof sha !== "string" || sha.toLowerCase() !== deployment.sha.toLowerCase()) {
    return undefined;
  }
  if (typeof api !== "string" || !DIGEST.test(api)) return undefined;
  if (typeof web !== "string" || !DIGEST.test(web)) return undefined;
  return { api, web };
}

/** How a Reset's `in_progress` status starts (long-lived-deploy.ts), which a retry reads back. */
export const RESETTING = "resetting to ";

/** Whether a Deployment carries the reset mark: `reset: true` in its payload, and nothing else. */
const hasResetMark = (deployment: Pick<LongLivedDeployment, "payload">): boolean =>
  isRecord(deployment.payload) && deployment.payload.reset === true;

/**
 * Whether the newest `edge` Deployment deploys as a Reset: it carries the
 * mark, or an older one still waiting with a good payload does, which it
 * supersedes. So a Reset is never lost to a newer push. And one the agent
 * started as a Reset and a restart cut short is retried as one, even once
 * the older one it carried is superseded, so a half-cleared database never
 * goes to an ordinary upgrade. Production is never reset.
 */
function isReset(
  environment: LongLivedEnvironment,
  [newest, ...older]: LongLivedDeployment[],
): boolean {
  if (environment !== "edge" || newest === undefined) return false;
  return (
    hasResetMark(newest) ||
    (newest.status === "in_progress" && newest.description?.startsWith(RESETTING) === true) ||
    older.some(
      (deployment) =>
        hasResetMark(deployment) &&
        isWaiting(deployment) &&
        longLivedPayload(deployment) !== undefined,
    )
  );
}

export function planLongLived(input: LongLivedPlanInput): LongLivedAction[] {
  const { upkeep, deploys } = planLongLivedParts(input);
  return [...upkeep, ...deploys];
}

export function planLongLivedParts(input: LongLivedPlanInput): PlanParts<LongLivedAction> {
  const upkeep: LongLivedAction[] = [];
  const deploys: Deploy[] = [];
  for (const environment of LONG_LIVED_ENVIRONMENTS) {
    const own = newestFirst(input.deployments.filter((d) => d.environment === environment));
    const [newest, ...older] = own;
    if (newest === undefined) continue;

    // A bad payload is never deployed, and marked a failure once.
    for (const deployment of own) {
      if (longLivedPayload(deployment) === undefined && isWaiting(deployment)) {
        upkeep.push({
          pool: "long-lived",
          environment,
          kind: "mark-invalid",
          deploymentId: deployment.id,
        });
      }
    }
    // Only the newest is ever deployed: the older ones still waiting never
    // will be.
    for (const deployment of older) {
      if (longLivedPayload(deployment) !== undefined && isWaiting(deployment)) {
        upkeep.push({
          pool: "long-lived",
          environment,
          kind: "mark-inactive",
          deploymentId: deployment.id,
          reason: "superseded",
        });
      }
    }

    // One that ended, in a success or a failure, leaves nothing to do: the
    // agent never brings back a project someone stopped, and a redeploy is a
    // new Deployment. An `in_progress` one was cut short by a restart, so it
    // is done again.
    const digests = longLivedPayload(newest);
    if (digests === undefined || !isWaiting(newest)) continue;
    const { volume } = input.installations[environment];
    const rollbackTo = newestSuccess(own);
    const keep = new Set([
      ...refsOf(digests),
      ...(rollbackTo === undefined ? [] : refsOf(rollbackTo.digests)),
      ...LONG_LIVED_ENVIRONMENTS.filter((other) => other !== environment).flatMap((other) =>
        inUseBy(other, input),
      ),
    ]);
    deploys.push({
      pool: "long-lived",
      environment,
      kind: "deploy",
      sha: newest.sha,
      deploymentId: newest.id,
      digests,
      volume: !volume.exists ? "missing" : volume.deploymentId === newest.id ? "own" : "kept",
      reset: isReset(environment, own),
      rollbackTo,
      staleImages: [...new Set(own.flatMap((d) => refsOf(longLivedPayload(d))))].filter(
        (ref) => !keep.has(ref),
      ),
      deployedAt: input.now,
    });
  }
  // A loop runs one deploy at most: Edge's first, which Production follows.
  return { upkeep, deploys };
}

/** The environment's newest `success` Deployment with a good payload: what a failed deploy rolls back to. */
function newestSuccess(own: Omit<LongLivedDeployment, "environment">[]): Release | undefined {
  for (const deployment of own) {
    const digests = longLivedPayload(deployment);
    if (deployment.status === "success" && digests !== undefined) {
      return { deploymentId: deployment.id, sha: deployment.sha, digests };
    }
  }
  return undefined;
}

/**
 * The images the other installation may still run: its project's, its
 * newest Deployment's and the one it would roll back to. A Release runs
 * Edge's very images, so Edge's cleanup must never take Production's.
 */
function inUseBy(environment: LongLivedEnvironment, input: LongLivedPlanInput): string[] {
  const own = newestFirst(input.deployments.filter((d) => d.environment === environment));
  return [
    ...refsOf(input.installations[environment].project?.digests),
    ...refsOf(own[0] === undefined ? undefined : longLivedPayload(own[0])),
    ...refsOf(newestSuccess(own)?.digests),
  ];
}

const refsOf = (digests: ImageDigests | undefined): string[] =>
  digests === undefined ? [] : [imageRef("api", digests.api), imageRef("web", digests.web)];

const newestFirst = <T extends { createdAt: Date; id: number }>(deployments: T[]) =>
  deployments.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);

/**
 * Whether the loop, reading one environment's Deployments newest first, has
 * read enough to plan: the newest `success` with a good payload is among
 * those read, so a failed deploy knows what to roll back to, and the page
 * just read holds none still waiting. The agent's full reads catch the rest.
 */
export function readEnoughLongLived(
  read: Omit<LongLivedDeployment, "environment">[],
  lastPage: Omit<LongLivedDeployment, "environment">[],
): boolean {
  return (
    newestSuccess(newestFirst(read)) !== undefined &&
    lastPage.every((deployment) => !isWaiting(deployment))
  );
}
