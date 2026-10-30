import { SEED_IDS } from "../../apps/api/src/seed/seed-ids.ts";

// The route manifest: how the `ui` script shoots each route of the web app's
// route tree, keyed by its full path as apps/web/src/routeTree.gen.ts names it.
// A route with no entry is shot signed in, at its own path.
//
// - `path`: the one concrete path to shoot a route with params (`$…`) at, built
//   from the Seed data's fixed IDs, such as
//   `"/decks/$deckId": { path: \`/decks/${SEED_IDS.deck}\` }`. A route with
//   params needs one: `ui compare` fails without it.
// - `mode`: `signed-out` (set up and seeded, not signed in) or `before-setup`
//   (not set up yet).
// - `mask`: CSS selectors of content that differs on every run, such as a
//   measured latency or random content. Every shot hides it, keeping its
//   place on the page (on both sides of `ui compare`), so it never counts as
//   a change, whatever its size.
//
// An issue that adds a routed screen with params or a sign-in mode adds its
// entry here, with any fixed ID it needs in SEED_IDS, and a screen with
// content that differs on every run masks it here.

export type RouteEntry = {
  path?: string;
  mode?: "signed-out" | "before-setup";
  mask?: readonly string[];
};

export type RouteManifest = Readonly<Record<string, RouteEntry>>;

export const ROUTES: RouteManifest = {
  "/login": { mode: "signed-out" },
  "/setup": { mode: "before-setup" },
  "/decks/$deckId": { path: `/decks/${SEED_IDS.deck}` },
  "/folders/$folderId": { path: `/folders/${SEED_IDS.folder}` },
  "/decks/$deckId/study": { path: `/decks/${SEED_IDS.deck}/study` },
  "/decks/$deckId/settings": { path: `/decks/${SEED_IDS.deck}/settings` },
  "/decks/$deckId/cards/new": { path: `/decks/${SEED_IDS.deck}/cards/new` },
  "/cards/$cardId": { path: `/cards/${SEED_IDS.card}` },
  "/deleted": {},
};
