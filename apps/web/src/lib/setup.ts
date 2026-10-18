import type { SetupRequest } from "@banki/shared";
import { type ApiClient, api } from "./api";

export type SetupOutcome =
  | { ok: true }
  | { ok: false; reason: "invalid_setup_token" | "already_set_up" | "invalid_request" | "network" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number | undefined };

/** Does Setup, which also signs this browser in, and says how it went. */
export async function submitSetup(
  body: SetupRequest,
  client: ApiClient = api,
): Promise<SetupOutcome> {
  let res: Response;
  try {
    res = await client.api.setup.$post({ json: body });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.ok) return { ok: true };
  if (res.status === 403) return { ok: false, reason: "invalid_setup_token" };
  if (res.status === 409) return { ok: false, reason: "already_set_up" };
  if (res.status === 429) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: retryAfter(res, "retry-after") };
  }
  if (res.status === 400) return { ok: false, reason: "invalid_request" };
  return { ok: false, reason: "network" };
}

/** Whole seconds from a retry header, if it holds a sensible number. */
export function retryAfter(res: Response, header: string): number | undefined {
  const seconds = Number(res.headers.get(header));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

export const tryAgainIn = (seconds: number | undefined) =>
  seconds === undefined
    ? "Too many attempts. Try again in a minute."
    : `Too many attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
