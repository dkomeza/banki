import { parseArgs } from "node:util";
import { resolveRoute, RouteError, type Shot } from "./route-tree.ts";
import { type RouteManifest, ROUTES } from "./routes.ts";
import { shotName } from "./shots.ts";

/** How a stack starts: set up and signed in, set up but signed out, or waiting for Setup. */
export type ShootMode = "signed-in" | "signed-out" | "before-setup";
/** `ui up` has no signed-out mode: its signed-in state is a file a browser loads or doesn't. */
export type UpMode = "signed-in" | "before-setup";

export type Command =
  | { name: "shoot"; shots: Shot[]; agent: string }
  | { name: "compare"; body: string | undefined }
  | { name: "up"; mode: UpMode }
  | { name: "down" }
  | { name: "help" };

/** A command line the script can't run; its message says what to change. */
export class UsageError extends Error {
  override name = "UsageError";
}

export const USAGE = `Usage:
  bun run ui [shoot] <route…> [--agent <name>] [--signed-out | --before-setup]
  bun run ui compare [--body <file>]
  bun run ui up [--before-setup]
  bun run ui down

shoot   Start a throwaway copy of Banki, screenshot each route at phone, tablet
        and desktop sizes into .ui/shots/<agent>/, then stop it. The default.
        Each route is shot in its mode from the route manifest
        (scripts/ui/routes.ts), and a route with params, such as
        /decks/$deckId, at its manifest path.
          --agent <name>   the folder under .ui/shots/ (default: manual)
          --signed-out     every route set up and seeded, but not signed in
          --before-setup   every route not set up yet
compare Shoot every route on this branch and on its merge-base with main, and
        write the routes that changed, before and after, to .ui/pr/ with a
        markdown fragment, .ui/pr/evidence.md.
          --body <file>    also put the fragment into this PR body file
up      Start a copy in the background and record it in .ui/stack.json.
          --before-setup   not set up yet; stack.json holds the Setup link
down    Stop the copy from up and delete its data.`;

const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Parses the `ui` script's arguments (after `node main.ts`), resolving the
 * routes to shoot through the route manifest.
 */
export function parseCommand(argv: string[], manifest: RouteManifest = ROUTES): Command {
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
        body: { type: "string" },
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

  if (first !== "compare" && values.body !== undefined) {
    throw new UsageError("--body is for ui compare only.");
  }
  if (first === "compare") {
    if (rest.length > 0) throw new UsageError("ui compare takes no routes: it shoots them all.");
    if (values.agent !== undefined) throw new UsageError("--agent is for ui shoot only.");
    if (signedOut || beforeSetup) {
      throw new UsageError("ui compare takes each route's mode from the route manifest.");
    }
    return { name: "compare", body: values.body };
  }

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
  if (signedOut && beforeSetup) {
    throw new UsageError("Pick one of --signed-out and --before-setup.");
  }
  const override: ShootMode | undefined = beforeSetup
    ? "before-setup"
    : signedOut
      ? "signed-out"
      : undefined;
  const shots = routes.map((route) => {
    try {
      const shot = resolveRoute(route, manifest);
      return override === undefined ? shot : { ...shot, mode: override };
    } catch (error) {
      if (error instanceof RouteError) throw new UsageError(error.message);
      throw error;
    }
  });
  const byName = new Map<string, string>();
  for (const { route, path } of shots) {
    const other = byName.get(shotName(path));
    if (other !== undefined) {
      throw new UsageError(
        `${other} and ${route} would be saved to the same file. Shoot them separately.`,
      );
    }
    byName.set(shotName(path), route);
  }

  const agent = values.agent ?? "manual";
  if (!AGENT_NAME.test(agent)) {
    throw new UsageError(
      `--agent ${JSON.stringify(agent)} isn't a folder name: use letters, digits, ".", "_" and "-".`,
    );
  }
  return { name: "shoot", shots, agent };
}
