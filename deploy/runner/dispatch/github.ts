import {
  asArray,
  asNumber,
  asObject,
  asString,
  type Fetch,
  isRecord,
  parseJson,
} from "../lib/parse";
import type { Deployment, ReviewFacts } from "./select";

// The GitHub adapter for the Dispatcher, on `dkomeza/banki` with the Broker's
// installation token. It reads what the waits need (the PR, its push, and
// the Previews' deployments) and, for housekeeping, takes a Slug Preview
// down; and, for the Dashboard, the newest Previews' deployments. It reads
// no one's comments.

const API = "https://api.github.com";
const OWNER = "dkomeza";
const NAME = "banki";
const REPO = `${OWNER}/${NAME}`;

/** A Slug Preview's deployment, its Slug read from its payload as slug-preview.yml writes it. */
export type SlugDeployment = { id: number; slug: string; sha: string; createdAt: string };

/** The Previews' environments, which the pull agent claims deployments in. */
export const PREVIEW_ENVIRONMENTS = ["preview", "slug-preview"] as const;
export type PreviewEnvironment = (typeof PREVIEW_ENVIRONMENTS)[number];

/** A Preview's deployment, named by what it previews: its Slug, or `PR #<n>`. */
export type PreviewDeployment = {
  id: number;
  environment: PreviewEnvironment;
  name: string;
  createdAt: string;
};

/** A deployment's payload, which GitHub hands back as JSON or as a string of it. */
function payloadOf(deployment: Record<string, unknown>): Record<string, unknown> {
  let payload: unknown = deployment.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  return isRecord(payload) ? payload : {};
}

export type GitHub = ReturnType<typeof github>;

export function github(token: () => Promise<string>, options: { fetch?: Fetch } = {}) {
  const fetchFn: Fetch = options.fetch ?? fetch;

  async function call(method: string, url: string, body?: unknown): Promise<Response> {
    const res = await fetchFn(url.startsWith("https://") ? url : `${API}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "banki-runner",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${url.replace(API, "")}: HTTP ${res.status}`);
    return res;
  }
  const get = async (path: string) =>
    parseJson(await (await call("GET", path)).text(), `GitHub ${path}`);

  /** Every item of a paginated list, following the Link header. `at` picks the list out of a page. */
  async function pages(
    path: string,
    at: (page: unknown) => unknown = (page) => page,
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let url: string | undefined = path;
    while (url !== undefined) {
      const res = await call("GET", url);
      const page = parseJson(await res.text(), `GitHub ${path}`);
      items.push(...asArray(at(page), `GitHub ${path}`).filter(isRecord));
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
    }
    return items;
  }

  /** A deployment's newest status. */
  async function newestStatus(id: number): Promise<Deployment> {
    const statuses = asArray(
      await get(`/repos/${REPO}/deployments/${id}/statuses?per_page=1`),
      "statuses",
    );
    const newest = statuses.find(isRecord);
    if (newest === undefined) return { state: null, description: "", url: null };
    return {
      state: typeof newest.state === "string" ? newest.state : null,
      description: typeof newest.description === "string" ? newest.description : "",
      url:
        typeof newest.environment_url === "string" && newest.environment_url !== ""
          ? newest.environment_url
          : null,
    };
  }

  return {
    /** What the In Review waits read, on the branch's pull request. */
    async review(branch: string): Promise<ReviewFacts> {
      const pulls = asArray(
        await get(
          `/repos/${REPO}/pulls?head=${encodeURIComponent(`${OWNER}:${branch}`)}&state=all&per_page=20`,
        ),
        "pulls",
      ).filter(isRecord);
      const pull = pulls.find((found) => found.state === "open") ?? pulls[0];
      const empty: ReviewFacts = { pr: null, pushedAt: null, preview: null };
      if (pull === undefined) return empty;
      const number = asNumber(pull.number, "pull.number");
      const headSha = asString(asObject(pull.head, "pull.head").sha, "pull.head.sha");
      const pr = {
        number,
        headSha,
        open: pull.state === "open",
        createdAt: asString(pull.created_at, "pull.created_at"),
      };
      if (!pr.open) return { ...empty, pr };

      const suites = (
        await pages(
          `/repos/${REPO}/commits/${headSha}/check-suites?per_page=100`,
          (page) => asObject(page, "check-suites").check_suites,
        )
      )
        .filter(fromActions)
        .map((suite) => asString(suite.created_at, "check_suite.created_at"))
        .toSorted();
      const deployments = (
        await pages(`/repos/${REPO}/deployments?environment=preview&sha=${headSha}&per_page=100`)
      ).toSorted(
        (a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id) - Number(a.id),
      );
      const newest = deployments[0];

      return {
        pr,
        pushedAt: suites[0] ?? null,
        preview:
          newest === undefined
            ? null
            : {
                ...(await newestStatus(asNumber(newest.id, "deployment.id"))),
                createdAt: asString(newest.created_at, "deployment.created_at"),
              },
      };
    },

    /** Every `slug-preview` deployment with a Slug in its payload. */
    async slugDeployments(): Promise<SlugDeployment[]> {
      const deployments = await pages(
        `/repos/${REPO}/deployments?environment=slug-preview&per_page=100`,
      );
      return deployments.flatMap((deployment) => {
        const payload = payloadOf(deployment);
        if (typeof payload.slug !== "string") return [];
        return [
          {
            id: asNumber(deployment.id, "deployment.id"),
            slug: payload.slug,
            sha: asString(deployment.sha, "deployment.sha"),
            createdAt: asString(deployment.created_at, "deployment.created_at"),
          },
        ];
      });
    },

    newestStatus,

    /** An environment's newest 100 deployments, newest first, each named by its payload. */
    async recentDeployments(environment: PreviewEnvironment): Promise<PreviewDeployment[]> {
      const deployments = asArray(
        await get(`/repos/${REPO}/deployments?environment=${environment}&per_page=100`),
        "deployments",
      ).filter(isRecord);
      return deployments.flatMap((deployment) => {
        const payload = payloadOf(deployment);
        const name =
          typeof payload.slug === "string"
            ? payload.slug
            : typeof payload.pr === "number"
              ? `PR #${payload.pr}`
              : undefined;
        if (name === undefined) return [];
        return [
          {
            id: asNumber(deployment.id, "deployment.id"),
            environment,
            name,
            createdAt: asString(deployment.created_at, "deployment.created_at"),
          },
        ];
      });
    },

    /** Asks slug-preview.yml, from `main`, to deploy `branch`'s head as a Slug Preview again, for the design Stage's 336 hours. */
    async deploySlug(branch: string, slug: string): Promise<void> {
      await call("POST", `/repos/${REPO}/actions/workflows/slug-preview.yml/dispatches`, {
        ref: "main",
        inputs: { branch, slug, ttl_hours: "336" },
      });
    },

    /** Asks slug-preview.yml, from `main`, to take a Slug Preview down. */
    async takeDown(slug: string): Promise<void> {
      await call("POST", `/repos/${REPO}/actions/workflows/slug-preview.yml/dispatches`, {
        ref: "main",
        inputs: { slug, down: "true" },
      });
    },

    /** The commit at the tip of origin's `branch`, or undefined when it has none. */
    async branchHead(branch: string): Promise<string | undefined> {
      const res = await fetchFn(`${API}/repos/${REPO}/branches/${encodeURIComponent(branch)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await token()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "banki-runner",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`GitHub GET /repos/${REPO}/branches/…: HTTP ${res.status}`);
      const body = asObject(parseJson(await res.text(), "GitHub branch"), "branch");
      return asString(asObject(body.commit, "branch.commit").sha, "branch.commit.sha");
    },

    /** Every branch's name on origin. */
    async branches(): Promise<string[]> {
      return (await pages(`/repos/${REPO}/branches?per_page=100`)).map((branch) =>
        asString(branch.name, "branch.name"),
      );
    },

    /** The open or newest pull request's number for a branch, for housekeeping. */
    async pullNumber(branch: string): Promise<number | undefined> {
      const pulls = asArray(
        await get(
          `/repos/${REPO}/pulls?head=${encodeURIComponent(`${OWNER}:${branch}`)}&state=all&per_page=1`,
        ),
        "pulls",
      ).filter(isRecord);
      return typeof pulls[0]?.number === "number" ? pulls[0].number : undefined;
    },
  };
}

// Only GitHub Actions' check suites date a push: anyone's app can add one.
const fromActions = (item: Record<string, unknown>) =>
  isRecord(item.app) && item.app.slug === "github-actions";

/** A Slug's newest deployment, of those given, at `sha` when one is named. */
export function newestFor(
  deployments: readonly SlugDeployment[],
  slug: string,
  sha?: string,
): SlugDeployment | undefined {
  return deployments
    .filter(
      (deployment) => deployment.slug === slug && (sha === undefined || deployment.sha === sha),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)[0];
}
