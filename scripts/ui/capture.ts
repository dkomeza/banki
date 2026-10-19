import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";
import type { ShootMode } from "./args.ts";
import { shootRoutes } from "./browser.ts";
import type { Shot } from "./route-tree.ts";
import { type Theme, themes as themesOf } from "./shots.ts";
import { Stack } from "./stack.ts";

// Shooting a list of routes, each in its own mode, from stacks of one root:
// what `ui shoot` does in this worktree, and `ui compare` on each side.

/** The themes to shoot, from `root`'s apps/web/package.json. */
export function readThemes(root: string): Theme[] {
  return themesOf(JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8")));
}

/** Starts a stack of `root` in `mode`, runs `body` on it, and tears it down, also when it fails. */
async function withStack<T>(
  root: string,
  mode: ShootMode,
  signal: AbortSignal,
  body: (stack: Stack) => Promise<T>,
): Promise<T> {
  const stack = new Stack(root);
  try {
    signal.throwIfAborted();
    await stack.start({ mode, watch: false, signal });
    return await body(stack);
  } finally {
    console.log("Stopping the stack");
    await stack.teardown();
  }
}

/**
 * Shoots each route at its path in its mode, into `outDir`, and returns the
 * files written. Signed-in and signed-out routes share one stack, set up and
 * seeded, and the signed-out ones are shot without its signed-in state. A
 * stack before Setup starts only when a route needs one, after the first is
 * torn down.
 */
export async function shootSide({
  browser,
  root,
  shots,
  themes,
  outDir,
  signal,
}: {
  browser: Browser;
  root: string;
  shots: readonly Shot[];
  themes: Theme[];
  outDir: string;
  signal: AbortSignal;
}): Promise<string[]> {
  const paths = (mode: ShootMode) =>
    shots.filter((shot) => shot.mode === mode).map((shot) => shot.path);
  const signedIn = paths("signed-in");
  const signedOut = paths("signed-out");
  const beforeSetup = paths("before-setup");
  const files: string[] = [];

  if (signedIn.length + signedOut.length > 0) {
    const mode = signedIn.length > 0 ? "signed-in" : "signed-out";
    await withStack(root, mode, signal, async (stack) => {
      const common = { browser, url: stack.url, themes, outDir };
      if (signedIn.length > 0) {
        files.push(
          ...(await shootRoutes({
            ...common,
            routes: signedIn,
            storageState: stack.signedInState,
          })),
        );
      }
      if (signedOut.length > 0) {
        files.push(
          ...(await shootRoutes({ ...common, routes: signedOut, storageState: undefined })),
        );
      }
    });
  }
  if (beforeSetup.length > 0) {
    await withStack(root, "before-setup", signal, async (stack) => {
      files.push(
        ...(await shootRoutes({
          browser,
          url: stack.url,
          routes: beforeSetup,
          themes,
          storageState: undefined,
          outDir,
        })),
      );
    });
  }
  return files;
}
