// Reads the colour tokens out of src/index.css, the way a browser would compute
// them, so the build can use the same colours (the manifest's and theme.js's
// backgrounds) and the tests can check their contrast. It understands what
// index.css uses: `oklch(L C H [/ A])` whose parts are numbers, var() or
// calc() over numbers.

/** An oklch colour: lightness 0 to 1, chroma, hue in degrees, alpha 0 to 1. */
export type Oklch = { l: number; c: number; h: number; alpha: number };

export type Palette = { light: Record<string, Oklch>; dark: Record<string, Oklch> };

const stripComments = (css: string) => css.replaceAll(/\/\*[\s\S]*?\*\//g, "");

/** The custom properties declared in every top-level `selector { … }` block. */
function declarations(css: string, selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  const escaped = selector.replaceAll(".", "\\.");
  for (const block of css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))) {
    for (const [, name, value] of (block[1] ?? "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      if (name !== undefined && value !== undefined) result[name] = value.trim();
    }
  }
  return result;
}

function substitute(value: string, scope: Record<string, string>, seen: string[] = []): string {
  return value.replaceAll(/var\(--([\w-]+)\)/g, (_, name: string) => {
    const raw = scope[name];
    if (raw === undefined) throw new Error(`--${name} is not defined`);
    if (seen.includes(name)) throw new Error(`--${name} refers to itself`);
    return substitute(raw, scope, [...seen, name]);
  });
}

/** Evaluates `+ - * /` and parentheses over plain numbers. */
function arithmetic(expression: string): number {
  const tokens = expression.match(/\d*\.?\d+(?:e-?\d+)?|[-+*/()]/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const primary = (): number => {
    const token = next();
    if (token === "(") {
      const value = sum();
      next();
      return value;
    }
    if (token === "-") return -primary();
    const value = Number(token);
    if (Number.isNaN(value)) throw new Error(`Can't evaluate calc(${expression})`);
    return value;
  };
  const product = (): number => {
    let value = primary();
    while (peek() === "*" || peek() === "/")
      value = next() === "*" ? value * primary() : value / primary();
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === "+" || peek() === "-")
      value = next() === "+" ? value + product() : value - product();
    return value;
  };
  return sum();
}

function evaluateCalc(value: string): string {
  let result = value;
  // Innermost calc() first: one with no calc( left inside it.
  for (;;) {
    const match = /calc\(((?:[^()]|\([^()]*\))*)\)/.exec(result);
    if (match === null) return result;
    result = result.replace(match[0], String(arithmetic(match[1] ?? "")));
  }
}

const number = (part: string) =>
  part.endsWith("%") ? Number(part.slice(0, -1)) / 100 : Number(part);

function parseOklch(value: string): Oklch | undefined {
  const match = /^oklch\(\s*([^)]*)\)$/.exec(value);
  if (match === null) return undefined;
  const [channels = "", alpha] = (match[1] ?? "").split("/");
  const [l, c, h] = channels.trim().split(/\s+/).map(number);
  if (l === undefined || c === undefined || h === undefined) return undefined;
  return { l, c, h, alpha: alpha === undefined ? 1 : number(alpha.trim()) };
}

function resolveScope(scope: Record<string, string>): Record<string, Oklch> {
  const result: Record<string, Oklch> = {};
  for (const name of Object.keys(scope)) {
    const color = parseOklch(evaluateCalc(substitute(`var(--${name})`, scope)));
    if (color !== undefined) result[name] = color;
  }
  return result;
}

/**
 * Every colour token of the light theme (`:root`) and the dark one (`:root`
 * overridden by `.dark`), by name without the `--`.
 */
export function readPalette(css: string): Palette {
  const clean = stripComments(css);
  const root = declarations(clean, ":root");
  return {
    light: resolveScope(root),
    dark: resolveScope({ ...root, ...declarations(clean, ".dark") }),
  };
}

/** Linear-light sRGB, unclamped: outside 0 to 1 is out of gamut. */
function linearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  // The LMS cone responses, cubed back from OKLab's cube roots.
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
}

const GAMUT_TOLERANCE = 1e-3;

/** Whether the colour fits in sRGB, so every screen shows the same one. */
export const inGamut = (color: Oklch) =>
  linearSrgb(color).every((v) => v >= -GAMUT_TOLERANCE && v <= 1 + GAMUT_TOLERANCE);

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** The colour as `#rrggbb`, ignoring alpha. Throws when it is outside sRGB. */
export function toHex(color: Oklch): string {
  if (!inGamut(color)) throw new Error(`oklch(${color.l} ${color.c} ${color.h}) is outside sRGB`);
  return `#${linearSrgb(color)
    .map((v) =>
      Math.round(clamp(gamma(clamp(v))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const luminance = (color: Oklch) => {
  const [r, g, b] = linearSrgb(color);
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
};

/** The WCAG 2 contrast ratio of two opaque colours, 1 to 21. */
export function contrast(a: Oklch, b: Oklch): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
