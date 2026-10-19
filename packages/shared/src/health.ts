import { z } from "zod";

/**
 * The body of a healthy `GET /api/health`: the API is up and its database
 * answers. `commit` is the full SHA the image was built from, or `"dev"` for
 * a local build.
 */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  database: z.literal("ok"),
  commit: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
