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

/** The bun and node versions the image has. */
export type Toolchain = { bun: string; node: string };
/** What `main` pins them to: package.json's `packageManager` and `.node-version`, as they are. */
export type Pins = { packageManager?: string; nodeVersion?: string };

export function imageCheck(check: {
  /** The commit the image was built from (BANKI_RUNNER_COMMIT), empty when it wasn't given. */
  built: string;
  /** The `main` the clone has just fetched. */
  main: string;
  /** The paths that differ between `built` and `main`, or undefined when the clone can't tell. */
  changedPaths: string[] | undefined;
  image: Toolchain;
  pins: Pins;
}): ImageCheck {
  const reasons: string[] = [];
  if (!isCommit(check.built)) {
    reasons.push("it was built without BANKI_RUNNER_COMMIT");
  } else if (check.built !== check.main) {
    const short = check.built.slice(0, 7);
    if (check.changedPaths === undefined) {
      reasons.push(`it was built from ${short}, which isn't in the clone of main`);
    } else {
      const inputs = check.changedPaths.filter(isImageInput);
      if (inputs.length > 0) reasons.push(`${list(inputs)} changed on main since ${short}`);
    }
  }
  reasons.push(...toolchainDrift(check.image, check.pins));
  return reasons.length === 0 ? { kind: "current" } : { kind: "stale", why: reasons.join("; ") };
}

/**
 * How the image's bun and node differ from what `main` pins: bun exactly as
 * `packageManager` names it, node within `.node-version` (24 takes any
 * 24.x.y). A pin `main` doesn't have, or that isn't bun's, says nothing.
 */
export function toolchainDrift(image: Toolchain, pins: Pins): string[] {
  const drift: string[] = [];
  const bun = /^bun@(.+)$/.exec(pins.packageManager?.trim() ?? "")?.[1];
  if (bun !== undefined && bun !== image.bun) {
    drift.push(`package.json's packageManager wants bun ${bun}, and the image has ${image.bun}`);
  }
  const node = pins.nodeVersion?.trim().replace(/^v/, "") ?? "";
  if (node !== "") {
    const have = image.node.split(".");
    if (!node.split(".").every((part, i) => part === have[i])) {
      drift.push(`.node-version wants node ${node}, and the image has ${image.node}`);
    }
  }
  return drift;
}

/** A lock git left in the clone's own git dir: its path there, and when it was last written. */
export type Lock = { path: string; modified: Date };

/** How old a lock must be before it counts as left by a git that died. */
export const STALE_LOCK_MS = 10 * 60_000;

/**
 * The locks a git killed mid-write left behind, which would fail every sync
 * from then on: older than 10 minutes, and never a worktree's, which a Stage
 * working there may hold.
 */
export function staleLocks(locks: readonly Lock[], now: Date): string[] {
  return locks
    .filter((lock) => !lock.path.startsWith("worktrees/"))
    .filter((lock) => now.getTime() - lock.modified.getTime() > STALE_LOCK_MS)
    .map((lock) => lock.path);
}

/** The git command that makes `origin` the repo, or undefined when it is already. */
export function remoteStep(current: string | undefined, url: string): string[] | undefined {
  if (current === undefined) return ["remote", "add", "origin", url];
  if (current !== url) return ["remote", "set-url", "origin", url];
  return undefined;
}

/** Syncs that failed in a row, since the first. */
export type Stuck = { failures: number; since: Date };

/** After this many failed syncs in a row, the clone is called stuck. */
const STUCK_AFTER = 3;

/** What the log says when a sync fails. The tick never runs on a clone that didn't sync. */
export function stuckReport(stuck: Stuck, error: string): string {
  if (stuck.failures < STUCK_AFTER) {
    return `Couldn't bring the clone onto main, so no tick this time: ${error}`;
  }
  return `The clone at /work/banki is stuck: ${stuck.failures} syncs in a row have failed since ${stuck.since.toISOString()}, and no tick runs until one works. The last one: ${error}`;
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
