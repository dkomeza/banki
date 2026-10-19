import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { shotFileName, type Theme, VIEWPORTS } from "./shots.ts";
import { UiError } from "./stack.ts";

/** How to install the browser, for the message when it is missing. */
export const INSTALL_CHROMIUM = "npx playwright install chromium";

/**
 * Launches Playwright's own Chromium, headless. Its `chromium` channel is the
 * full browser in its new headless mode, the same one `playwright-cli` uses
 * (see .playwright/cli.config.json).
 */
export async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({
      channel: "chromium",
      headless: true,
      // Playwright would exit the process on these, cutting the stack's
      // teardown short; the script closes the browser itself.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist")) {
      throw new UiError(
        `Playwright's Chromium isn't installed. Install it, then run this again:\n\n  ${INSTALL_CHROMIUM}`,
      );
    }
    throw error;
  }
}

/** Waits until the page's network is idle and its fonts have loaded. */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate("document.fonts.ready.then(() => undefined)");
}

/**
 * Screenshots every route, full page, at each viewport in each theme, into
 * `outDir`. Returns the files written.
 */
export async function shootRoutes({
  browser,
  url,
  routes,
  themes,
  storageState,
  outDir,
}: {
  browser: Browser;
  url: string;
  routes: string[];
  themes: Theme[];
  /** A signed-in browser state, or undefined to shoot signed out. */
  storageState: string | undefined;
  outDir: string;
}): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });

  // A first visit lets Vite transform each route's modules and optimise any
  // dependency it discovers (which reloads the page), before anything is shot.
  const warmUp = await browser.newContext({ storageState });
  try {
    for (const route of routes) await open(await warmUp.newPage(), url + route);
  } finally {
    await warmUp.close();
  }

  const files: string[] = [];
  for (const viewport of VIEWPORTS) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        colorScheme: theme,
        storageState,
      });
      try {
        for (const route of routes) {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await open(page, url + route);
          const file = join(outDir, shotFileName(route, viewport.name, theme));
          await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
          files.push(file);
          for (const error of errors) {
            console.warn(`  ${route} (${viewport.name}, ${theme}) threw: ${error}`);
          }
          await page.close();
        }
      } finally {
        await context.close();
      }
    }
  }
  return files;
}
