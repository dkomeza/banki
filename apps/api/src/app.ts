import { honoLogger } from "@logtape/hono";
import { Hono } from "hono";
import { SIGN_IN_RATE_LIMIT, createAuth } from "./auth/auth";
import { loadAuthSecret } from "./auth/secret";
import { type SetupToken, createSetupToken } from "./auth/setup-token";
import type { Config } from "./config";
import { createApiKeyCipher } from "./crypto/api-key-cipher";
import { loadEncryptionKey } from "./crypto/encryption-key";
import { openDatabase } from "./db/database";
import { applyMigrations } from "./db/migrate";
import { internalError, notFound } from "./http/errors";
import { createRateLimiter } from "./http/rate-limit";
import { type PublicRoutes, requireSignedIn } from "./http/require-signed-in";
import type { OpenRouterFetch } from "./openrouter/check-api-key";
import { createHealthRepository } from "./repositories/health";
import { createDeckRepository } from "./repositories/decks";
import { createSettingsRepository } from "./repositories/settings";
import { createUserRepository } from "./repositories/user";
import { authRoutes } from "./routes/auth";
import { deckRoutes } from "./routes/decks";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { settingsRoutes } from "./routes/settings";
import { setupRoutes } from "./routes/setup";

/**
 * The `/api` requests anyone may make without being signed in. HEAD isn't
 * among them: nothing needs it, so it is denied like any other method.
 */
const PUBLIC_ROUTES: PublicRoutes = new Set([
  "GET /api/health",
  "GET /api/setup",
  "POST /api/setup",
  "POST /api/auth/sign-in/email",
  "POST /api/auth/sign-out",
  "GET /api/auth/get-session",
]);

/** A limiter of attempts at something that takes the Password, as strict as sign-in's. */
const signInLimiter = () =>
  createRateLimiter({
    max: SIGN_IN_RATE_LIMIT.max,
    windowMs: SIGN_IN_RATE_LIMIT.windowSeconds * 1000,
  });

/**
 * Builds the API: prepares the data directory, opens the database, applies
 * pending migrations, loads the auth secret and the encryption key, then wires repositories into
 * routes. While no User exists it also makes a fresh Setup token, which the
 * server announces. The server and the tests both boot the API through here.
 *
 * `openRouterFetch` is how the API reaches OpenRouter: the real `fetch`
 * unless a test stubs it.
 *
 * Only `getLogger` is used inside, so the app logs nothing until the server
 * entry configures LogTape.
 */
export function createApp(
  config: Config,
  {
    openRouterFetch = (input, init) => fetch(input, init),
  }: { openRouterFetch?: OpenRouterFetch } = {},
) {
  const database = openDatabase(config.dataDir);
  let appliedMigrations: string[];
  let secret: string;
  let encryptionKey: Buffer;
  try {
    appliedMigrations = applyMigrations(database.db);
    secret = loadAuthSecret(config);
    encryptionKey = loadEncryptionKey(config);
  } catch (error) {
    database.close();
    throw error;
  }

  const health = createHealthRepository(database.db);
  const users = createUserRepository(database.db);
  const settings = createSettingsRepository(database.db, createApiKeyCipher(encryptionKey));
  const decks = createDeckRepository(database.db);
  const auth = createAuth({ db: database.db, config, secret });
  const setupToken: SetupToken | undefined = users.exists() ? undefined : createSetupToken();

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
    .use("/api/*", requireSignedIn({ auth, publicRoutes: PUBLIC_ROUTES }))
    .route("/api/health", healthRoutes({ health, commit: config.commit }))
    .route("/api/setup", setupRoutes({ auth, users, setupToken, limiter: signInLimiter() }))
    .route("/api/auth", authRoutes({ auth, config }))
    .route("/api/me", meRoutes({ users, limiter: signInLimiter() }))
    .route("/api/settings", settingsRoutes({ settings, openRouterFetch }))
    .route("/api/decks", deckRoutes({ decks }));
  app.notFound(notFound);
  app.onError(internalError);

  return { app, appliedMigrations, setupToken, close: database.close };
}

/** The API's routes, for the web app's typed `hc` client. */
export type AppType = ReturnType<typeof createApp>["app"];
