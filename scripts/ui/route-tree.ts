import type { ShootMode } from "./args.ts";
import type { RouteManifest } from "./routes.ts";

// Which routes the web app has, read from the route tree TanStack Router
// generates (apps/web/src/routeTree.gen.ts), and where and how the `ui` script
// shoots each one, from the route manifest (routes.ts).

/** A route the manifest can't shoot: it has params and no `path` entry. */
export class RouteError extends Error {
  override name = "RouteError";
}

type TreeEntry = { id: string; fullPath: string; name: string; parent: string };

const field = (body: string, key: string) =>
  new RegExp(`\\b${key}:\\s*['"]([^'"]*)['"]`).exec(body)?.[1];
const typeField = (body: string, key: string) =>
  new RegExp(`\\b${key}:\\s*typeof\\s+(\\w+)`).exec(body)?.[1];

/** The entries of the route tree's `FileRoutesByPath` interface, in its order. */
function treeEntries(source: string): TreeEntry[] {
  const start = source.indexOf("interface FileRoutesByPath {");
  if (start === -1) throw new Error("The route tree has no FileRoutesByPath interface.");
  const entries: TreeEntry[] = [];
  // Each entry is `'<id>': { id, path, fullPath, preLoaderRoute, parentRoute }`,
  // with no braces inside.
  for (const match of source.slice(start).matchAll(/['"][^'"]*['"]:\s*\{([^{}]*)\}/g)) {
    const body = match[1] ?? "";
    const id = field(body, "id");
    const fullPath = field(body, "fullPath");
    const preLoader = typeField(body, "preLoaderRoute");
    const parent = typeField(body, "parentRoute");
    if (id === undefined || fullPath === undefined || preLoader === undefined) continue;
    if (parent === undefined) continue;
    // A route's own type is `<Name>RouteImport`; its children name it `<Name>Route`.
    entries.push({ id, fullPath, name: preLoader.replace(/Import$/, ""), parent });
  }
  return entries;
}

/**
 * The leaf routes' full paths, in route-tree order: the routes no other route
 * names as its parent, leaving out pathless layouts (an id whose last segment
 * starts with `_`, such as `/_authed`). A full path two leaves share is listed
 * once.
 */
export function leafRoutes(routeTreeSource: string): string[] {
  const entries = treeEntries(routeTreeSource);
  if (entries.length === 0) throw new Error("The route tree has no routes.");
  const parents = new Set(entries.map((entry) => entry.parent));
  const leaves = entries.filter((entry) => {
    const last = entry.id.split("/").at(-1) ?? "";
    return !parents.has(entry.name) && !last.startsWith("_");
  });
  return [...new Set(leaves.map((entry) => entry.fullPath))];
}

/** Whether a route's path has params, such as `/decks/$deckId`. */
export const hasParams = (path: string) => path.split("/").some((segment) => segment.includes("$"));

/** A route and where and how to shoot it. */
export type Shot = {
  /** The route as given: a full path from the route tree, maybe with a query string. */
  route: string;
  /** The concrete path to open. */
  path: string;
  mode: ShootMode;
};

/**
 * Where and how the manifest shoots `route` (a full path from the route tree,
 * or a concrete path, maybe with a query string or hash): at the entry's
 * `path` when it has params, in the entry's mode (signed in by default).
 * Throws a RouteError naming a route with params that has no `path` entry.
 */
export function resolveRoute(route: string, manifest: RouteManifest): Shot {
  const cut = route.search(/[?#]/);
  const pathPart = cut === -1 ? route : route.slice(0, cut);
  const suffix = cut === -1 ? "" : route.slice(cut);
  const entry = Object.hasOwn(manifest, pathPart) ? manifest[pathPart] : undefined;
  let path = route;
  if (hasParams(pathPart)) {
    if (entry?.path === undefined) {
      throw new RouteError(
        `${pathPart} has params but no path in the route manifest (scripts/ui/routes.ts). Add one, such as "${pathPart}": { path: \`…\${SEED_IDS.…}\` }.`,
      );
    }
    path = entry.path + suffix;
  }
  return { route, path, mode: entry?.mode ?? "signed-in" };
}
