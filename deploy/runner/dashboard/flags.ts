import type { PreviewDeployment } from "../dispatch/github";

// The pull agent's health, inferred (ADR-0015): the Dashboard never reaches
// the pull agent, so it goes by GitHub alone. A `preview` or `slug-preview`
// deployment whose newest status is still `queued`, or which has none, 10
// minutes after it was made is flagged: the pull agent hasn't claimed it.
// Pure, so it is unit-tested.

export const UNCLAIMED_AFTER_MS = 10 * 60_000;

/** The states that say the pull agent hasn't claimed a deployment yet. */
const UNCLAIMED: readonly (string | null)[] = [null, "queued"];

/**
 * How many whole minutes the pull agent has left a deployment unclaimed, or
 * undefined when it isn't flagged: it moved it on, it is under 10 minutes
 * old, or there is no deployment, or no time it was made.
 */
export function unclaimedFor(
  deployment: { state: string | null; createdAt?: string } | null,
  now: Date,
): number | undefined {
  if (deployment === null || deployment.createdAt === undefined) return undefined;
  if (!UNCLAIMED.includes(deployment.state)) return undefined;
  const age = now.getTime() - Date.parse(deployment.createdAt);
  if (!(age >= UNCLAIMED_AFTER_MS)) return undefined;
  return Math.floor(age / 60_000);
}

/** Each Preview's newest deployment, by environment and name, newest first; a tie goes to the higher ID. */
export function newestByName(deployments: readonly PreviewDeployment[]): PreviewDeployment[] {
  const newest = new Map<string, PreviewDeployment>();
  for (const deployment of deployments) {
    const key = `${deployment.environment} ${deployment.name}`;
    const known = newest.get(key);
    if (
      known === undefined ||
      deployment.createdAt > known.createdAt ||
      (deployment.createdAt === known.createdAt && deployment.id > known.id)
    ) {
      newest.set(key, deployment);
    }
  }
  return [...newest.values()].toSorted(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
  );
}

/** The flag's words, on the Now page and in the wait that waits on the deployment. */
export const flagText = (minutes: number) => `the pull agent hasn't claimed it for ${minutes} min`;
