/** What to do about a 401: resolves once it is dealt with. */
export type UnauthorizedHandler = () => Promise<void>;

/**
 * Re-checks the sign-in once per 401 (401s that arrive together share one
 * re-check) and goes to the sign-in page if the browser is signed out. If it
 * is still signed in, or the re-check fails, nothing happens: the caller shows
 * the 401 as an error, and nothing is retried, so nothing loops.
 */
export function createUnauthorizedHandler({
  isSignedIn,
  goToSignIn,
}: {
  isSignedIn: () => Promise<boolean>;
  goToSignIn: () => void;
}): UnauthorizedHandler {
  const check = async () => {
    try {
      if (!(await isSignedIn())) goToSignIn();
    } catch {
      // Can't tell, so stay put and let the caller show its error.
    }
  };
  let checking: Promise<void> | undefined;
  return () => {
    checking ??= check().finally(() => {
      checking = undefined;
    });
    return checking;
  };
}

/** A fetch that hands every 401 to `onUnauthorized` before returning it. */
export function handlingUnauthorized(
  fetch: typeof globalThis.fetch,
  onUnauthorized: UnauthorizedHandler,
): typeof globalThis.fetch {
  return async (input, init) => {
    const res = await fetch(input, init);
    if (res.status === 401) await onUnauthorized();
    return res;
  };
}
