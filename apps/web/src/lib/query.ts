import { QueryClient } from "@tanstack/react-query";

/** An API call that answered with a non-2xx status. */
export class ApiRequestError extends Error {
  override name = "ApiRequestError";
  constructor(
    readonly status: number,
    message = `The API answered HTTP ${status}`,
  ) {
    super(message);
  }
}

/**
 * Retries a failed query up to 3 times, as TanStack Query does by default,
 * except a 401 or 403: retrying can't sign the browser in.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
    return false;
  }
  return failureCount < 3;
}

export const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });
