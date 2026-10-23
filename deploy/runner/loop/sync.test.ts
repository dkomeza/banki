import { describe, expect, test } from "bun:test";
import { imageCheck, isImageInput, syncSteps } from "./sync";

// The tick's decisions (ADR-0012): how the clone is brought onto `main`, and
// whether the image is behind it, which only a person can fix with
// `docker compose … up -d --build`.

const BUILT = "a".repeat(40);
const MAIN = "b".repeat(40);

describe("bringing the clone onto main", () => {
  test("fetches main, then resets the clone to it in place", () => {
    expect(syncSteps({ branch: "main", hasCommit: true })).toEqual([
      ["fetch", "--quiet", "origin", "main"],
      ["reset", "--quiet", "--hard", "origin/main"],
    ]);
  });

  test("moves a clone left on another branch back to main, without resetting that branch", () => {
    expect(syncSteps({ branch: "dkomeza/ban-1-x", hasCommit: true })[1]).toEqual([
      "checkout",
      "--quiet",
      "--force",
      "-B",
      "main",
      "origin/main",
    ]);
    expect(syncSteps({ branch: undefined, hasCommit: true })[1]?.[0]).toBe("checkout");
  });

  test("checks main out for the first time in a clone that has no commit yet", () => {
    expect(syncSteps({ branch: "main", hasCommit: false })[1]?.[0]).toBe("checkout");
  });
});

describe("an image input", () => {
  test("is what the image is built from: the Dockerfile, the Compose file and the baked code", () => {
    for (const path of [
      "deploy/runner/Dockerfile",
      "deploy/runner/.dockerignore",
      "deploy/runner/compose.yaml",
      "deploy/runner/broker/main.ts",
      "deploy/runner/loop/main.ts",
      "deploy/runner/lib/parse.ts",
      "deploy/runner/bin/gh",
    ]) {
      expect(isImageInput(path)).toBe(true);
    }
  });

  test("isn't what runs from the clone, a test, or anything outside deploy/runner/", () => {
    for (const path of [
      "deploy/runner/tick.ts",
      "deploy/runner/cli/stage.ts",
      "deploy/runner/bootstrap",
      "deploy/runner/compose.test.ts",
      "deploy/runner/broker/jwt.test.ts",
      "deploy/runner/bin/bin.test.ts",
      "deploy/runner/tsconfig.json",
      "deploy/preview/agent/Dockerfile",
      "package.json",
      "deploy/runner-notes/Dockerfile",
    ]) {
      expect(isImageInput(path)).toBe(false);
    }
  });
});

const check = (overrides: Partial<Parameters<typeof imageCheck>[0]> = {}) =>
  imageCheck({ built: BUILT, main: MAIN, changedPaths: [], ...overrides });

describe("whether the image is behind main", () => {
  test("an image built from main is current", () => {
    expect(check({ built: MAIN, main: MAIN })).toEqual({ kind: "current" });
  });

  test("a change on main outside the image's inputs leaves it current", () => {
    expect(
      check({ changedPaths: ["deploy/runner/tick.ts", "deploy/runner/cli/stage.ts", "README.md"] }),
    ).toEqual({ kind: "current" });
  });

  test("a change to one of its inputs makes it stale, naming them", () => {
    expect(
      check({ changedPaths: ["deploy/runner/Dockerfile", "deploy/runner/broker/main.ts", "x.md"] }),
    ).toEqual({
      kind: "stale",
      why: "deploy/runner/Dockerfile and deploy/runner/broker/main.ts changed on main since aaaaaaa",
    });
  });

  test("names at most three inputs, and how many more changed", () => {
    const changedPaths = ["a", "b", "c", "d", "e"].map((name) => `deploy/runner/lib/${name}.ts`);

    expect(check({ changedPaths })).toEqual({
      kind: "stale",
      why: "deploy/runner/lib/a.ts, deploy/runner/lib/b.ts, deploy/runner/lib/c.ts and 2 more changed on main since aaaaaaa",
    });
  });

  test("an image built from a commit the clone doesn't have is stale", () => {
    expect(check({ changedPaths: undefined })).toEqual({
      kind: "stale",
      why: "it was built from aaaaaaa, which isn't in the clone of main",
    });
  });

  test("an image built without its commit is stale, since nothing says what it holds", () => {
    for (const built of ["", "not-a-commit", `${BUILT}\n`]) {
      expect(check({ built, changedPaths: undefined })).toEqual({
        kind: "stale",
        why: "it was built without BANKI_RUNNER_COMMIT",
      });
    }
  });
});
