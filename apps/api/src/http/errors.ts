import type { ApiError } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import type { ErrorHandler, NotFoundHandler } from "hono";

const logger = getLogger(["banki", "http"]);

export const apiError = (code: string, message: string): ApiError => ({
  error: { code, message },
});

/** Answers any path no route matches, under `/api` or not. */
export const notFound: NotFoundHandler = (c) => c.json(apiError("not_found", "Not found"), 404);

/** Logs an error no route handled and answers 500 without revealing anything about it. */
export const internalError: ErrorHandler = (error, c) => {
  logger.error("Unhandled error on {method} {path}", {
    method: c.req.method,
    path: c.req.path,
    error,
  });
  return c.json(apiError("internal_error", "Internal server error"), 500);
};
