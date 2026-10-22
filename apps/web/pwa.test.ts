import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { build } from "vite";

// Builds the web app into a throwaway directory and checks what a browser
// gets: an installable manifest, icons made from public/icon.svg, and no
// service worker (Banki is online-only).

const outDir = mkdtempSync(join(tmpdir(), "banki-web-build-"));
let files: string[] = [];
let html = "";

beforeAll(async () => {
  await build({
    configFile: join(import.meta.dirname, "vite.config.ts"),
    root: import.meta.dirname,
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
  files = readdirSync(outDir, { recursive: true, encoding: "utf8" });
  html = readFileSync(join(outDir, "index.html"), "utf8");
}, 120_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const read = (file: string) => readFileSync(join(outDir, file));

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const png = read(file);
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("the web app's build", () => {
  test("has the manifest, and the icons generated from the one SVG", () => {
    expect(files).toContain("manifest.webmanifest");
    expect(pngSize("pwa-192x192.png")).toEqual([192, 192]);
    expect(pngSize("pwa-512x512.png")).toEqual([512, 512]);
    expect(pngSize("maskable-icon-512x512.png")).toEqual([512, 512]);
    expect(pngSize("apple-touch-icon-180x180.png")).toEqual([180, 180]);
    expect(files).toContain("favicon.ico");
  });

  test("has no service worker, and nothing registers one", () => {
    expect(files.filter((file) => /(^|\/)(sw|workbox-[^/]*)\.js(\.map)?$/.test(file))).toEqual([]);
    expect(files).not.toContain("registerSW.js");
    for (const file of files.filter((name) => name.endsWith(".js") || name.endsWith(".html"))) {
      expect(read(file).toString("utf8"), file).not.toMatch(/serviceWorker\s*\.\s*register/);
    }
  });

  test("has a manifest Chrome can install from", () => {
    const manifest: unknown = JSON.parse(read("manifest.webmanifest").toString("utf8"));
    const paper = /data-light="(#[0-9a-f]{6})"/.exec(html)?.[1];

    expect(paper).toBeDefined();
    expect(manifest).toMatchObject({
      id: "/",
      name: "Banki",
      short_name: "Banki",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: paper,
      theme_color: paper,
      icons: [
        { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
        {
          src: "maskable-icon-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    });
  });

  test("links the manifest, the icons and the iOS metas from index.html", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="48x48">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Banki" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  });

  test("loads theme.js as a blocking script before the app, with both themes' colours", () => {
    const theme = /<script\s+src="\/theme\.js"([^>]*)><\/script>/.exec(html);

    expect(theme).not.toBeNull();
    expect(theme?.[1]).not.toMatch(/\b(async|defer|type=)/);
    expect(theme?.[1]).toMatch(/data-light="#[0-9a-f]{6}"/);
    expect(theme?.[1]).toMatch(/data-dark="#[0-9a-f]{6}"/);
    expect(html.indexOf("/theme.js")).toBeLessThan(html.indexOf('type="module"'));
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}"/);
    expect(files).toContain("theme.js");
  });
});
