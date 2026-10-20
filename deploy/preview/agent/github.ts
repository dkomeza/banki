import { ENVIRONMENT, REPO } from "./naming";
import { asArray, asNumber, asObject, asOptionalString, asString, parseJson } from "./parse";
import {
  type Deployment,
  type DeploymentStatus,
  type PullRequest,
  readEnoughDeployments,
} from "./planner";

// The GitHub adapter. Every call uses the token: the anonymous limit of 60
// calls an hour is less than one poll every 30 s needs. The token is a
// fine-grained one for this repo with Deployments write, which can always read
// the public repo.

const API = "https://api.github.com";
/** A backstop on paging the Deployments: 2000 of them. */
const MAX_DEPLOYMENT_PAGES = 20;
const TIMEOUT_MS = 30_000;
const [OWNER = "", NAME = ""] = REPO.split("/");

export type GitHub = ReturnType<typeof gitHub>;

export function gitHub(token: string) {
  async function call(method: string, url: string, body?: unknown): Promise<Response> {
    const res = await fetch(url.startsWith("https://") ? url : `${API}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "banki-preview-agent",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `GitHub ${method} ${url}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    return res;
  }

  const json = async (method: string, url: string, body?: unknown) => {
    const res = await call(method, url, body);
    return parseJson(await res.text(), `GitHub ${method} ${url}`);
  };

  return {
    /** Every open pull request, targets or not: the planner picks the targets. */
    async openPullRequests(): Promise<PullRequest[]> {
      const pulls: PullRequest[] = [];
      let url: string | undefined = `/repos/${REPO}/pulls?state=open&per_page=100`;
      while (url !== undefined) {
        const res = await call("GET", url);
        const page = asArray(parseJson(await res.text(), "pulls"), "pulls");
        pulls.push(...page.map(parsePullRequest));
        url = nextPage(res.headers.get("link"));
      }
      return pulls;
    },

    /**
     * The `preview` Deployments with their latest statuses, newest first: as
     * far back as the planner needs (see {@link readEnoughDeployments}), or
     * all of them, up to the page cap, when `full`.
     * GraphQL gets them with their statuses 100 at a time; REST would need one
     * call per Deployment.
     */
    async previewDeployments(
      pullRequests: PullRequest[],
      { full }: { full: boolean },
    ): Promise<Deployment[]> {
      const deployments: Deployment[] = [];
      let after: string | null = null;
      for (let page = 1; page <= MAX_DEPLOYMENT_PAGES; page++) {
        const body = asObject(
          await json("POST", "/graphql", {
            query: DEPLOYMENTS_QUERY,
            variables: { owner: OWNER, name: NAME, environment: ENVIRONMENT, after },
          }),
          "graphql",
        );
        if (body.errors !== undefined) {
          throw new Error(`GitHub GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`);
        }
        const connection = asObject(
          asObject(asObject(body.data, "data").repository, "repository").deployments,
          "deployments",
        );
        const batch = asArray(connection.nodes, "deployments.nodes").flatMap(
          (node) => parseDeployment(node) ?? [],
        );
        deployments.push(...batch);
        const pageInfo = asObject(connection.pageInfo, "pageInfo");
        if (pageInfo.hasNextPage !== true) return deployments;
        if (!full && readEnoughDeployments(pullRequests, deployments, batch)) return deployments;
        after = asString(pageInfo.endCursor, "pageInfo.endCursor");
      }
      console.warn(
        `Read the newest ${MAX_DEPLOYMENT_PAGES * 100} preview Deployments and stopped there: older ones aren't planned for`,
      );
      return deployments;
    },

    /** A Deployment of `sha` for PR `pr`; its ID. */
    async createDeployment(pr: number, sha: string): Promise<number> {
      const created = asObject(
        await json("POST", `/repos/${REPO}/deployments`, {
          ref: sha,
          environment: ENVIRONMENT,
          payload: { pr },
          description: `Preview of PR #${pr}`,
          required_contexts: [],
          auto_merge: false,
          transient_environment: true,
        }),
        "deployment",
      );
      return asNumber(created.id, "deployment.id");
    },

    async setStatus(
      deploymentId: number,
      state: "queued" | "in_progress" | "success" | "failure" | "inactive",
      description: string,
      environmentUrl?: string,
    ): Promise<void> {
      await call("POST", `/repos/${REPO}/deployments/${deploymentId}/statuses`, {
        state,
        // GitHub's limit.
        description: description.slice(0, 140),
        ...(environmentUrl === undefined ? {} : { environment_url: environmentUrl }),
        // Otherwise a success marks every other PR's Preview inactive, since
        // they share the environment. The agent marks a PR's older ones itself.
        auto_inactive: false,
      });
    },
  };
}

const DEPLOYMENTS_QUERY = `
query ($owner: String!, $name: String!, $environment: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    deployments(environments: [$environment], first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { databaseId commitOid createdAt payload latestStatus { state description } }
    }
  }
}`;

function parsePullRequest(value: unknown): PullRequest {
  const pull = asObject(value, "pull");
  const head = asObject(pull.head, "pull.head");
  const repo = head.repo === null ? undefined : asObject(head.repo, "pull.head.repo");
  return {
    number: asNumber(pull.number, "pull.number"),
    headSha: asString(head.sha, "pull.head.sha"),
    headRepo: repo === undefined ? undefined : asString(repo.full_name, "pull.head.repo.full_name"),
    author: asString(asObject(pull.user, "pull.user").login, "pull.user.login"),
  };
}

const STATUSES: Record<string, DeploymentStatus> = {
  PENDING: "pending",
  WAITING: "pending",
  QUEUED: "queued",
  IN_PROGRESS: "in_progress",
  SUCCESS: "success",
  FAILURE: "failure",
  ERROR: "error",
  INACTIVE: "inactive",
};

/** A Deployment with a `payload.pr`, or undefined for any other: those aren't the agent's. */
function parseDeployment(value: unknown): Deployment | undefined {
  const node = asObject(value, "deployment");
  const pr = prOfPayload(node.payload);
  if (pr === undefined) return undefined;
  const latest =
    node.latestStatus === null ? undefined : asObject(node.latestStatus, "latestStatus");
  const state = latest === undefined ? undefined : asString(latest.state, "latestStatus.state");
  return {
    id: asNumber(node.databaseId, "deployment.databaseId"),
    pr,
    sha: asString(node.commitOid, "deployment.commitOid"),
    createdAt: new Date(asString(node.createdAt, "deployment.createdAt")),
    // An unknown state is left to the next push, like a failure.
    status: state === undefined ? undefined : (STATUSES[state] ?? "error"),
    // Says whether an inactive one was evicted or went idle (see the planner).
    description:
      latest === undefined
        ? undefined
        : asOptionalString(latest.description, "latestStatus.description"),
  };
}

/** GraphQL gives the payload as a JSON string. */
function prOfPayload(payload: unknown): number | undefined {
  let parsed: unknown = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return undefined;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const pr = (parsed as { pr?: unknown }).pr;
  return typeof pr === "number" && Number.isInteger(pr) && pr > 0 ? pr : undefined;
}

/** The `rel="next"` URL of a Link header. */
function nextPage(link: string | null): string | undefined {
  for (const part of link?.split(",") ?? []) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}
