import { readFileSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { isKatexCss, woff2Only } from "./katex-fonts.ts";
import { readPalette, toHex } from "./palette.ts";

// `bun run dev` serves on 5173 and proxies /api to the API on 3000. The `ui`
// script sets both, so copies of Banki in several worktrees run side by side.
const port = process.env["WEB_PORT"] ? Number(process.env["WEB_PORT"]) : 5173;
const apiUrl = process.env["API_URL"] || "http://localhost:3000";

// The themes' backgrounds, from the tokens in index.css: the manifest's
// colours, and the theme-color theme.js sets.
const palette = readPalette(readFileSync(new URL("./src/index.css", import.meta.url), "utf8"));
const paper = toHex(palette.light["background"]!);
const night = toHex(palette.dark["background"]!);

/** Fills in index.html's theme colours. */
const themeColors = (): Plugin => ({
  name: "banki:theme-colors",
  transformIndexHtml: {
    order: "pre",
    handler: (html) =>
      html
        .replaceAll("%BANKI_LIGHT_BACKGROUND%", paper)
        .replaceAll("%BANKI_DARK_BACKGROUND%", night),
  },
});

/** Bundles only the woff2 files of KaTeX's fonts (katex-fonts.ts). */
const katexWoff2Only = (): Plugin => ({
  name: "banki:katex-woff2-only",
  enforce: "pre",
  transform: (code, id) => (isKatexCss(id) ? woff2Only(code) : undefined),
});

/**
 * Banki is online-only, with no service worker (offline use is BAN-71). But
 * vite-plugin-pwa always writes one, sw.js and its workbox-*.js, after the
 * bundle, and its `disable` would drop the manifest too. Nothing registers it
 * (`injectRegister: false`), and this deletes the files so nothing can.
 */
const dropServiceWorker = (): Plugin => {
  let outDir = "";
  return {
    name: "banki:drop-service-worker",
    apply: "build",
    configResolved: (config) => {
      outDir = isAbsolute(config.build.outDir)
        ? config.build.outDir
        : join(config.root, config.build.outDir);
    },
    closeBundle: {
      sequential: true,
      order: "post",
      handler: () => {
        for (const file of readdirSync(outDir)) {
          if (/^(sw|workbox-[\w-]+)\.js(\.map)?$/.test(file)) rmSync(join(outDir, file));
        }
      },
    },
  };
};

export default defineConfig({
  plugins: [
    // The router plugin has to run before the React plugin.
    tanstackRouter({ target: "react" }),
    react(),
    tailwindcss(),
    themeColors(),
    katexWoff2Only(),
    VitePWA({
      injectRegister: false,
      manifest: {
        id: "/",
        name: "Banki",
        short_name: "Banki",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: paper,
        theme_color: paper,
      },
      // Every icon, made at build time from the one SVG.
      pwaAssets: {
        image: "public/icon.svg",
        preset: {
          transparent: { sizes: [192, 512], favicons: [[48, "favicon.ico"]], padding: 0 },
          // Padded so the cards sit inside the maskable safe zone, the middle 80% circle.
          maskable: { sizes: [512], padding: 0.12, resizeOptions: { background: paper } },
          apple: { sizes: [180], padding: 0.06, resizeOptions: { background: paper } },
        },
        htmlPreset: "2023",
        overrideManifestIcons: true,
        // theme.js sets theme-color to the theme on screen.
        injectThemeColor: false,
      },
      // For the service worker dropServiceWorker deletes: nothing to precache.
      workbox: { globPatterns: [] },
    }),
    dropServiceWorker(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port,
    proxy: {
      // xfwd sends the API X-Forwarded-For, as Caddy does in Docker, so the
      // API's rate limits and logs see each client's IP.
      "/api": { target: apiUrl, xfwd: true },
    },
  },
});
