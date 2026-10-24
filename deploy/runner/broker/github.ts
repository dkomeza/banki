import { asNumber, asObject, asString, type Fetch, isRecord, parseJson } from "../lib/parse";
import { appJwt } from "./jwt";
import { UPSTREAM_TIMEOUT_MS } from "./timeouts";
import type { ExpiringToken } from "./token-cache";

// The GitHub adapter (ADR-0012). The broker signs App JWTs with the App's key,
// finds the App's installation on the repo itself, and mints installation
// tokens limited to that one repo, with the App's own permissions. Its errors
// carry the method, the path, the status and GitHub's own message, never a
// JWT or a token.

const API = "https://api.github.com";
export const REPO = "dkomeza/banki";

export type GitHubApp = ReturnType<typeof gitHubApp>;

/** The bot commits are authored as: `<slug>[bot]` with its noreply email. */
export type Identity = { name: string; email: string };

export function gitHubApp(options: {
  appId: string;
  key: CryptoKey;
  fetch?: Fetch;
  now?: () => Date;
}) {
  const { appId, key } = options;
  const fetchFn: Fetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  async function call(method: string, path: string, auth: string, body?: unknown) {
    const res = await fetchFn(`${API}${path}`, {
      method,
      headers: {
        Authorization: auth,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "banki-runner-broker",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status}${reason(text)}`);
    return parseJson(text, `GitHub ${method} ${path}`);
  }

  const asApp = async (method: string, path: string, body?: unknown) =>
    call(method, path, `Bearer ${await appJwt(appId, key, now())}`, body);

  let installationId: number | undefined;
  let identity: Identity | undefined;

  return {
    /** A new installation token for the repo alone, with every permission the App has. */
    async mintToken(): Promise<ExpiringToken> {
      installationId ??= asNumber(
        asObject(await asApp("GET", `/repos/${REPO}/installation`), "installation").id,
        "installation.id",
      );
      try {
        const created = asObject(
          await asApp("POST", `/app/installations/${installationId}/access_tokens`, {
            repositories: [REPO.split("/")[1]],
          }),
          "access token",
        );
        return {
          token: asString(created.token, "access token.token"),
          expiresAt: new Date(asString(created.expires_at, "access token.expires_at")),
        };
      } catch (error) {
        // Reinstalling the App gives it a new installation: look it up again next time.
        installationId = undefined;
        throw error;
      }
    },

    /** Who the App's commits are from, looked up once, with an installation token. */
    async identity(token: string): Promise<Identity> {
      if (identity !== undefined) return identity;
      const slug = asString(asObject(await asApp("GET", "/app"), "app").slug, "app.slug");
      const login = `${slug}[bot]`;
      const user = asObject(
        await call("GET", `/users/${encodeURIComponent(login)}`, `Bearer ${token}`),
        "user",
      );
      const id = asNumber(user.id, "user.id");
      identity = { name: login, email: `${id}+${login}@users.noreply.github.com` };
      return identity;
    },
  };
}

/** GitHub's own error message, short, or nothing. */
function reason(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && typeof body.message === "string") {
      return ` (${body.message.slice(0, 200)})`;
    }
  } catch {
    // Not JSON: say nothing more.
  }
  return "";
}
