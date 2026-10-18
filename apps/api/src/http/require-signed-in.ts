import type { MiddlewareHandler } from "hono";
import type { Auth } from "../auth/auth";
import { apiError } from "./errors";

/** What a protected route knows about the signed-in User. */
export type SignedInEnv = { Variables: { user: { id: string; email: string } } };

/** The requests anyone may make without being signed in, as `"METHOD /path"`. */
export type PublicRoutes = ReadonlySet<string>;

/**
 * Deny by default: answers 401 `unauthorized` unless the request is signed
 * in, except for `publicRoutes`, matched by method and exact path. Any other
 * method on a public path is as unknown as any other path. A signed-in request carries its User on to the
 * route as `c.var.user`, and gets back any cookie better-auth set while
 * sliding the expiry forward.
 */
export function requireSignedIn({
  auth,
  publicRoutes,
}: {
  auth: Auth;
  publicRoutes: PublicRoutes;
}): MiddlewareHandler<SignedInEnv> {
  return async (c, next) => {
    if (publicRoutes.has(`${c.req.method} ${c.req.path}`)) return next();

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
