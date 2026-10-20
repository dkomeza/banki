import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { leafRoutes, resolveRoute } from "./route-tree.ts";
import { ROUTES } from "./routes.ts";

describe("ROUTES", () => {
  test("shoots /login signed out and /setup before Setup", () => {
    assert.equal(ROUTES["/login"]?.mode, "signed-out");
    assert.equal(ROUTES["/setup"]?.mode, "before-setup");
  });

  test("masks the home screen's measured latency, which differs on every run", () => {
    assert.deepEqual(ROUTES["/"]?.mask, ["[role=status]"]);
  });

  test("can shoot every route of the web app's route tree", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../apps/web/src/routeTree.gen.ts"),
      "utf8",
    );
    for (const route of leafRoutes(source)) assert.doesNotThrow(() => resolveRoute(route, ROUTES));
  });
});
