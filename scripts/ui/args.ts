import { parseArgs } from "node:util";
import { shotName } from "./shots.ts";

/** How a stack starts: set up and signed in, set up but signed out, or waiting for Setup. */
export type ShootMode = "signed-in" | "signed-out" | "before-setup";
/** `ui up` has no signed-out mode: its signed-in state is a file a browser loads or doesn't. */
export type UpMode = "signed-in" | "before-setup";

export type Command =
  | { name: "shoot"; routes: string[]; agent: string; mode: ShootMode }
  | { name: "up"; mode: UpMode }
  | { name: "down" }
  | { name: "help" };

/** A command line the script can't run; its message says what to change. */
export class UsageError extends Error {
  override name = "UsageError";
}

export const USAGE = `Usage:
  bun run ui [shoot] <route…> [--agent <name>] [--signed-out | --before-setup]
  bun run ui up [--before-setup]
  bun run ui down

shoot   Start a throwaway copy of Banki, screenshot each route at phone, tablet
        and desktop sizes into .ui/shots/<agent>/, then stop it. The default.
          --agent <name>   the folder under .ui/shots/ (default: manual)
          --signed-out     set up and seeded, but not signed in (for /login)
          --before-setup   not set up yet (for /setup)
up      Start a copy in the background and record it in .ui/stack.json.
          --before-setup   not set up yet; stack.json holds the Setup link
down    Stop the copy from up and delete its data.`;

const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Parses the `ui` script's arguments (after `node main.ts`). */
export function parseCommand(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        agent: { type: "string" },
        "signed-out": { type: "boolean" },
        "before-setup": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help === true) return { name: "help" };

  const [first, ...rest] = positionals;
  const beforeSetup = values["before-setup"] === true;
  const signedOut = values["signed-out"] === true;

  if (first === "up" || first === "down") {
    if (rest.length > 0) throw new UsageError(`ui ${first} takes no routes.`);
    if (values.agent !== undefined) throw new UsageError("--agent is for ui shoot only.");
    if (signedOut) throw new UsageError("--signed-out is for ui shoot only.");
    if (first === "down") {
      if (beforeSetup) throw new UsageError("ui down takes no flags.");
      return { name: "down" };
    }
    return { name: "up", mode: beforeSetup ? "before-setup" : "signed-in" };
  }

  const routes = first === "shoot" ? rest : positionals;
  if (routes.length === 0) {
    throw new UsageError("Give the routes to shoot, such as: bun run ui shoot / /login");
  }
  for (const route of routes) {
    if (!route.startsWith("/")) {
      throw new UsageError(`A route must start with /, such as /${route}`);
    }
  }
  const byName = new Map<string, string>();
  for (const route of routes) {
    const other = byName.get(shotName(route));
    if (other !== undefined) {
      throw new UsageError(
        `${other} and ${route} would be saved to the same file. Shoot them separately.`,
      );
    }
    byName.set(shotName(route), route);
  }

  const agent = values.agent ?? "manual";
  if (!AGENT_NAME.test(agent)) {
    throw new UsageError(
      `--agent ${JSON.stringify(agent)} isn't a folder name: use letters, digits, ".", "_" and "-".`,
    );
  }
  if (signedOut && beforeSetup) {
    throw new UsageError("Pick one of --signed-out and --before-setup.");
  }
  const mode: ShootMode = beforeSetup ? "before-setup" : signedOut ? "signed-out" : "signed-in";
  return { name: "shoot", routes, agent, mode };
}
