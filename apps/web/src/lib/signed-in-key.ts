// The signed-in query's key and data, in a module of their own, so code that
// updates them needn't load better-auth's client (which reads `window`).

/** Who is signed in, or `null` when this browser is signed out. */
export type SignedIn = { email: string } | null;

export const signedInQueryKey = ["signed-in"] as const;
