import { shotName, type Theme, type Viewport, VIEWPORTS } from "./shots.ts";

// What `ui compare` puts in a PR body: which routes changed between the base
// and the branch, which of them fit in the files a PR can attach, the
// markdown fragment showing them, and how it goes into a PR body.

/** `gh … --attach` takes up to 50 files per command. */
export const ATTACH_BUDGET = 50;

export const START_MARKER = "<!-- ui-shots -->";
export const END_MARKER = "<!-- /ui-shots -->";

/** Where the PNGs are, relative to the worktree's root, as the fragment references them. */
export const PR_DIR = ".ui/pr";

type Side = "before" | "after";

export type Classification = {
  /** Only on the branch, in route-tree order. */
  newRoutes: string[];
  /** On both, with a pair that differs, in route-tree order. The score is the largest fraction of differing pixels. */
  changed: { route: string; score: number }[];
  /** Only on the base, in its route-tree order. */
  removed: string[];
  /** On both, with no pair that differs. */
  unchanged: string[];
};

/**
 * Sorts the routes into new, changed, removed and unchanged. `diffs` holds,
 * for each route on both sides, the fraction of differing pixels in each of
 * its pairs; any differing pixel makes the route changed.
 */
export function classify({
  before,
  after,
  diffs,
}: {
  before: readonly string[];
  after: readonly string[];
  diffs: ReadonlyMap<string, readonly number[]>;
}): Classification {
  const onBase = new Set(before);
  const onBranch = new Set(after);
  const result: Classification = {
    newRoutes: [],
    changed: [],
    removed: before.filter((route) => !onBranch.has(route)),
    unchanged: [],
  };
  for (const route of after) {
    if (!onBase.has(route)) {
      result.newRoutes.push(route);
      continue;
    }
    const pairs = diffs.get(route);
    if (pairs === undefined) throw new Error(`No diffs for ${route}, which both sides have.`);
    const score = Math.max(0, ...pairs);
    if (score > 0) result.changed.push({ route, score });
    else result.unchanged.push(route);
  }
  return result;
}

/** A route whose shots are shown: both sides, or after only. */
export type ShownRoute = { route: string; path: string; before: boolean; isNew: boolean };

export type Evidence =
  | {
      kind: "compared";
      shown: ShownRoute[];
      /** Changed or new routes past the budget. */
      notShown: string[];
      removed: string[];
      unchanged: string[];
    }
  | {
      kind: "fallback";
      /** The base commit, or what stands for it. */
      base: string;
      reason: string;
      shown: ShownRoute[];
      notShown: string[];
    };

type Variant = { viewport: Viewport["name"]; theme: Theme };

/** Every pair of a route: each viewport in each theme, light first. */
const variants = (themes: readonly Theme[]): Variant[] =>
  themes.flatMap((theme) => VIEWPORTS.map(({ name }) => ({ viewport: name, theme })));

const filesOf = (route: ShownRoute, themes: readonly Theme[]) =>
  variants(themes).length * (route.before ? 2 : 1);

/** Adds each whole route, in order, while it still fits in the budget; the rest are not shown. */
function fitBudget(routes: ShownRoute[], themes: readonly Theme[]) {
  const shown: ShownRoute[] = [];
  const notShown: string[] = [];
  let used = 0;
  for (const route of routes) {
    const files = filesOf(route, themes);
    if (notShown.length === 0 && used + files <= ATTACH_BUDGET) {
      shown.push(route);
      used += files;
    } else {
      notShown.push(route.route);
    }
  }
  return { shown, notShown };
}

/**
 * What a compare with both sides shows: new routes first, then changed routes
 * by descending score, each whole route while it still fits in the budget.
 */
export function comparedEvidence(
  classification: Classification,
  { pathOf, themes }: { pathOf: (route: string) => string; themes: readonly Theme[] },
): Evidence {
  const byScore = classification.changed.toSorted((a, b) => b.score - a.score);
  const { shown, notShown } = fitBudget(
    [
      ...classification.newRoutes.map((route) => ({
        route,
        path: pathOf(route),
        before: false,
        isNew: true,
      })),
      ...byScore.map(({ route }) => ({ route, path: pathOf(route), before: true, isNew: false })),
    ],
    themes,
  );
  return {
    kind: "compared",
    shown,
    notShown,
    removed: classification.removed,
    unchanged: classification.unchanged,
  };
}

/** What a compare whose base side failed shows: every route after only, in route-tree order. */
export function fallbackEvidence({
  base,
  reason,
  routes,
  pathOf,
  themes,
}: {
  base: string;
  reason: string;
  routes: readonly string[];
  pathOf: (route: string) => string;
  themes: readonly Theme[];
}): Evidence {
  const { shown, notShown } = fitBudget(
    routes.map((route) => ({ route, path: pathOf(route), before: false, isNew: false })),
    themes,
  );
  return { kind: "fallback", base, reason, shown, notShown };
}

/** `<shotName>@<viewport>-<theme>-<side>.png`, such as `login@phone-light-before.png`. */
export const prFileName = (path: string, viewport: Viewport["name"], theme: Theme, side: Side) =>
  `${shotName(path)}@${viewport}-${theme}-${side}.png`;

export type Attachment = Variant & { file: string; path: string; side: Side };

/** The files the fragment references, in its order: exactly the PNGs to attach. */
export function attachments(evidence: Evidence, themes: readonly Theme[]): Attachment[] {
  return evidence.shown.flatMap(({ path, before }) =>
    variants(themes).flatMap(({ viewport, theme }) =>
      (before ? (["before", "after"] as const) : (["after"] as const)).map((side) => ({
        file: prFileName(path, viewport, theme, side),
        path,
        viewport,
        theme,
        side,
      })),
    ),
  );
}

const VIEWPORT_LABEL = { phone: "Phone", tablet: "Tablet", desktop: "Desktop" } as const;

function table(route: ShownRoute, theme: Theme): string {
  const sides: Side[] = route.before ? ["before", "after"] : ["after"];
  const header = sides.map((side) => (side === "before" ? "Before" : "After"));
  const rows = VIEWPORTS.map(({ name }) => {
    const cells = sides.map((side) => {
      const alt = [route.route, name, ...(theme === "dark" ? ["dark"] : []), side].join(", ");
      return `![${alt}](./${PR_DIR}/${prFileName(route.path, name, theme, side)})`;
    });
    return `| ${VIEWPORT_LABEL[name]} | ${cells.join(" | ")} |`;
  });
  return [`| | ${header.join(" | ")} |`, `|${" --- |".repeat(sides.length + 1)}`, ...rows].join(
    "\n",
  );
}

function routeSection(route: ShownRoute, themes: readonly Theme[]): string {
  const parts = [`#### ${route.route}${route.isNew ? " (new)" : ""}`, table(route, "light")];
  if (themes.includes("dark")) {
    parts.push(`<details>\n<summary>Dark</summary>\n\n${table(route, "dark")}\n\n</details>`);
  }
  return parts.join("\n\n");
}

const list = (routes: readonly string[]) => routes.map((route) => `\`${route}\``).join(", ");

/** A failure's message as one short line for the note. */
const oneLine = (reason: string) => {
  const line = (reason.trim().split("\n", 1)[0] ?? "").replaceAll(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/** The markdown fragment, between the `ui-shots` markers. */
export function renderFragment(evidence: Evidence, themes: readonly Theme[]): string {
  const blocks: string[] = [];
  if (evidence.kind === "fallback") {
    blocks.push(
      `No before shots: the base \`${evidence.base}\` couldn't start (${oneLine(evidence.reason)}). After only.`,
    );
  }
  for (const route of evidence.shown) blocks.push(routeSection(route, themes));
  if (evidence.notShown.length > 0) {
    const label = evidence.kind === "fallback" ? "Also shot" : "Also changed";
    blocks.push(`${label} (not shown): ${list(evidence.notShown)}`);
  }
  if (evidence.kind === "compared") {
    if (blocks.length === 0 && evidence.removed.length === 0) blocks.push("No visual changes.");
    if (evidence.removed.length > 0) blocks.push(`Removed: ${list(evidence.removed)}`);
    if (evidence.unchanged.length > 0) blocks.push(`Unchanged: ${list(evidence.unchanged)}`);
  }
  return `${START_MARKER}\n${blocks.join("\n\n")}\n${END_MARKER}`;
}

/**
 * Puts the fragment into a PR body: in place of whatever is between the
 * markers, or at the top of the `## Evidence` section, or in a new
 * `## Evidence` section after `## Summary` (or at the end). The body comes
 * back with LF line endings.
 */
export function spliceBody(body: string, fragment: string): string {
  const text = body.replaceAll("\r\n", "\n");
  const start = text.indexOf(START_MARKER);
  if (start !== -1) {
    const end = text.indexOf(END_MARKER, start);
    if (end === -1) {
      throw new Error(`The PR body has ${START_MARKER} but no ${END_MARKER} after it.`);
    }
    return text.slice(0, start) + fragment + text.slice(end + END_MARKER.length);
  }

  const lines = text.split("\n");
  const evidence = lines.findIndex((line) => /^##\s+Evidence\s*$/.test(line));
  if (evidence !== -1) {
    const head = lines.slice(0, evidence + 1).join("\n");
    const rest = lines
      .slice(evidence + 1)
      .join("\n")
      .replace(/^\n+/, "");
    return rest === "" ? `${head}\n\n${fragment}\n` : `${head}\n\n${fragment}\n\n${rest}`;
  }

  const section = `## Evidence\n\n${fragment}\n`;
  const summary = lines.findIndex((line) => /^##\s+Summary\s*$/.test(line));
  const next =
    summary === -1 ? -1 : lines.findIndex((line, i) => i > summary && /^#{1,2}\s/.test(line));
  if (next !== -1) {
    const head = lines.slice(0, next).join("\n").replace(/\n+$/, "");
    return `${head}\n\n${section}\n${lines.slice(next).join("\n")}`;
  }
  const head = text.replace(/\n+$/, "");
  return head === "" ? section : `${head}\n\n${section}`;
}
