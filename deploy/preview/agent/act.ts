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
  // A deploy names the PRs whose removal or teardown the cap counts on (the
  // planner's arithmetic). Should one of those fail, the deploy would go over
  // the cap, so it waits for the next loop. Any other failure leaves room
  // enough, so a stuck cleanup can't hold every deploy back.
  const failed = new Set<number>();
  for (const action of actions) {
    const missing = action.kind === "deploy" ? action.needs.filter((pr) => failed.has(pr)) : [];
    if (missing.length > 0) {
      console.error(
        `${summary(action)} skipped: it counted on the Preview of PR ${missing.join(", ")} being gone`,
      );
      break;
    }
    console.log(summary(action));
    try {
      await execute(action);
    } catch (error) {
      console.error(`${summary(action)} failed: ${errorText(error)}`);
      if (action.kind === "remove" || action.kind === "teardown") failed.add(action.project.pr);
    }
    // A deploy takes a while, and what it was planned from may have moved on.
    if (action.kind === "deploy") break;
  }
}
