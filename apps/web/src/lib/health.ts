import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { type ApiClient, api } from "./api";

type HealthBody = InferResponseType<ApiClient["api"]["health"]["$get"]>;

/** The API's health body, plus the round trip the web app measured to get it. */
export type HealthCheck = HealthBody & { latencyMs: number };

/**
 * Asks the API whether it is up, timing the round trip from before the request
 * until the body is parsed. Rejects on a network failure or a non-2xx answer.
 */
export async function checkHealth(
  client: ApiClient = api,
  now: () => number = () => performance.now(),
): Promise<HealthCheck> {
  const startedAt = now();
  const res = await client.api.health.$get();
  if (!res.ok) {
    throw new Error(`Health check failed with HTTP ${res.status}`);
  }
  const body = await res.json();
  return { ...body, latencyMs: Math.round(now() - startedAt) };
}

export const healthQueryOptions = queryOptions({
  queryKey: ["health"],
  queryFn: () => checkHealth(),
});

type HealthQueryState =
  | { status: "pending" }
  | { status: "error" }
  | { status: "success"; data: HealthCheck };

export function healthStatusLine(query: HealthQueryState): string {
  if (query.status === "pending") return "Checking API…";
  if (query.status === "error") return "API is unreachable";
  return `API is up · ${query.data.latencyMs} ms`;
}
