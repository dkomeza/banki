import { describe, expect, test } from "bun:test";
import {
  imageCheck,
  isImageInput,
  remoteStep,
  staleLocks,
  stuckReport,
  syncSteps,
  toolchainDrift,
} from "./sync";

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

const TOOLCHAIN = { bun: "1.4.3", node: "24.22.1" };
const PINS = { packageManager: "bun@1.4.3", nodeVersion: "24\n" };

const check = (overrides: Partial<Parameters<typeof imageCheck>[0]> = {}) =>
  imageCheck({
    built: BUILT,
    main: MAIN,
    changedPaths: [],
    image: TOOLCHAIN,
    pins: PINS,
    ...overrides,
  });

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

describe("the image's bun and node against main's pins", () => {
  test("match when bun is packageManager's and node is within .node-version", () => {
    for (const nodeVersion of ["24", "24.22", "24.22.1", "v24.22.1\n", " 24 \n"]) {
      expect(toolchainDrift(TOOLCHAIN, { packageManager: "bun@1.4.3", nodeVersion })).toEqual([]);
    }
  });

  test("drift when main moves bun on", () => {
    expect(toolchainDrift(TOOLCHAIN, { ...PINS, packageManager: "bun@1.4.4" })).toEqual([
      "package.json's packageManager wants bun 1.4.4, and the image has 1.4.3",
    ]);
  });

  test("drift when main moves node on", () => {
    for (const nodeVersion of ["26", "24.23", "24.22.2", "2"]) {
      expect(toolchainDrift(TOOLCHAIN, { ...PINS, nodeVersion })).toEqual([
        `.node-version wants node ${nodeVersion}, and the image has 24.22.1`,
      ]);
    }
  });

  test("say nothing of a pin main doesn't have, or that isn't bun's", () => {
    expect(toolchainDrift(TOOLCHAIN, {})).toEqual([]);
    expect(toolchainDrift(TOOLCHAIN, { packageManager: "pnpm@9.0.0", nodeVersion: "" })).toEqual(
      [],
    );
  });

  test("make the image stale, with the reason, even when nothing under deploy/runner/ changed", () => {
    expect(check({ pins: { ...PINS, packageManager: "bun@1.5.0" } })).toEqual({
      kind: "stale",
      why: "package.json's packageManager wants bun 1.5.0, and the image has 1.4.3",
    });
    expect(check({ built: MAIN, main: MAIN, pins: { ...PINS, nodeVersion: "26" } })).toEqual({
      kind: "stale",
      why: ".node-version wants node 26, and the image has 24.22.1",
    });
  });

  test("come after the paths that changed, when both did", () => {
    expect(
      check({
        changedPaths: ["deploy/runner/Dockerfile"],
        pins: { ...PINS, packageManager: "bun@1.5.0" },
      }),
    ).toEqual({
      kind: "stale",
      why: "deploy/runner/Dockerfile changed on main since aaaaaaa; package.json's packageManager wants bun 1.5.0, and the image has 1.4.3",
    });
  });
});

describe("the clone's stale locks", () => {
  const NOW = new Date("2026-10-24T01:00:00.000Z");
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

  test("are the locks in its own git dir older than 10 minutes", () => {
    expect(
      staleLocks(
        [
          { path: "index.lock", modified: ago(11) },
          { path: "HEAD.lock", modified: ago(60) },
          { path: "refs/heads/main.lock", modified: ago(30) },
          { path: "packed-refs.lock", modified: ago(9) },
        ],
        NOW,
      ),
    ).toEqual(["index.lock", "HEAD.lock", "refs/heads/main.lock"]);
  });

  test("never include a worktree's, which a Stage may hold", () => {
    expect(staleLocks([{ path: "worktrees/ban-1-x/index.lock", modified: ago(600) }], NOW)).toEqual(
      [],
    );
  });
});

describe("the clone's origin", () => {
  const URL = "https://github.com/dkomeza/banki.git";

  test("is added when it is missing", () => {
    expect(remoteStep(undefined, URL)).toEqual(["remote", "add", "origin", URL]);
  });

  test("is pointed back at the repo when it points elsewhere", () => {
    expect(remoteStep("https://example.com/x.git", URL)).toEqual([
      "remote",
      "set-url",
      "origin",
      URL,
    ]);
  });

  test("is left alone when it is right", () => {
    expect(remoteStep(URL, URL)).toBeUndefined();
  });
});

describe("a sync that fails", () => {
  const since = new Date("2026-10-24T01:00:00.000Z");

  test("skips the tick, and says so", () => {
    expect(stuckReport({ failures: 1, since }, "git fetch exited 128: no route")).toBe(
      "Couldn't bring the clone onto main, so no tick this time: git fetch exited 128: no route",
    );
  });

  test("says plainly that the clone is stuck once it keeps failing", () => {
    expect(stuckReport({ failures: 3, since }, "git reset exited 128: index.lock exists")).toBe(
      "The clone at /work/banki is stuck: 3 syncs in a row have failed since 2026-10-24T01:00:00.000Z, and no tick runs until one works. The last one: git reset exited 128: index.lock exists",
    );
  });
});
