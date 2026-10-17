import { honoLogger } from "@logtape/hono";
import { Hono } from "hono";
import type { Config } from "./config";
import { openDatabase } from "./db/database";
import { applyMigrations } from "./db/migrate";
import { internalError, notFound } from "./http/errors";
import { createHealthRepository } from "./repositories/health";
import { healthRoutes } from "./routes/health";

/**
 * Builds the API: prepares the data directory, opens the database, applies
 * pending migrations, then wires repositories into routes. The server and the
 * tests both boot the API through here.
 *
 * Only `getLogger` is used inside, so the app logs nothing until the server
 * entry configures LogTape.
 */
export function createApp(config: Config) {
  const database = openDatabase(config.dataDir);
  let appliedMigrations: string[];
  try {
    appliedMigrations = applyMigrations(database.db);
  } catch (error) {
    database.close();
    throw error;
  }

  const health = createHealthRepository(database.db);

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
    .route("/api/health", healthRoutes({ health }));
  app.notFound(notFound);
  app.onError(internalError);

  return { app, appliedMigrations, close: database.close };
}

/** The API's routes, for the web app's typed `hc` client. */
export type AppType = ReturnType<typeof createApp>["app"];
