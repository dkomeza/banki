import { CLIENT_TIMEOUT_MS } from "../broker/timeouts";
import { brokerSocket } from "../lib/config";
import { asObject, asString, isRecord, parseJson } from "../lib/parse";
import type { Identity } from "./plan";

// The runner's side of the broker's socket (broker/server.ts). The runner
// asks for tokens and never sees the keys that make them.

export type Broker = ReturnType<typeof broker>;

export function broker(socket = brokerSocket()) {
  async function call(method: string, path: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`http://broker${path}`, {
        method,
        unix: socket,
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Can't reach the broker at ${socket}: ${error instanceof Error ? error.message : String(error)}. Is the broker container up?`,
        { cause: error },
      );
    }
    const text = await res.text();
    if (!res.ok)
      throw new Error(`The broker's ${method} ${path} failed: ${errorOf(text, res.status)}`);
    return text;
  }

  return {
    /** A new Linear token for one Stage, and the ID it is revoked by. */
    async linearToken(): Promise<{ id: string; token: string }> {
      const body = asObject(parseJson(await call("POST", "/linear/tokens"), "broker"), "broker");
      return { id: asString(body.id, "broker.id"), token: asString(body.token, "broker.token") };
    },

    async endLinearToken(id: string): Promise<void> {
      await call("DELETE", `/linear/tokens/${encodeURIComponent(id)}`);
    },

    /** The App's bot, which the Stage commits as. */
    async identity(): Promise<Identity> {
      const body = asObject(parseJson(await call("GET", "/github/identity"), "broker"), "broker");
      return {
        name: asString(body.name, "broker.name"),
        email: asString(body.email, "broker.email"),
      };
    },
  };
}

function errorOf(text: string, status: number): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON.
  }
  return `HTTP ${status}`;
}
