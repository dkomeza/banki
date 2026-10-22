// Applies the User's theme (System, Light or Dark) before first paint, so a
// reload never flashes the other theme. index.html loads it as a blocking
// script in <head>: a file, not inline, so the CSP needs no hash for it.
//
// The choice lives in this device's localStorage only. A missing or
// unreadable value means System, which follows prefers-color-scheme live.
// The script sets the `dark` class and `color-scheme` on <html>, and
// <meta name="theme-color"> to the theme's background, whose colours its own
// <script> tag carries in data-light and data-dark (vite.config.ts derives
// them from index.css). The app changes the theme through `window.bankiTheme`
// (typed in src/lib/theme.ts).
//
// It reaches every browser API through `window`, so its tests can run it
// against a fake one.
"use strict";
(function (window) {
  var KEY = "banki-theme";
  var doc = window.document;
  var root = doc.documentElement;
  var script = doc.currentScript;
  var colors = {
    light: (script && script.dataset["light"]) || "",
    dark: (script && script.dataset["dark"]) || "",
  };
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  /** @type {Set<() => void>} */
  var listeners = new Set();

  /** @param {unknown} value @returns {"system" | "light" | "dark"} */
  function parse(value) {
    return value === "light" || value === "dark" ? value : "system";
  }

  function read() {
    try {
      return parse(window.localStorage.getItem(KEY));
    } catch {
      return parse(null);
    }
  }

  var choice = read();

  function apply() {
    var theme = choice === "system" ? (media.matches ? "dark" : "light") : choice;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors[theme]);
  }

  /** @param {"system" | "light" | "dark"} next */
  function show(next) {
    choice = next;
    apply();
    listeners.forEach(function (listener) {
      listener();
    });
  }

  media.addEventListener("change", apply);
  // Another tab of Banki on this device chose a theme.
  window.addEventListener("storage", function (event) {
    if (event.key === KEY || event.key === null) show(read());
  });

  window.bankiTheme = {
    choice: function () {
      return choice;
    },
    set: function (next) {
      try {
        if (next === "system") window.localStorage.removeItem(KEY);
        else window.localStorage.setItem(KEY, next);
      } catch {
        // Storage is blocked: the choice still holds until the page is closed.
      }
      show(parse(next));
    },
    subscribe: function (listener) {
      listeners.add(listener);
      return function () {
        listeners.delete(listener);
      };
    },
  };

  apply();
})(window);
