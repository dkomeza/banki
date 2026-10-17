import type { MiddlewareHandler } from "hono";
import type { Auth } from "../auth/auth";
import { apiError } from "./errors";

/** What a protected route knows about the signed-in User. */
export type SignedInEnv = { Variables: { user: { id: string; email: string } } };

/**
 * Deny by default: answers 401 `unauthorized` unless the request is signed
 * in, except on `publicPaths`. A signed-in request carries its User on to the
 * route as `c.var.user`, and gets back any cookie better-auth set while
 * sliding the expiry forward.
 */
export function requireSignedIn({
  auth,
  publicPaths,
}: {
  auth: Auth;
  publicPaths: ReadonlySet<string>;
}): MiddlewareHandler<SignedInEnv> {
  return async (c, next) => {
    if (publicPaths.has(c.req.path)) return next();

    const { headers, response: signedIn } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (signedIn === null) return c.json(apiError("unauthorized", "Sign in to continue"), 401);

    c.set("user", { id: signedIn.user.id, email: signedIn.user.email });
    await next();
    for (const cookie of headers.getSetCookie()) c.res.headers.append("set-cookie", cookie);
  };
}
