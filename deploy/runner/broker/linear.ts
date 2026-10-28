import { asObject, asString, type Fetch, isRecord, parseJson } from "../lib/parse";
import { UPSTREAM_TIMEOUT_MS } from "./timeouts";

// The Linear adapter (ADR-0012). The Runner is a Linear OAuth app acting as
// itself (`actor=app`), and the broker mints its tokens with the
// client-credentials grant only: Linear doesn't let an app mix grants and
// still hold several `app` tokens at once. Every token asks for the same
// scopes, `read,write`: a token with other scopes would revoke all the rest.

const TOKEN_URL = "https://api.linear.app/oauth/token";
const REVOKE_URL = "https://api.linear.app/oauth/revoke";
const GRAPHQL_URL = "https://api.linear.app/graphql";
export const SCOPES = "read,write";

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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  }

  /**
   * Whether a token still authenticates: false when Linear refuses it (401,
   * or GraphQL's authentication error), true when it answers, undefined when
   * the answer says neither.
   */
  async function stillWorks(token: string): Promise<boolean | undefined> {
    let res: Response;
    try {
      res = await fetchFn(GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "banki-runner-broker",
        },
        body: JSON.stringify({ query: "{ viewer { id } }" }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return undefined;
    }
    if (res.status === 401) return false;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return undefined;
    }
    if (isRecord(body) && Array.isArray(body.errors)) {
      const unauthenticated = body.errors.some(
        (error: unknown) =>
          isRecord(error) &&
          isRecord(error.extensions) &&
          error.extensions.code === "AUTHENTICATION_ERROR",
      );
      if (unauthenticated) return false;
    }
    if (res.ok && isRecord(body) && isRecord(body.data) && isRecord(body.data.viewer)) return true;
    return undefined;
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
     * Revokes a token, or throws, leaving it for the sweep to try again. It
     * is done on a 2xx, or on a 400 or 401 after which the token no longer
     * authenticates: Linear answers either for a token it has revoked
     * already (it revokes some under their holder, seemingly when two mints
     * come at the same moment), but a 400 also for a request it can't read,
     * which revokes nothing. The token goes first as its own Bearer authorization, then, if
     * a refusal leaves it working, in the form as RFC 7009 has it.
     */
    async revoke(token: string): Promise<void> {
      const attempts = [
        () => post(REVOKE_URL, {}, `Bearer ${token}`),
        () => post(REVOKE_URL, { token, token_type_hint: "access_token" }),
      ];
      let refused = "";
      for (const attempt of attempts) {
        const res = await attempt();
        const text = await res.text();
        if (res.ok) return;
        refused = `Linear POST /oauth/revoke: HTTP ${res.status}${reason(text)}`;
        if (res.status !== 400 && res.status !== 401) throw new Error(refused);
        const works = await stillWorks(token);
        if (works === false) return;
        if (works === undefined) {
          throw new Error(`${refused}, and Linear couldn't say whether the token still works`);
        }
      }
      throw new Error(`${refused}, and the token still works`);
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
