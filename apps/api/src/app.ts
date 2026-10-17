import { honoLogger } from "@logtape/hono";
import { Hono } from "hono";
import { SIGN_IN_RATE_LIMIT, createAuth } from "./auth/auth";
import { loadAuthSecret } from "./auth/secret";
import { type SetupToken, createSetupToken } from "./auth/setup-token";
import type { Config } from "./config";
import { openDatabase } from "./db/database";
import { applyMigrations } from "./db/migrate";
import { internalError, notFound } from "./http/errors";
import { createRateLimiter } from "./http/rate-limit";
import { requireSignedIn } from "./http/require-signed-in";
import { createHealthRepository } from "./repositories/health";
import { createUserRepository } from "./repositories/user";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { setupRoutes } from "./routes/setup";

/** The `/api` paths anyone may call without being signed in. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/api/health",
  "/api/setup",
  "/api/auth/sign-in/email",
  "/api/auth/sign-out",
  "/api/auth/get-session",
]);

/**
 * Builds the API: prepares the data directory, opens the database, applies
 * pending migrations, loads the auth secret, then wires repositories into
 * routes. While no User exists it also makes a fresh Setup token, which the
 * server announces. The server and the tests both boot the API through here.
 *
 * Only `getLogger` is used inside, so the app logs nothing until the server
 * entry configures LogTape.
 */
export function createApp(config: Config) {
  const database = openDatabase(config.dataDir);
  let appliedMigrations: string[];
  let secret: string;
  try {
    appliedMigrations = applyMigrations(database.db);
    secret = loadAuthSecret(config);
  } catch (error) {
    database.close();
    throw error;
  }

  const health = createHealthRepository(database.db);
  const users = createUserRepository(database.db);
  const auth = createAuth({ db: database.db, config, secret });
  const setupToken: SetupToken | undefined = users.exists() ? undefined : createSetupToken();
  const setupLimiter = createRateLimiter({
    max: SIGN_IN_RATE_LIMIT.max,
    windowMs: SIGN_IN_RATE_LIMIT.windowSeconds * 1000,
  });

  const app = new Hono()
    .use(
      honoLogger({
        category: ["banki", "http"],
        format: "structured-common",
        completionLevel: (c, { status }) =>
          c.req.method === "GET" && c.req.path === "/api/health" && status === 200
            ? "debug"
            : "info",
      }),
    )
    // Also covers `/api` itself.
    .use("/api/*", requireSignedIn({ auth, publicPaths: PUBLIC_PATHS }))
    .route("/api/health", healthRoutes({ health }))
    .route("/api/setup", setupRoutes({ auth, users, setupToken, limiter: setupLimiter }))
    .route("/api/auth", authRoutes({ auth, config }))
    .route("/api/me", meRoutes());
  app.notFound(notFound);
  app.onError(internalError);

  return { app, appliedMigrations, setupToken, close: database.close };
}

/** The API's routes, for the web app's typed `hc` client. */
export type AppType = ReturnType<typeof createApp>["app"];
