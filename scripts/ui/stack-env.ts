// The environments the stack's processes run with. Everything that picks the
// data directory, ports or origin is set here, never inherited, so a stack
// can't touch apps/api/.data or another copy of Banki.

import { SEED_NOW } from "../../apps/api/src/seed/seed-ids.ts";

type Env = Record<string, string | undefined>;
type StackPlace = { dataDir: string; apiPort: number; webPort: number };

/** The web app's URL: Vite on localhost, which the API's ORIGIN must match. */
export const webUrl = (webPort: number) => `http://localhost:${webPort}`;

/**
 * For the API and the `banki` CLI: the stack's data directory, its port, the
 * Vite URL as ORIGIN, and the fixed seed time, so `banki seed` writes the
 * same times on every run.
 */
export function apiEnv(base: Env, { dataDir, apiPort, webPort }: StackPlace): Env {
  // A secret from the caller's shell would outlive the stack; each stack generates its own.
  const { AUTH_SECRET: _, ...rest } = base;
  return {
    ...rest,
    DATA_DIR: dataDir,
    PORT: String(apiPort),
    ORIGIN: webUrl(webPort),
    LOG_FORMAT: "json",
    LOG_LEVEL: "info",
    BANKI_SEED_NOW: SEED_NOW,
  };
}

/** For Vite: its port, and the API that it proxies /api to. */
export function webEnv(base: Env, { apiPort, webPort }: StackPlace): Env {
  return { ...base, WEB_PORT: String(webPort), API_URL: `http://localhost:${apiPort}` };
}
