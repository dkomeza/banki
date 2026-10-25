import { getLogger } from "@logtape/logtape";

const logger = getLogger(["banki", "openrouter"]);

/** OpenRouter's endpoint describing the key it is called with; it spends no credits. */
export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

/** How long to wait for OpenRouter before giving up. */
const TIMEOUT_MS = 10_000;

/** The `fetch` the API reaches OpenRouter with; tests stub it. */
export type OpenRouterFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * `accepted` when OpenRouter answers 200, `refused` when it answers 401 (or
 * the key has characters no request can carry), and
 * `unreachable` for anything else: a network error, a timeout or any other
 * status.
 */
export type ApiKeyCheck = "accepted" | "refused" | "unreachable";

/** Asks OpenRouter whether it accepts `apiKey`, before Banki stores it. */
export async function checkApiKey(
  apiKey: string,
  { fetch, timeoutMs = TIMEOUT_MS }: { fetch: OpenRouterFetch; timeoutMs?: number },
): Promise<ApiKeyCheck> {
  let headers: Headers;
  try {
    headers = new Headers({ authorization: `Bearer ${apiKey}` });
  } catch {
    // Characters no header can carry (a line break, an emoji): no key
    // OpenRouter issues has them, so it would refuse it.
    return "refused";
  }
  try {
    const res = await fetch(OPENROUTER_KEY_URL, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Only the status matters; the body isn't read.
    await res.body?.cancel();
    if (res.status === 200) return "accepted";
    if (res.status === 401) return "refused";
    logger.warning("OpenRouter answered {status} to a key check", { status: res.status });
    return "unreachable";
  } catch (error) {
    logger.warning("Couldn't reach OpenRouter to check a key", { error });
    return "unreachable";
  }
}
