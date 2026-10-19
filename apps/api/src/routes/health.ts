import type { HealthResponse } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { HealthRepository } from "../repositories/health";

const logger = getLogger(["banki", "health"]);

/** `GET /`: whether the API is up and its database reachable, and the commit it was built from. */
export function healthRoutes({ health, commit }: { health: HealthRepository; commit: string }) {
  return new Hono().get("/", (c) => {
    try {
      health.ping();
    } catch (error) {
      logger.error("Database is unreachable", { error });
      return c.json(apiError("database_unreachable", "Database is unreachable"), 503);
    }
    return c.json({ status: "ok", database: "ok", commit } satisfies HealthResponse, 200);
  });
}
