import { asObject, asString, type Fetch, isRecord, parseJson } from "../lib/parse";

// The Linear adapter (ADR-0012). The Runner is a Linear OAuth app acting as
// itself (`actor=app`), and the broker mints its tokens with the
// client-credentials grant only: Linear doesn't let an app mix grants and
// still hold several `app` tokens at once. Every token asks for the same
// scopes, `read,write`: a token with other scopes would revoke all the rest.

const TOKEN_URL = "https://api.linear.app/oauth/token";
const REVOKE_URL = "https://api.linear.app/oauth/revoke";
export const SCOPES = "read,write";
const TIMEOUT_MS = 30_000;

export type LinearApp = ReturnType<typeof linearApp>;

export function linearApp(options: { clientId: string; clientSecret: string; fetch?: Fetch }) {
  const fetchFn: Fetch = options.fetch ?? fetch;
  const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");

  async function post(url: string, form: Record<string, string>, auth?: string) {
    return fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "banki-runner-broker",
        ...(auth === undefined ? {} : { Authorization: auth }),
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  return {
    /** A new token for the app itself, good for Linear's 30 days unless revoked first. */
    async mint(): Promise<string> {
      const res = await post(
        TOKEN_URL,
        { grant_type: "client_credentials", scope: SCOPES },
        `Basic ${basic}`,
      );
      const text = await res.text();
      if (!res.ok) throw new Error(`Linear POST /oauth/token: HTTP ${res.status}${reason(text)}`);
      const body = asObject(parseJson(text, "Linear token"), "Linear token");
      return asString(body.access_token, "Linear token.access_token");
    },

    /**
     * Revokes a token. Linear answers 400 for one it can't revoke because it
     * is gone already, which is what was wanted.
     */
    async revoke(token: string): Promise<void> {
      const res = await post(REVOKE_URL, { token, token_type_hint: "access_token" });
      const text = await res.text();
      if (res.ok || res.status === 400) return;
      throw new Error(`Linear POST /oauth/revoke: HTTP ${res.status}${reason(text)}`);
    },
  };
}

/** Linear's OAuth error code, short, or nothing. */
function reason(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && typeof body.error === "string") return ` (${body.error.slice(0, 100)})`;
  } catch {
    // Not JSON: say nothing more.
  }
  return "";
}
