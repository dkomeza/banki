import {
  asArray,
  asNumber,
  asObject,
  asString,
  type Fetch,
  isRecord,
  parseJson,
} from "../lib/parse";
import {
  ACTIONS_APP,
  CLAUDE_REVIEW_CHECK,
  parseSummary,
  startedByClaudeReview,
  SUMMARY_AUTHOR,
  SUMMARY_MARKER,
} from "./review";
import type { Deployment, ReviewFacts } from "./select";

// The GitHub adapter for the Dispatcher, on `dkomeza/banki` with the Broker's
// installation token. It reads what the waits need (the PR, `claude-review`'s
// check, summary and threads, and the Previews' deployments) and, for
// housekeeping, takes a Slug Preview down. It trusts `claude-review` alone
// (review.ts), never anyone's comments.

const API = "https://api.github.com";
const OWNER = "dkomeza";
const NAME = "banki";
const REPO = `${OWNER}/${NAME}`;

/** A Slug Preview's deployment, its Slug read from its payload as slug-preview.yml writes it. */
export type SlugDeployment = { id: number; slug: string; sha: string; createdAt: string };

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

  async function graphql(query: string, variables: Record<string, unknown>) {
    const res = await call("POST", "/graphql", { query, variables });
    const body = asObject(parseJson(await res.text(), "GitHub GraphQL"), "GitHub GraphQL");
    if (body.errors !== undefined)
      throw new Error(`GitHub GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`);
    return asObject(body.data, "GitHub GraphQL data");
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

  async function unresolvedThreads(pr: number): Promise<number> {
    let count = 0;
    let after: string | null = null;
    for (;;) {
      const data = await graphql(
        `
          query ($owner: String!, $name: String!, $pr: Int!, $after: String) {
            repository(owner: $owner, name: $name) {
              pullRequest(number: $pr) {
                reviewThreads(first: 100, after: $after) {
                  nodes {
                    isResolved
                    comments(first: 1) {
                      nodes {
                        author {
                          login
                          kind: __typename
                        }
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
          }
        `,
        { owner: OWNER, name: NAME, pr, after },
      );
      const threads = asObject(
        asObject(asObject(data.repository, "repository").pullRequest, "pullRequest").reviewThreads,
        "reviewThreads",
      );
      for (const thread of asArray(threads.nodes, "reviewThreads.nodes").filter(isRecord)) {
        const first =
          isRecord(thread.comments) && Array.isArray(thread.comments.nodes)
            ? thread.comments.nodes[0]
            : undefined;
        if (
          thread.isResolved !== true &&
          isRecord(first) &&
          startedByClaudeReview(isRecord(first.author) ? first.author : null)
        ) {
          count += 1;
        }
      }
      const info = asObject(threads.pageInfo, "pageInfo");
      if (info.hasNextPage !== true) return count;
      after = asString(info.endCursor, "pageInfo.endCursor");
    }
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
      const empty: ReviewFacts = {
        pr: null,
        pushedAt: null,
        check: null,
        summary: null,
        openThreads: 0,
        preview: null,
      };
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
      const runs = (
        await pages(
          `/repos/${REPO}/commits/${headSha}/check-runs?check_name=${CLAUDE_REVIEW_CHECK}&per_page=100`,
          (page) => asObject(page, "check-runs").check_runs,
        )
      )
        .filter(fromActions)
        .toSorted((a, b) => asNumber(b.id, "check_run.id") - asNumber(a.id, "check_run.id"));
      const run = runs[0];

      const summaryComment = (
        await pages(`/repos/${REPO}/issues/${number}/comments?per_page=100`)
      ).find(
        (comment) =>
          isRecord(comment.user) &&
          comment.user.login === SUMMARY_AUTHOR &&
          comment.user.type === "Bot" &&
          typeof comment.body === "string" &&
          comment.body.startsWith(SUMMARY_MARKER),
      );

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
        check:
          run === undefined
            ? null
            : {
                status: String(run.status),
                conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
              },
        summary:
          typeof summaryComment?.body === "string"
            ? (parseSummary(summaryComment.body) ?? null)
            : null,
        openThreads: await unresolvedThreads(number),
        preview:
          newest === undefined ? null : await newestStatus(asNumber(newest.id, "deployment.id")),
      };
    },

    /** Every `slug-preview` deployment with a Slug in its payload. */
    async slugDeployments(): Promise<SlugDeployment[]> {
      const deployments = await pages(
        `/repos/${REPO}/deployments?environment=slug-preview&per_page=100`,
      );
      return deployments.flatMap((deployment) => {
        let payload: unknown = deployment.payload;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = {};
          }
        }
        if (!isRecord(payload) || typeof payload.slug !== "string") return [];
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

const fromActions = (item: Record<string, unknown>) =>
  isRecord(item.app) && item.app.slug === ACTIONS_APP;

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
