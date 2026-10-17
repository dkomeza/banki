import { loginHref, safeRedirect } from "./redirect";

/**
 * Where the route guard sends a navigation, or `undefined` to let it through:
 * - before Setup, everything goes to `/setup`;
 * - after Setup, `/setup` goes to `/login`, or to `/` when signed in;
 * - signed out, anything else goes to `/login`, coming back afterwards;
 * - signed in, `/login` goes to its `redirect` target when that is safe, or `/`.
 */
export function guardRedirect({
  pathname,
  href,
  setUp,
  signedIn,
  redirect,
}: {
  /** The path being navigated to, without search or hash. */
  pathname: string;
  /** The path with its search and hash. */
  href: string;
  setUp: boolean;
  signedIn: boolean;
  /** `/login`'s `redirect` search param. */
  redirect?: unknown;
}): string | undefined {
  if (!setUp) return pathname === "/setup" ? undefined : "/setup";
  if (pathname === "/setup") return signedIn ? "/" : "/login";
  if (pathname === "/login") return signedIn ? safeRedirect(redirect) : undefined;
  return signedIn ? undefined : loginHref(href);
}
