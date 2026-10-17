import type { HealthResponse } from "@banki/shared";
import { Hono } from "hono";

export const app = new Hono()
  .basePath("/api")
  .get("/health", (c) => c.json({ status: "ok" } satisfies HealthResponse));

export type AppType = typeof app;
