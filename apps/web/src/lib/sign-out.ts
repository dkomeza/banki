import { type SessionStorage, browserStorage, clearStoredSessions } from "./session-store";

/**
 * Signs this browser out with `request` (better-auth's `signOut`, which
 * answers `{ error }` rather than throwing for most failures) and calls
 * `signedOut` only if that worked, after clearing every study Session stored
 * in `storage` (the browser's). Says whether it did, so the caller can show
 * an error and stay put otherwise.
 */
export async function signOut(
  request: () => Promise<{ error: unknown }>,
  signedOut: () => void | Promise<void>,
  storage: SessionStorage | undefined = browserStorage(),
): Promise<boolean> {
  try {
    const { error } = await request();
    if (error !== null && error !== undefined) return false;
  } catch {
    return false;
  }
  clearStoredSessions(storage);
  await signedOut();
  return true;
}
