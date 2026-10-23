// The tick's decisions (ADR-0012). On each tick the Runner brings its clone
// onto `main` in place, even while a Stage runs there, and checks whether the
// image is behind `main`: the tick script and the Stage tooling run from the
// clone and so are always current, but what is baked into the image changes
// only when a person runs `docker compose … up -d --build`. Pure: clone.ts
// observes, main.ts acts.

/** The git commands, in order, that bring the clone onto origin's `main`. */
export function syncSteps(head: {
  /** The branch HEAD is on, or undefined when it is detached. */
  branch: string | undefined;
  /** Whether HEAD has a commit: a clone's first tick has none. */
  hasCommit: boolean;
}): string[][] {
  const fetch = ["fetch", "--quiet", "origin", "main"];
  if (head.branch === "main" && head.hasCommit) {
    return [fetch, ["reset", "--quiet", "--hard", "origin/main"]];
  }
  // Moves `main` itself and checks it out, so a branch someone left checked
  // out is never reset to `main`.
  return [fetch, ["checkout", "--quiet", "--force", "-B", "main", "origin/main"]];
}

const RUNNER_DIR = "deploy/runner/";
/** What the Dockerfile copies, or builds from, under deploy/runner/; tests aside. */
const IMAGE_FILES = ["Dockerfile", ".dockerignore", "compose.yaml"];
const IMAGE_DIRS = ["broker/", "loop/", "lib/", "bin/"];

/** Whether a change to `path` needs the image rebuilt. The Compose file counts: `up -d --build` applies it too. */
export function isImageInput(path: string): boolean {
  if (!path.startsWith(RUNNER_DIR)) return false;
  const rest = path.slice(RUNNER_DIR.length);
  if (rest.endsWith(".test.ts")) return false;
  return IMAGE_FILES.includes(rest) || IMAGE_DIRS.some((dir) => rest.startsWith(dir));
}

export type ImageCheck = { kind: "current" } | { kind: "stale"; why: string };

export function imageCheck(check: {
  /** The commit the image was built from (BANKI_RUNNER_COMMIT), empty when it wasn't given. */
  built: string;
  /** The `main` the clone has just fetched. */
  main: string;
  /** The paths that differ between `built` and `main`, or undefined when the clone can't tell. */
  changedPaths: string[] | undefined;
}): ImageCheck {
  if (!isCommit(check.built)) {
    return { kind: "stale", why: "it was built without BANKI_RUNNER_COMMIT" };
  }
  if (check.built === check.main) return { kind: "current" };
  const short = check.built.slice(0, 7);
  if (check.changedPaths === undefined) {
    return { kind: "stale", why: `it was built from ${short}, which isn't in the clone of main` };
  }
  const inputs = check.changedPaths.filter(isImageInput);
  if (inputs.length === 0) return { kind: "current" };
  return { kind: "stale", why: `${list(inputs)} changed on main since ${short}` };
}

/** Up to three paths, joined as prose, and how many more there are. */
function list(paths: string[]): string {
  const shown = paths.slice(0, 3);
  const more = paths.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length === 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** A full commit SHA, the only form a commit is passed to git in. */
export const isCommit = (value: string) => /^[0-9a-f]{40}$/.test(value);
