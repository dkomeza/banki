import type { AppType } from "@banki/api";
import { hc } from "hono/client";

export type ApiClient = ReturnType<typeof hc<AppType>>;

/** A typed client for the Banki API, which the web app reaches on its own origin under `/api`. */
export const createApiClient = (fetch?: typeof globalThis.fetch): ApiClient =>
  hc<AppType>("/", { fetch });

export const api = createApiClient();
