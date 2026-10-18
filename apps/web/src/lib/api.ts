import type { AppType } from "@banki/api";
import { hc } from "hono/client";
import { type UnauthorizedHandler, handlingUnauthorized } from "./unauthorized";

export type ApiClient = ReturnType<typeof hc<AppType>>;

/** A typed client for the Banki API, which the web app reaches on its own origin under `/api`. */
export const createApiClient = (fetch?: typeof globalThis.fetch): ApiClient =>
  hc<AppType>("/", { fetch });

let onUnauthorized: UnauthorizedHandler = async () => {};

/** Sets what happens when any call through {@link api} answers 401. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  onUnauthorized = handler;
}

export const api = createApiClient(
  handlingUnauthorized(
    (input, init) => globalThis.fetch(input, init),
    () => onUnauthorized(),
  ),
);
