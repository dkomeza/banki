// What `ui shoot` captures, and what it names each file.

export type Theme = "light" | "dark";

export type Viewport = {
  name: "phone" | "tablet" | "desktop";
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
};

export const VIEWPORTS: readonly Viewport[] = [
  { name: "phone", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  {
    name: "tablet",
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
];

/**
 * A route's part of a shot's file name: `/` is `index`, the leading slash goes,
 * other slashes become `_`, and the query string and hash are dropped. So
 * `/decks/abc?tab=cards` is `decks_abc`.
 */
export function shotName(route: string): string {
  const path = route.split(/[?#]/, 1)[0] ?? "";
  const name = path.replace(/^\//, "").replaceAll("/", "_");
  return name === "" ? "index" : name;
}

/** `<route>@<viewport>-<theme>.png`, such as `decks_abc@phone-light.png`. */
export function shotFileName(route: string, viewport: Viewport["name"], theme: Theme): string {
  return `${shotName(route)}@${viewport}-${theme}.png`;
}

/**
 * The themes to shoot, from apps/web/package.json: dark too only once
 * `"banki": { "darkTheme": true }` says the web app has a dark theme.
 */
export function themes(webPackageJson: unknown): Theme[] {
  const banki: unknown =
    typeof webPackageJson === "object" && webPackageJson !== null && "banki" in webPackageJson
      ? webPackageJson.banki
      : undefined;
  const darkTheme =
    typeof banki === "object" && banki !== null && "darkTheme" in banki && banki.darkTheme === true;
  return darkTheme ? ["light", "dark"] : ["light"];
}
