import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseCommand, UsageError } from "./args.ts";
import type { RouteManifest } from "./routes.ts";

const manifest: RouteManifest = {
  "/login": { mode: "signed-out" },
  "/setup": { mode: "before-setup" },
  "/decks/$deckId": { path: "/decks/deck-1" },
  "/stats": { mask: [".latency"] },
};

const parse = (argv: string[]) => parseCommand(argv, manifest);

/** Parses a command line that must be a shoot. */
function parseShoot(argv: string[]) {
  const command = parse(argv);
  assert.equal(command.name, "shoot");
  if (command.name !== "shoot") throw new Error("unreachable");
  return command;
}

const signedIn = (route: string, path = route) => ({ route, path, mode: "signed-in", mask: [] });

describe("parseCommand", () => {
  test("shoot is the default command", () => {
    assert.deepEqual(parse(["/", "/decks/abc"]), {
      name: "shoot",
      shots: [signedIn("/"), signedIn("/decks/abc")],
      agent: "manual",
    });
  });

  test("shoot can be named", () => {
    assert.deepEqual(parse(["shoot", "/decks/abc"]), {
      name: "shoot",
      shots: [signedIn("/decks/abc")],
      agent: "manual",
    });
  });

  test("--agent sets the shots folder, in either form", () => {
    assert.equal(parseShoot(["shoot", "--agent", "ui-reviewer", "/"]).agent, "ui-reviewer");
    assert.equal(parseShoot(["shoot", "/", "--agent=implementer"]).agent, "implementer");
  });

  test("with no mode flag, each route is shot in its manifest mode", () => {
    assert.deepEqual(parseShoot(["shoot", "/", "/login", "/setup"]).shots, [
      signedIn("/"),
      { route: "/login", path: "/login", mode: "signed-out", mask: [] },
      { route: "/setup", path: "/setup", mode: "before-setup", mask: [] },
    ]);
  });

  test("--signed-out and --before-setup apply to every route", () => {
    assert.deepEqual(parseShoot(["shoot", "--signed-out", "/login", "/"]).shots, [
      { route: "/login", path: "/login", mode: "signed-out", mask: [] },
      { route: "/", path: "/", mode: "signed-out", mask: [] },
    ]);
    assert.deepEqual(parseShoot(["--before-setup", "/setup", "/login"]).shots, [
      { route: "/setup", path: "/setup", mode: "before-setup", mask: [] },
      { route: "/login", path: "/login", mode: "before-setup", mask: [] },
    ]);
  });

  test("a route's manifest mask comes along, also under a mode flag", () => {
    assert.deepEqual(parseShoot(["--signed-out", "/stats"]).shots, [
      { route: "/stats", path: "/stats", mode: "signed-out", mask: [".latency"] },
    ]);
  });

  test("a param pattern expands through the manifest", () => {
    assert.deepEqual(parseShoot(["/decks/$deckId"]).shots, [
      signedIn("/decks/$deckId", "/decks/deck-1"),
    ]);
    assert.deepEqual(parseShoot(["--signed-out", "/decks/$deckId"]).shots, [
      { route: "/decks/$deckId", path: "/decks/deck-1", mode: "signed-out", mask: [] },
    ]);
  });

  test("a param pattern with no manifest entry is a usage error naming it", () => {
    assert.throws(
      () => parse(["/", "/cards/$cardId"]),
      (error) => error instanceof UsageError && error.message.includes("/cards/$cardId"),
    );
  });

  test("routes keep their query string, and their manifest mode", () => {
    assert.deepEqual(parseShoot(["/login?redirect=/decks"]).shots, [
      {
        route: "/login?redirect=/decks",
        path: "/login?redirect=/decks",
        mode: "signed-out",
        mask: [],
      },
    ]);
  });

  test("shoot needs at least one route", () => {
    assert.throws(() => parse([]), UsageError);
    assert.throws(() => parse(["shoot"]), UsageError);
    assert.throws(() => parse(["shoot", "--agent", "x"]), UsageError);
  });

  test("a route must start with a slash", () => {
    assert.throws(() => parse(["shoot", "decks"]), /must start with \//);
    assert.throws(() => parse(["login"]), /must start with \//);
  });

  test("routes that would overwrite each other's shots are refused", () => {
    assert.throws(() => parse(["/login", "/login?redirect=/"]), /same file/);
    assert.throws(() => parse(["/decks/$deckId", "/decks/deck-1"]), /same file/);
  });

  test("the agent name must be safe as a folder name", () => {
    for (const agent of ["", "..", "../x", "a/b", ".hidden", "a b"]) {
      assert.throws(() => parse(["--agent", agent, "/"]), UsageError, agent);
    }
  });

  test("--signed-out and --before-setup can't be combined", () => {
    assert.throws(() => parse(["--signed-out", "--before-setup", "/"]), UsageError);
  });

  test("up starts signed in, or before Setup", () => {
    assert.deepEqual(parse(["up"]), { name: "up", mode: "signed-in" });
    assert.deepEqual(parse(["up", "--before-setup"]), { name: "up", mode: "before-setup" });
  });

  test("up takes no routes, --agent, --signed-out or --body", () => {
    assert.throws(() => parse(["up", "/"]), UsageError);
    assert.throws(() => parse(["up", "--agent", "x"]), UsageError);
    assert.throws(() => parse(["up", "--signed-out"]), UsageError);
    assert.throws(() => parse(["up", "--body", "b.md"]), UsageError);
  });

  test("down takes nothing", () => {
    assert.deepEqual(parse(["down"]), { name: "down" });
    assert.throws(() => parse(["down", "/"]), UsageError);
    assert.throws(() => parse(["down", "--before-setup"]), UsageError);
    assert.throws(() => parse(["down", "--body", "b.md"]), UsageError);
  });

  test("compare takes an optional --body file", () => {
    assert.deepEqual(parse(["compare"]), { name: "compare", body: undefined });
    assert.deepEqual(parse(["compare", "--body", "pr.md"]), { name: "compare", body: "pr.md" });
  });

  test("compare takes no routes, --agent or mode flags", () => {
    assert.throws(() => parse(["compare", "/"]), UsageError);
    assert.throws(() => parse(["compare", "--agent", "x"]), UsageError);
    assert.throws(() => parse(["compare", "--signed-out"]), UsageError);
    assert.throws(() => parse(["compare", "--before-setup"]), UsageError);
  });

  test("--body is for compare only", () => {
    assert.throws(() => parse(["shoot", "/", "--body", "pr.md"]), /--body/);
  });

  test("--help wins over everything else", () => {
    assert.deepEqual(parse(["--help"]), { name: "help" });
    assert.deepEqual(parse(["up", "-h"]), { name: "help" });
  });

  test("unknown flags are refused", () => {
    assert.throws(() => parse(["--headed", "/"]), UsageError);
  });
});
