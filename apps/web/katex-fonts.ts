// KaTeX's stylesheet offers each of its fonts as woff2, woff and ttf. Every
// browser Banki supports takes woff2, so the build drops the other two and
// bundles only the woff2 files, served by the app itself like the rest.

/** The woff and ttf sources in KaTeX's `@font-face` rules, each with its leading comma. */
const OLDER_FONTS = /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g;

/** KaTeX's stylesheet with only the woff2 source left in each `@font-face`. */
export const woff2Only = (css: string) => css.replace(OLDER_FONTS, "");

/** Whether a module ID is KaTeX's stylesheet. */
export const isKatexCss = (id: string) =>
  /[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id.split("?")[0] ?? "");
