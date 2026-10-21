import { describe, expect, test } from "vitest";
import source from "../../public/theme.js?raw";
import type { ThemeChoice, ThemeController } from "./theme";

// Runs the real public/theme.js, the blocking script in <head>, against a
// small fake of the browser: its storage, the system's colour scheme, and the
// <html> element and theme-color <meta> it changes.

const LIGHT = "#f8f5ee";
const DARK = "#1c1916";

/** What localStorage holds; "unreadable" stands for storage that throws. */
type Stored = string | null;

function browser({ stored = null, systemDark = false }: { stored?: Stored; systemDark?: boolean }) {
  let value = stored;
  const mediaListeners = new Set<() => void>();
  const storageListeners = new Set<(event: { key: string | null }) => void>();
  const media = { matches: systemDark };
  const blocked = () => {
    if (value === "unreadable") throw new DOMException("denied", "SecurityError");
  };
  const classes = new Set<string>();
  const meta = { content: "" };
  const html = {
    classList: {
      toggle: (name: string, force: boolean) => (force ? classes.add(name) : classes.delete(name)),
    },
    style: { colorScheme: "" },
  };

  const window = {
    document: {
      documentElement: html,
      currentScript: { dataset: { light: LIGHT, dark: DARK } },
      querySelector: (selector: string) =>
        selector === 'meta[name="theme-color"]'
          ? { setAttribute: (_: string, content: string) => (meta.content = content) }
          : null,
    },
    localStorage: {
      getItem: () => {
        blocked();
        return value;
      },
      setItem: (_: string, next: string) => {
        blocked();
        value = next;
      },
      removeItem: () => {
        blocked();
        value = null;
      },
    },
    matchMedia: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    }),
    addEventListener: (_: string, listener: (event: { key: string | null }) => void) =>
      storageListeners.add(listener),
    bankiTheme: undefined as ThemeController | undefined,
  };

  // oxlint-disable-next-line typescript/no-implied-eval -- runs the real theme.js, as the browser does
  new Function("window", source)(window);

  return {
    controller: window.bankiTheme!,
    shown: () => ({
      dark: classes.has("dark"),
      colorScheme: html.style.colorScheme,
      themeColor: meta.content,
    }),
    stored: () => value,
    /** The OS switches between light and dark while Banki is open. */
    systemTurns(dark: boolean) {
      media.matches = dark;
      for (const listener of mediaListeners) listener();
    },
    /** Another tab stores a choice. */
    otherTabStores(next: string | null) {
      value = next;
      for (const listener of storageListeners) listener({ key: "banki-theme" });
    },
  };
}

const LIGHT_SHOWN = { dark: false, colorScheme: "light", themeColor: LIGHT };
const DARK_SHOWN = { dark: true, colorScheme: "dark", themeColor: DARK };

describe("theme.js applies the theme before first paint", () => {
  test.each<[Stored, boolean, typeof LIGHT_SHOWN]>([
    ["light", false, LIGHT_SHOWN],
    ["light", true, LIGHT_SHOWN],
    ["dark", false, DARK_SHOWN],
    ["dark", true, DARK_SHOWN],
    ["system", false, LIGHT_SHOWN],
    ["system", true, DARK_SHOWN],
  ])("stored %s with a dark system %s", (stored, systemDark, expected) => {
    expect(browser({ stored, systemDark }).shown()).toEqual(expected);
  });

  test.each<Stored>([null, "", "Dark", "purple", '{"theme":"dark"}', "unreadable"])(
    "treats %j as System",
    (stored) => {
      expect(browser({ stored, systemDark: true }).shown()).toEqual(DARK_SHOWN);
      expect(browser({ stored, systemDark: false }).shown()).toEqual(LIGHT_SHOWN);
      expect(browser({ stored }).controller.choice()).toBe("system");
    },
  );
});

describe("with System chosen", () => {
  test("follows the OS turning dark and back while Banki is open", () => {
    const page = browser({ systemDark: false });

    page.systemTurns(true);
    expect(page.shown()).toEqual(DARK_SHOWN);
    page.systemTurns(false);
    expect(page.shown()).toEqual(LIGHT_SHOWN);
  });

  test("ignores the OS once Light or Dark is chosen", () => {
    const page = browser({ stored: "light", systemDark: false });

    page.systemTurns(true);
    expect(page.shown()).toEqual(LIGHT_SHOWN);
  });
});

describe("choosing a theme", () => {
  test("shows it at once and keeps it on this device", () => {
    const page = browser({ systemDark: false });

    page.controller.set("dark");

    expect(page.shown()).toEqual(DARK_SHOWN);
    expect(page.controller.choice()).toBe("dark");
    expect(page.stored()).toBe("dark");
  });

  test("System forgets the stored choice and follows the OS again", () => {
    const page = browser({ stored: "light", systemDark: true });

    page.controller.set("system");

    expect(page.stored()).toBeNull();
    expect(page.controller.choice()).toBe("system");
    expect(page.shown()).toEqual(DARK_SHOWN);
  });

  test("still shows it when storage can't be written", () => {
    const page = browser({ stored: "unreadable" });

    page.controller.set("dark");

    expect(page.shown()).toEqual(DARK_SHOWN);
    expect(page.controller.choice()).toBe("dark");
  });

  test("tells subscribers, until they unsubscribe", () => {
    const page = browser({});
    const seen: ThemeChoice[] = [];
    const unsubscribe = page.controller.subscribe(() => seen.push(page.controller.choice()));

    page.controller.set("dark");
    page.controller.set("light");
    unsubscribe();
    page.controller.set("system");

    expect(seen).toEqual(["dark", "light"]);
  });

  test("picks up a choice another tab stores", () => {
    const page = browser({ systemDark: false });

    page.otherTabStores("dark");

    expect(page.controller.choice()).toBe("dark");
    expect(page.shown()).toEqual(DARK_SHOWN);
  });
});
