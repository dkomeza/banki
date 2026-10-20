import { type Action, isRunning } from "./planner";

// Runs a plan's actions in order, one at a time. A failed action is logged
// and the rest go on: the next loop observes again and retries whatever is
// still wrong.

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runActions(
  actions: Action[],
  summary: (action: Action) => string,
  execute: (action: Action) => Promise<void>,
): Promise<void> {
  // The planner counts a running Preview being removed or torn down as gone
  // already: a closed PR's, an idle one's, an evicted one's. Should one of
  // those fail, the deploy would go over the cap, so it waits for the next
  // loop. A failure on one that wasn't running never counted, so a stuck
  // leftover can't hold every deploy back.
  let roomMade = true;
  for (const action of actions) {
    if (action.kind === "deploy" && !roomMade) {
      console.error(`${summary(action)} skipped: a Preview it counted as gone is still there`);
      break;
    }
    console.log(summary(action));
    try {
      await execute(action);
    } catch (error) {
      console.error(`${summary(action)} failed: ${errorText(error)}`);
      if ((action.kind === "remove" || action.kind === "teardown") && isRunning(action.project)) {
        roomMade = false;
      }
    }
    // A deploy takes a while, and what it was planned from may have moved on.
    if (action.kind === "deploy") break;
  }
}
