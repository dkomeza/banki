import { isIP } from "node:net";
import type { Context } from "hono";

/**
 * The client's IP, from the single-value `X-Forwarded-For` Caddy sends with
 * every request it proxies. The API trusts it because only Caddy can reach
 * the API. `undefined` when the header is missing, holds a chain of hops, or
 * isn't an IP.
 */
export function clientIp(c: Context): string | undefined {
  const forwardedFor = c.req.header("x-forwarded-for")?.trim();
  return forwardedFor !== undefined && isIP(forwardedFor) !== 0 ? forwardedFor : undefined;
}
