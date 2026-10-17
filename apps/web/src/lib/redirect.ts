/**
 * The `redirect` target to go to after signing in, when it is a path on this
 * origin: it starts with `/`, but not with `//` or `/\`, which browsers read as
 * another host. Anything else goes to `/`, including a target with control
 * characters, since browsers drop tabs and newlines from URLs (`/\t/host`
 * would become `//host`).
 */
export function safeRedirect(target: unknown): string {
  if (typeof target !== "string" || !target.startsWith("/")) return "/";
  if (target.startsWith("//") || target.startsWith("/\\")) return "/";
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(target)) return "/";
  return target;
}

/** The sign-in page, coming back to `path` (a path, with any search and hash) afterwards. */
export function loginHref(path: string): string {
  return path === "/" ? "/login" : `/login?redirect=${encodeURIComponent(path)}`;
}
