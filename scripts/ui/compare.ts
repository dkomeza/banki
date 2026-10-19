import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Browser } from "playwright";
import { mergeBase, withBaseWorktree } from "./base.ts";
import { launchChromium } from "./browser.ts";
import { readThemes, shootSide } from "./capture.ts";
import { differingFraction } from "./diff.ts";
import {
  attachments,
  classify,
  comparedEvidence,
  type Evidence,
  fallbackEvidence,
  PR_DIR,
  renderFragment,
  spliceBody,
} from "./evidence.ts";
import { leafRoutes, resolveRoute, RouteError, type Shot } from "./route-tree.ts";
import { ROUTES } from "./routes.ts";
import { shotFileName, type Theme, VIEWPORTS } from "./shots.ts";
import { ROOT, UI_DIR, UiError } from "./stack.ts";

// `ui compare`: shoots every route on the branch (this worktree as it is,
// uncommitted changes included) and on its merge-base with main, keeps the
// routes a pixel diff finds changed, and writes their before and after shots
// and a markdown fragment showing them to .ui/pr/, for a PR body. The branch's
// route manifest and themes apply to both sides. The base side runs first,
// then the branch side, never both at once.

const OUT_DIR = join(ROOT, PR_DIR);
const FRAGMENT = join(OUT_DIR, "evidence.md");
/** Every shot of each side, before the ones shown are copied to .ui/pr/. */
const SHOTS_DIR = join(UI_DIR, "compare");
const SIDE_DIR = { before: join(SHOTS_DIR, "before"), after: join(SHOTS_DIR, "after") };

const show = (path: string) => relative(process.cwd(), path) || ".";

/** The leaf routes of `root`'s route tree. */
function routesOf(root: string): string[] {
  const file = join(root, "apps/web/src/routeTree.gen.ts");
  try {
    return leafRoutes(readFileSync(file, "utf8"));
  } catch (error) {
    throw new UiError(
      `Couldn't read the routes of ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type BaseSide = { ok: true; routes: string[] } | { ok: false; base: string; reason: string };

/** Shoots the routes the base shares with the branch; a failure anywhere is returned, not thrown. */
async function shootBase({
  browser,
  shots,
  themes,
  signal,
}: {
  browser: Browser;
  shots: Shot[];
  themes: Theme[];
  signal: AbortSignal;
}): Promise<BaseSide> {
  let base = "origin/main";
  try {
    const sha = await mergeBase(signal);
    base = sha.slice(0, 12);
    return await withBaseWorktree(sha, signal, async (root) => {
      const routes = routesOf(root);
      const onBase = new Set(routes);
      console.log(`Shooting the base ${base}`);
      await shootSide({
        browser,
        root,
        shots: shots.filter((shot) => onBase.has(shot.route)),
        themes,
        outDir: SIDE_DIR.before,
        signal,
      });
      return { ok: true, routes };
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`The base ${base} couldn't start, so there are no before shots:\n${reason}`);
    return { ok: false, base, reason };
  }
}

/** For each route on both sides, the fraction of differing pixels of each of its pairs. */
function diffRoutes(shots: Shot[], baseRoutes: string[], themes: Theme[]) {
  const onBase = new Set(baseRoutes);
  const diffs = new Map<string, number[]>();
  for (const { route, path } of shots) {
    if (!onBase.has(route)) continue;
    const pairs: number[] = [];
    for (const theme of themes) {
      for (const { name } of VIEWPORTS) {
        const file = shotFileName(path, name, theme);
        pairs.push(
          differingFraction(
            readFileSync(join(SIDE_DIR.before, file)),
            readFileSync(join(SIDE_DIR.after, file)),
          ),
        );
      }
    }
    diffs.set(route, pairs);
  }
  return diffs;
}

export async function compare({ body }: { body: string | undefined }, signal: AbortSignal) {
  // A PR body that can't take the fragment fails now, not after the shots.
  if (body !== undefined) {
    try {
      spliceBody(readFileSync(body, "utf8"), "");
    } catch (error) {
      throw new UiError(
        `Can't put the shots into ${body}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const routes = routesOf(ROOT);
  let shots: Shot[];
  try {
    shots = routes.map((route) => resolveRoute(route, ROUTES));
  } catch (error) {
    if (error instanceof RouteError) throw new UiError(error.message);
    throw error;
  }
  const pathOf = new Map(shots.map(({ route, path }) => [route, path]));
  const shootThemes = readThemes(ROOT);

  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(SHOTS_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await launchChromium();
  // Closing the browser fails whatever it is doing, so an interrupt mid-shot
  // goes straight to the teardown.
  const closeBrowser = () => void browser.close();
  signal.addEventListener("abort", closeBrowser);
  try {
    const base = await shootBase({ browser, shots, themes: shootThemes, signal });
    console.log("Shooting the branch");
    try {
      await shootSide({
        browser,
        root: ROOT,
        shots,
        themes: shootThemes,
        outDir: SIDE_DIR.after,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new UiError(
        `The branch's side failed, so the branch is broken:\n${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const path = (route: string) => pathOf.get(route) ?? route;
    const evidence: Evidence = base.ok
      ? comparedEvidence(
          classify({
            before: base.routes,
            after: routes,
            diffs: diffRoutes(shots, base.routes, shootThemes),
          }),
          { pathOf: path, themes: shootThemes },
        )
      : fallbackEvidence({
          base: base.base,
          reason: base.reason,
          routes,
          pathOf: path,
          themes: shootThemes,
        });

    const files = attachments(evidence, shootThemes);
    for (const { file, path: shotPath, viewport, theme, side } of files) {
      copyFileSync(
        join(SIDE_DIR[side], shotFileName(shotPath, viewport, theme)),
        join(OUT_DIR, file),
      );
    }
    const fragment = renderFragment(evidence, shootThemes);
    writeFileSync(FRAGMENT, `${fragment}\n`);
    console.log(
      `Wrote ${show(FRAGMENT)}, with ${files.length} files to attach from ${show(OUT_DIR)}/`,
    );
    if (body !== undefined) {
      writeFileSync(body, spliceBody(readFileSync(body, "utf8"), fragment));
      console.log(`Put it into ${body}`);
    }
  } finally {
    signal.removeEventListener("abort", closeBrowser);
    await browser.close();
    rmSync(SHOTS_DIR, { recursive: true, force: true });
  }
}
