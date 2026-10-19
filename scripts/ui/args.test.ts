import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseCommand, UsageError } from "./args.ts";

/** Parses a command line that must be a shoot. */
function parseShoot(argv: string[]) {
  const command = parseCommand(argv);
  assert.equal(command.name, "shoot");
  if (command.name !== "shoot") throw new Error("unreachable");
  return command;
}

describe("parseCommand", () => {
  test("shoot is the default command", () => {
    assert.deepEqual(parseCommand(["/", "/login"]), {
      name: "shoot",
      routes: ["/", "/login"],
      agent: "manual",
      mode: "signed-in",
    });
  });

  test("shoot can be named", () => {
    assert.deepEqual(parseCommand(["shoot", "/decks/abc"]), {
      name: "shoot",
      routes: ["/decks/abc"],
      agent: "manual",
      mode: "signed-in",
    });
  });

  test("--agent sets the shots folder, in either form", () => {
    assert.equal(parseShoot(["shoot", "--agent", "ui-reviewer", "/"]).agent, "ui-reviewer");
    assert.equal(parseShoot(["shoot", "/", "--agent=implementer"]).agent, "implementer");
  });

  test("--signed-out and --before-setup set the mode", () => {
    assert.deepEqual(parseCommand(["shoot", "--signed-out", "/login"]), {
      name: "shoot",
      routes: ["/login"],
      agent: "manual",
      mode: "signed-out",
    });
    assert.deepEqual(parseCommand(["--before-setup", "/setup"]), {
      name: "shoot",
      routes: ["/setup"],
      agent: "manual",
      mode: "before-setup",
    });
  });

  test("routes keep their query string", () => {
    assert.deepEqual(parseShoot(["/login?redirect=/decks"]).routes, ["/login?redirect=/decks"]);
  });

  test("shoot needs at least one route", () => {
    assert.throws(() => parseCommand([]), UsageError);
    assert.throws(() => parseCommand(["shoot"]), UsageError);
    assert.throws(() => parseCommand(["shoot", "--agent", "x"]), UsageError);
  });

  test("a route must start with a slash", () => {
    assert.throws(() => parseCommand(["shoot", "decks"]), /must start with \//);
    assert.throws(() => parseCommand(["login"]), /must start with \//);
  });

  test("routes that would overwrite each other's shots are refused", () => {
    assert.throws(() => parseCommand(["/login", "/login?redirect=/"]), /same file/);
  });

  test("the agent name must be safe as a folder name", () => {
    for (const agent of ["", "..", "../x", "a/b", ".hidden", "a b"]) {
      assert.throws(() => parseCommand(["--agent", agent, "/"]), UsageError, agent);
    }
  });

  test("--signed-out and --before-setup can't be combined", () => {
    assert.throws(() => parseCommand(["--signed-out", "--before-setup", "/"]), UsageError);
  });

  test("up starts signed in, or before Setup", () => {
    assert.deepEqual(parseCommand(["up"]), { name: "up", mode: "signed-in" });
    assert.deepEqual(parseCommand(["up", "--before-setup"]), { name: "up", mode: "before-setup" });
  });

  test("up takes no routes, --agent or --signed-out", () => {
    assert.throws(() => parseCommand(["up", "/"]), UsageError);
    assert.throws(() => parseCommand(["up", "--agent", "x"]), UsageError);
    assert.throws(() => parseCommand(["up", "--signed-out"]), UsageError);
  });

  test("down takes nothing", () => {
    assert.deepEqual(parseCommand(["down"]), { name: "down" });
    assert.throws(() => parseCommand(["down", "/"]), UsageError);
    assert.throws(() => parseCommand(["down", "--before-setup"]), UsageError);
  });

  test("--help wins over everything else", () => {
    assert.deepEqual(parseCommand(["--help"]), { name: "help" });
    assert.deepEqual(parseCommand(["up", "-h"]), { name: "help" });
  });

  test("unknown flags are refused", () => {
    assert.throws(() => parseCommand(["--headed", "/"]), UsageError);
  });
});
