import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { hasParams, leafRoutes, resolveRoute } from "./route-tree.ts";

type Entry = { id: string; path: string; fullPath: string; name: string; parent: string };

/** A routeTree.gen.ts as TanStack Router writes it, cut down to the part that is read. */
function routeTree(entries: Entry[], quote = "'"): string {
  const q = (s: string) => `${quote}${s}${quote}`;
  return `import { Route as rootRouteImport } from './routes/__root'

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
${entries
  .map(
    (e) => `    ${q(e.id)}: {
      id: ${q(e.id)}
      path: ${q(e.path)}
      fullPath: ${q(e.fullPath)}
      preLoaderRoute: typeof ${e.name}RouteImport
      parentRoute: typeof ${e.parent}
    }`,
  )
  .join("\n")}
  }
}
`;
}

const root = "rootRouteImport";

describe("leafRoutes", () => {
  test("lists the web app's own route tree, leaving out its pathless shell", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../apps/web/src/routeTree.gen.ts"),
      "utf8",
    );
    assert.deepEqual(leafRoutes(source).toSorted(), [
      "/",
      "/decks/$deckId",
      "/folders/$folderId",
      "/login",
      "/settings",
      "/setup",
    ]);
  });

  test("lists top-level routes in route-tree order", () => {
    const source = routeTree([
      { id: "/", path: "/", fullPath: "/", name: "Index", parent: root },
      { id: "/setup", path: "/setup", fullPath: "/setup", name: "Setup", parent: root },
      { id: "/login", path: "/login", fullPath: "/login", name: "Login", parent: root },
    ]);
    assert.deepEqual(leafRoutes(source), ["/", "/setup", "/login"]);
  });

  test("leaves out a route that another route names as its parent", () => {
    const source = routeTree([
      { id: "/decks", path: "/decks", fullPath: "/decks", name: "Decks", parent: root },
      { id: "/decks/", path: "/", fullPath: "/decks/", name: "DecksIndex", parent: "DecksRoute" },
      {
        id: "/decks/$deckId",
        path: "/$deckId",
        fullPath: "/decks/$deckId",
        name: "DecksDeckId",
        parent: "DecksRoute",
      },
    ]);
    assert.deepEqual(leafRoutes(source), ["/decks/", "/decks/$deckId"]);
  });

  test("leaves out pathless layouts, even one with no children", () => {
    const source = routeTree([
      { id: "/_authed", path: "", fullPath: "/", name: "Authed", parent: root },
      { id: "/_empty", path: "", fullPath: "/", name: "Empty", parent: root },
      {
        id: "/_authed/decks",
        path: "/decks",
        fullPath: "/decks",
        name: "AuthedDecks",
        parent: "AuthedRoute",
      },
      { id: "/login", path: "/login", fullPath: "/login", name: "Login", parent: root },
    ]);
    assert.deepEqual(leafRoutes(source), ["/decks", "/login"]);
  });

  test("lists a full path once when two leaves share it", () => {
    const source = routeTree([
      { id: "/_a", path: "", fullPath: "/", name: "A", parent: root },
      { id: "/_a/", path: "/", fullPath: "/", name: "AIndex", parent: "ARoute" },
      { id: "/", path: "/", fullPath: "/", name: "Index", parent: root },
    ]);
    assert.deepEqual(leafRoutes(source), ["/"]);
  });

  test("reads double-quoted route trees", () => {
    const source = routeTree(
      [{ id: "/login", path: "/login", fullPath: "/login", name: "Login", parent: root }],
      '"',
    );
    assert.deepEqual(leafRoutes(source), ["/login"]);
  });

  test("fails on a file that isn't a route tree", () => {
    assert.throws(() => leafRoutes("export const x = 1\n"), /FileRoutesByPath/);
    assert.throws(() => leafRoutes(routeTree([])), /no routes/);
  });
});

describe("hasParams", () => {
  test("is true for a path with a $ segment", () => {
    assert.equal(hasParams("/decks/$deckId"), true);
    assert.equal(hasParams("/files/$"), true);
    assert.equal(hasParams("/posts/{-$page}"), true);
  });

  test("is false for a concrete path", () => {
    assert.equal(hasParams("/"), false);
    assert.equal(hasParams("/decks/abc"), false);
  });
});

describe("resolveRoute", () => {
  const manifest = {
    "/login": { mode: "signed-out" },
    "/setup": { mode: "before-setup" },
    "/decks/$deckId": { path: "/decks/deck-1" },
    "/decks/$deckId/edit": {},
    "/": { mask: ["[role=status]"] },
    "/stats/$range": { path: "/stats/week", mode: "signed-out", mask: [".clock", "#random"] },
  } as const;

  test("a route with no entry is shot signed in, at its own path", () => {
    assert.deepEqual(resolveRoute("/about", manifest), {
      route: "/about",
      path: "/about",
      mode: "signed-in",
      mask: [],
    });
  });

  test("the entry's mode applies", () => {
    assert.deepEqual(resolveRoute("/login", manifest), {
      route: "/login",
      path: "/login",
      mode: "signed-out",
      mask: [],
    });
    assert.deepEqual(resolveRoute("/setup", manifest), {
      route: "/setup",
      path: "/setup",
      mode: "before-setup",
      mask: [],
    });
  });

  test("a query string or hash keeps the mode of its route", () => {
    assert.deepEqual(resolveRoute("/login?redirect=/decks", manifest), {
      route: "/login?redirect=/decks",
      path: "/login?redirect=/decks",
      mode: "signed-out",
      mask: [],
    });
  });

  test("a route with params is shot at the entry's path", () => {
    assert.deepEqual(resolveRoute("/decks/$deckId", manifest), {
      route: "/decks/$deckId",
      path: "/decks/deck-1",
      mode: "signed-in",
      mask: [],
    });
    assert.deepEqual(resolveRoute("/decks/$deckId?tab=cards", manifest), {
      route: "/decks/$deckId?tab=cards",
      path: "/decks/deck-1?tab=cards",
      mode: "signed-in",
      mask: [],
    });
  });

  test("the entry's mask comes along, with its path and mode", () => {
    assert.deepEqual(resolveRoute("/", manifest), {
      route: "/",
      path: "/",
      mode: "signed-in",
      mask: ["[role=status]"],
    });
    assert.deepEqual(resolveRoute("/stats/$range?x=1", manifest), {
      route: "/stats/$range?x=1",
      path: "/stats/week?x=1",
      mode: "signed-out",
      mask: [".clock", "#random"],
    });
  });

  test("a route with params and no path in the manifest fails, naming it", () => {
    assert.throws(() => resolveRoute("/cards/$cardId", manifest), /\/cards\/\$cardId/);
    assert.throws(() => resolveRoute("/decks/$deckId/edit", manifest), /\/decks\/\$deckId\/edit/);
  });
});
