import type { Action } from "./planner";

// Runs a plan's actions in order, one at a time. A failed action is logged
// and the rest go on: the next loop observes again and retries whatever is
// still wrong.

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runActions(
  actions: Action[],
  summary: (action: Action) => string,
  execute: (action: Action) => Promise<void>,
): Promise<void> {
  // The evictions the planner puts right before a deploy make room for it.
  let roomMade = true;
  for (const action of actions) {
    if (action.kind === "deploy" && !roomMade) {
      console.error(`${summary(action)} skipped: an eviction to make room for it failed`);
      break;
    }
    console.log(summary(action));
    try {
      await execute(action);
    } catch (error) {
      console.error(`${summary(action)} failed: ${errorText(error)}`);
      if (action.kind === "remove" && action.reason === "evicted") roomMade = false;
    }
    // A deploy takes a while, and what it was planned from may have moved on.
    if (action.kind === "deploy") break;
  }
}
