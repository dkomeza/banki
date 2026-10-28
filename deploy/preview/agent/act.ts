import { ConfigError } from "./config";
import type { LongLivedAction } from "./long-lived-planner";
import { keyOf, type PreviewKey } from "./naming";
import type { Action, PlanParts } from "./planner";
import type { SlugAction } from "./slug-planner";

// Runs the three pools' plans in order, one action at a time. A failed action is
// logged and the rest go on: the next loop observes again and retries
// whatever is still wrong.

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * An action of any pool: a PR Preview's (planner.ts), a Slug Preview's
 * (slug-planner.ts) or a Long-lived installation's (long-lived-planner.ts).
 */
export type AnyAction = Action | SlugAction | LongLivedAction;

export type Pool = "pr" | "slug";

/** A pool that plans nothing this loop. */
export const NO_PLAN: PlanParts<never> = { upkeep: [], deploys: [] };

/**
 * One pool's observations, or undefined when reading them failed: that is
 * logged, and only that pool sits this loop out, untouched, while the other
 * plans and acts as usual. A broken setting still stops the agent.
 */
export async function orSkip<T>(pool: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    console.error(
      `${pool}: couldn't observe them, so they wait for the next loop: ${errorText(error)}`,
    );
    return undefined;
  }
}

/**
 * The pools' plans as one: every upkeep first, then a Long-lived
 * installation's deploy, which always goes first (ADR-0017), then the
 * deploys of the Preview pool whose `turn` it is, then the other's. The loop
 * runs at most one deploy, so when both Preview pools have one waiting, and
 * no Long-lived one goes first, the turn passes to the other pool for the
 * next loop, and a pool with a steady stream of deploys can't starve the
 * other's. Otherwise the turn stays put.
 */
export function orderPlans(
  pr: PlanParts<Action>,
  slug: PlanParts<SlugAction>,
  turn: Pool,
  longLived: PlanParts<LongLivedAction> = NO_PLAN,
): { actions: AnyAction[]; turn: Pool } {
  const deploys: AnyAction[] =
    turn === "pr" ? [...pr.deploys, ...slug.deploys] : [...slug.deploys, ...pr.deploys];
  const both = longLived.deploys.length === 0 && pr.deploys.length > 0 && slug.deploys.length > 0;
  return {
    actions: [...longLived.upkeep, ...pr.upkeep, ...slug.upkeep, ...longLived.deploys, ...deploys],
    turn: both ? (turn === "pr" ? "slug" : "pr") : turn,
  };
}

/** The Preview whose room a removal or teardown frees, if it is one. */
function freedBy(action: AnyAction): PreviewKey | undefined {
  if (action.kind === "teardown") return keyOf(action.project);
  if (action.kind === "remove") return keyOf(action);
  return undefined;
}

export async function runActions<A extends AnyAction>(
  actions: A[],
  summary: (action: A) => string,
  execute: (action: A) => Promise<void>,
): Promise<void> {
  // A deploy names the Previews of its own pool whose removal or teardown the
  // cap counts on (the planners' arithmetic): PR numbers or Slugs, which
  // never collide. Should one of those fail, the deploy would go over the
  // cap, so it waits for the next loop. Any other failure leaves room enough,
  // so a stuck cleanup can't hold every deploy back.
  const failed = new Set<PreviewKey>();
  for (const action of actions) {
    // A Long-lived installation's deploy counts on no Preview: it has no cap.
    const needs: PreviewKey[] = action.kind === "deploy" && "needs" in action ? action.needs : [];
    const missing = needs.filter((key) => failed.has(key));
    if (missing.length > 0) {
      const whose = typeof missing[0] === "number" ? "PR" : "Slug";
      console.error(
        `${summary(action)} skipped: it counted on the Preview of ${whose} ${missing.join(", ")} being gone`,
      );
      break;
    }
    console.log(summary(action));
    try {
      await execute(action);
    } catch (error) {
      console.error(`${summary(action)} failed: ${errorText(error)}`);
      const freed = freedBy(action);
      if (freed !== undefined) failed.add(freed);
    }
    // A deploy takes a while, and what it was planned from may have moved on.
    if (action.kind === "deploy") break;
  }
}
