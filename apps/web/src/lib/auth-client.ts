import { createAuthClient } from "better-auth/react";

/**
 * better-auth's client, for signing in and out and reading the sign-in state.
 * The API serves it on this origin under `/api/auth` (ADR-0002).
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
});
