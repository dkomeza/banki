/**
 * Signs this browser out with `request` (better-auth's `signOut`, which
 * answers `{ error }` rather than throwing for most failures) and calls
 * `signedOut` only if that worked. Says whether it did, so the caller can
 * show an error and stay put otherwise.
 */
export async function signOut(
  request: () => Promise<{ error: unknown }>,
  signedOut: () => void | Promise<void>,
): Promise<boolean> {
  try {
    const { error } = await request();
    if (error !== null && error !== undefined) return false;
  } catch {
    return false;
  }
  await signedOut();
  return true;
}
