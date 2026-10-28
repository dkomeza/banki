import { z } from "zod";

/**
 * The body of a healthy `GET /api/health`: the API is up and its database
 * answers. `version` is the api's `package.json` version, which each Release
 * bumps. `commit` is the full SHA the image was built from, or `"dev"` for a
 * local build. `release` says the installation runs a Release (Production),
 * which its deploy decides, not its build.
 */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  database: z.literal("ok"),
  version: z.string().min(1),
  commit: z.string().min(1),
  release: z.boolean(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
