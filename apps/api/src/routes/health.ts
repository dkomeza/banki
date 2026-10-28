import type { HealthResponse } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { HealthRepository } from "../repositories/health";

const logger = getLogger(["banki", "health"]);

/** What `/api/health` says about the build it runs: its version, its commit, and whether it is a Release. */
export type BuildInfo = Pick<HealthResponse, "version" | "commit" | "release">;

/** `GET /`: whether the API is up and its database reachable, and the build it runs. */
export function healthRoutes({ health, build }: { health: HealthRepository; build: BuildInfo }) {
  return new Hono().get("/", (c) => {
    try {
      health.ping();
    } catch (error) {
      logger.error("Database is unreachable", { error });
      return c.json(apiError("database_unreachable", "Database is unreachable"), 503);
    }
    return c.json({ status: "ok", database: "ok", ...build } satisfies HealthResponse, 200);
  });
}
