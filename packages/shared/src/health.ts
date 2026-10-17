import { z } from "zod";

/** The body of a healthy `GET /api/health`: the API is up and its database answers. */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  database: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
