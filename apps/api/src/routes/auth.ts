import { getLogger } from "@logtape/logtape";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { Auth } from "../auth/auth";
import type { Config } from "../config";
import { clientIp } from "../http/client-ip";

const logger = getLogger(["banki", "auth"]);

/** better-auth's error codes for a request it refused because of where it came from. */
const ORIGIN_ERROR_CODES = new Set([
  "INVALID_ORIGIN",
  "MISSING_OR_NULL_ORIGIN",
  "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED",
]);

const BetterAuthError = z.object({ code: z.string() });

/** better-auth's error code in a response, if it has one. */
async function errorCode(res: Response): Promise<string | undefined> {
  const parsed = BetterAuthError.safeParse(
    await res
      .clone()
      .json()
      .catch(() => undefined),
  );
  return parsed.success ? parsed.data.code : undefined;
}

/**
 * The only better-auth endpoints reachable over HTTP, mounted at `/api/auth`:
 * sign-in with Email and Password, sign-out and get-session. Every other path
 * under `/api/auth` falls through to the JSON 404.
 */
export function authRoutes({ auth, config }: { auth: Auth; config: Pick<Config, "origin"> }) {
  /** Passes the request to better-auth, logging a refusal over its origin. */
  const forward = async (c: Context) => {
    const res = await auth.handler(c.req.raw);
    const refusedOrigin =
      res.status === 403 && ORIGIN_ERROR_CODES.has((await errorCode(res)) ?? "");
    if (refusedOrigin) {
      const requestOrigin = c.req.header("origin") ?? c.req.header("referer") ?? "none";
      logger.warning(
        "Refused {method} {path} from origin {requestOrigin}, which isn't Banki's ORIGIN {origin}. " +
          "If Banki is opened at {requestOrigin}, set BANKI_ORIGIN (ORIGIN outside Docker) to it",
        { method: c.req.method, path: c.req.path, requestOrigin, origin: config.origin },
      );
    }
    return { res, refusedOrigin };
  };
  const handle = async (c: Context) => (await forward(c)).res;

  return new Hono()
    .post("/sign-in/email", async (c) => {
      const { res, refusedOrigin } = await forward(c);
      const ip = clientIp(c) ?? "unknown";
      if (res.status === 429) {
        logger.warning("Sign-in rate limited for {ip}", { ip });
      } else if (!res.ok && !refusedOrigin) {
        // A wrong Email or Password (401), or one better-auth refuses outright (400).
        logger.warning("Failed sign-in from {ip} ({status})", { ip, status: res.status });
      }
      return res;
    })
    .post("/sign-out", handle)
    .get("/get-session", handle);
}
