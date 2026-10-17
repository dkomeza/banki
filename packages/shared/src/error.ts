import { z } from "zod";

/**
 * The body of every error the API answers with. `code` is stable snake_case
 * that clients can branch on; `message` is for people and may change.
 */
export const ApiError = z.object({
  error: z.object({
    code: z.string().regex(/^[a-z]+(?:_[a-z]+)*$/, "Expected a snake_case code"),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof ApiError>;
