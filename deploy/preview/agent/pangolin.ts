import { PREVIEW_DOMAIN, previewHost, projectName, webContainerName } from "./naming";
import { asArray, asNumber, asObject, asString, parseJson } from "./parse";
import { ownedResources, type PangolinResource } from "./planner";

// The Pangolin adapter, on the Integration API (`/v1`, Community edition),
// with the org API key. Every response is wrapped as
// `{ data, success, error, message, status }`.

const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
// A guard against a server that never stops paging.
const MAX_PAGES = 50;

export class PangolinError extends Error {
  override name = "PangolinError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Pangolin = Awaited<ReturnType<typeof pangolin>>;

/**
 * Connects to the org and resolves the Previews site's numeric ID (from its
 * niceId) and the ID of the `banki.dkomeza.com` domain. Throws when either
 * is missing, so the agent can stop with a clear error on start.
 */
export async function pangolin(options: {
  apiUrl: string;
  apiKey: string;
  orgId: string;
  siteNiceId: string;
}) {
  // The Integration API's URL, with or without its /v1.
  const trimmed = options.apiUrl.replace(/\/+$/, "");
  const base = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
  const org = `/org/${encodeURIComponent(options.orgId)}`;

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new PangolinError(
        `Pangolin ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`,
        res.status,
      );
    }
    const wrapped = asObject(parseJson(text, `Pangolin ${path}`), `Pangolin ${path}`);
    if (wrapped.success === false) {
      throw new PangolinError(`Pangolin ${method} ${path}: ${String(wrapped.message)}`, res.status);
    }
    return wrapped.data;
  }

  let siteId: number;
  try {
    const site = asObject(
      await call("GET", `${org}/site/${encodeURIComponent(options.siteNiceId)}`),
      "site",
    );
    siteId = asNumber(site.siteId, "site.siteId");
  } catch (error) {
    throw new Error(
      `Can't find the Previews site "${options.siteNiceId}" in org "${options.orgId}": ${message(error)}`,
      { cause: error },
    );
  }

  const domains = asArray(
    asObject(await call("GET", `${org}/domains`), "domains").domains,
    "domains.domains",
  );
  const domain = domains
    .map((value) => asObject(value, "domain"))
    .find((value) => value.baseDomain === PREVIEW_DOMAIN);
  if (domain === undefined) {
    throw new Error(`Pangolin org "${options.orgId}" has no domain ${PREVIEW_DOMAIN}`);
  }
  const domainId = asString(domain.domainId, "domain.domainId");

  async function deleteResource(resourceId: number): Promise<void> {
    try {
      await call("DELETE", `/public-resource/${resourceId}`);
    } catch (error) {
      // Already gone.
      if (error instanceof PangolinError && error.status === 404) return;
      throw error;
    }
  }

  async function resources(): Promise<PangolinResource[]> {
    const found: PangolinResource[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = asObject(
        await call(
          "GET",
          `${org}/public-resources?siteId=${siteId}&page=${page}&pageSize=${PAGE_SIZE}`,
        ),
        "resources",
      );
      const batch = asArray(data.resources, "resources.resources").map(parseResource);
      found.push(...batch);
      const pagination = asObject(data.pagination, "resources.pagination");
      const total = asNumber(pagination.total, "pagination.total");
      const pageSize = asNumber(pagination.pageSize, "pagination.pageSize");
      if (batch.length === 0 || page * pageSize >= total) break;
    }
    return found;
  }

  return {
    siteId,

    /** The resources on the Previews site; the planner decides which it owns. */
    resources,

    /**
     * Creates PR `<pr>`'s resource unless an owned one exists: HTTP to
     * `banki-pr-<N>-web-1:8080` on the Previews site, with SSO off (the
     * Preview's User is the only gate). A half-made resource is deleted again.
     */
    async createOrKeep(pr: number): Promise<void> {
      const host = previewHost(pr);
      if (ownedResources(await resources(), siteId).some((resource) => resource.pr === pr)) return;

      let resourceId: number;
      try {
        const created = asObject(
          await call("PUT", `${org}/public-resource`, {
            name: projectName(pr),
            mode: "http",
            domainId,
            subdomain: `pr-${pr}`,
          }),
          "resource",
        );
        resourceId = asNumber(created.resourceId, "resource.resourceId");
      } catch (error) {
        if (error instanceof PangolinError && error.status === 409) {
          throw new Error(`${host} is taken by a Pangolin resource the agent doesn't own`, {
            cause: error,
          });
        }
        throw error;
      }
      try {
        // Every new resource starts with SSO on.
        await call("POST", `/public-resource/${resourceId}`, { sso: false });
        // Without `method`, Newt silently drops the target.
        await call("PUT", `/public-resource/${resourceId}/target`, {
          siteId,
          ip: webContainerName(pr),
          port: 8080,
          method: "http",
        });
      } catch (error) {
        await deleteResource(resourceId).catch(() => undefined);
        throw error;
      }
    },

    deleteResource,
  };
}

/** The `siteId`s in a resource's `sites` or `targets`. */
const siteIdsOf = (list: unknown, at: string): number[] =>
  list === undefined || list === null
    ? []
    : asArray(list, at).flatMap((item) => {
        const siteId = asObject(item, at).siteId;
        return typeof siteId === "number" ? [siteId] : [];
      });

function parseResource(value: unknown): PangolinResource {
  const resource = asObject(value, "resource");
  return {
    resourceId: asNumber(resource.resourceId, "resource.resourceId"),
    fullDomain: typeof resource.fullDomain === "string" ? resource.fullDomain : "",
    siteIds: [
      ...new Set([
        ...siteIdsOf(resource.sites, "resource.sites"),
        ...siteIdsOf(resource.targets, "resource.targets"),
      ]),
    ],
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
