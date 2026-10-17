import { z } from "zod";

/** The body of `GET /api/health`: the API is up and answering. */
export const HealthResponse = z.object({ status: z.literal("ok") });

export type HealthResponse = z.infer<typeof HealthResponse>;
