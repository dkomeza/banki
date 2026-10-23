// The names a Preview goes by, in Docker, GHCR, Pangolin and GitHub. Each one
// is built here and parsed back here, so the two can't drift apart.
//
// A Preview is keyed by its pull request's number (a PR Preview) or by its
// Slug (a Slug Preview, ADR-0011). A Slug always starts with a letter, so the
// two never collide, even as strings.

/** The repo whose pull requests and branches get Previews. */
export const REPO = "dkomeza/banki";

/** Previews live at `pr-<N>.` or `<slug>.` under this domain (ADR-0008, ADR-0011). */
export const PREVIEW_DOMAIN = "banki.dkomeza.com";

/** The GitHub Deployments environment every PR Preview reports to. */
export const ENVIRONMENT = "preview";

/** The GitHub Deployments environment of the Slug Previews, which the slug-preview workflow creates. */
export const SLUG_ENVIRONMENT = "slug-preview";

/** The GHCR packages CI pushes, under `ghcr.io/<owner>/`. */
export const IMAGES = { api: "dkomeza/banki-api", web: "dkomeza/banki-web" } as const;

/** The labels the Preview template puts on every object of a project. */
export const LABELS = {
  pr: "banki.preview.pr",
  slug: "banki.preview.slug",
  sha: "banki.preview.sha",
  deployedAt: "banki.preview.deployed-at",
  apiDigest: "banki.preview.api-digest",
  webDigest: "banki.preview.web-digest",
} as const;

/** A PR Preview's PR number, or a Slug Preview's Slug. */
export type PreviewKey = number | string;

/** The key of anything that names its Preview by `pr` or by `slug`: a project or an action. */
export const keyOf = (preview: { pr: number } | { slug: string }): PreviewKey =>
  "pr" in preview ? preview.pr : preview.slug;

/** Which pool a key's Preview is in, as the template's labels name it. */
export const poolOf = (key: PreviewKey): "pr" | "slug" => (typeof key === "number" ? "pr" : "slug");

const POSITIVE_INT = "[1-9][0-9]*";

/**
 * Names a Slug may not take: `<slug>.banki.dkomeza.com` shares its namespace
 * with the subdomains a production may need. The slug-preview workflow keeps
 * the same list.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "app",
  "admin",
  "auth",
  "mail",
  "status",
  "preview",
  "previews",
  "prod",
  "production",
  "staging",
  "banki",
]);

/** The shape of a Slug: 2 to 40 lowercase letters, digits and single hyphens, from a letter to a letter or digit. */
const SLUG_SHAPE = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;

/**
 * Whether `slug` may be a Slug: the pattern, no `--`, not `pr-…` (a PR
 * Preview's host) and not reserved. The slug-preview workflow checks the same.
 */
export const isSlug = (slug: string) =>
  SLUG_SHAPE.test(slug) &&
  !slug.includes("--") &&
  !slug.startsWith("pr-") &&
  !RESERVED_SLUGS.has(slug);

export const projectName = (key: PreviewKey) =>
  typeof key === "number" ? `banki-pr-${key}` : `banki-slug-${key}`;

/** The PR number of a Compose project named `banki-pr-<N>`, or undefined for any other name. */
export function prFromProjectName(name: string): number | undefined {
  const match = new RegExp(`^banki-pr-(${POSITIVE_INT})$`).exec(name);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The Slug of a Compose project named `banki-slug-<slug>`, or undefined for any other name. */
export function slugFromProjectName(name: string): string | undefined {
  const slug = name.startsWith("banki-slug-") ? name.slice("banki-slug-".length) : undefined;
  return slug !== undefined && isSlug(slug) ? slug : undefined;
}

/** The Preview's subdomain under {@link PREVIEW_DOMAIN}: `pr-<N>` or the Slug. */
export const previewSubdomain = (key: PreviewKey) => (typeof key === "number" ? `pr-${key}` : key);

export const previewHost = (key: PreviewKey) => `${previewSubdomain(key)}.${PREVIEW_DOMAIN}`;

export const previewUrl = (key: PreviewKey) => `https://${previewHost(key)}`;

/**
 * The PR number of a Preview's exact host name, `pr-<N>.banki.dkomeza.com`, or
 * undefined for any other: `pr-05.…`, `x.pr-5.…` and `pr-5.….evil` included.
 */
export function prFromHost(host: string): number | undefined {
  const match = new RegExp(`^pr-(${POSITIVE_INT})\\.`).exec(host);
  if (match?.[1] === undefined) return undefined;
  const pr = Number(match[1]);
  return host === previewHost(pr) ? pr : undefined;
}

/**
 * The Slug of a Slug Preview's exact host name, `<slug>.banki.dkomeza.com`
 * for a valid Slug, or undefined for any other: a PR Preview's host, a
 * reserved name, `x.<slug>.…` and `<slug>.….evil` included.
 */
export function slugFromHost(host: string): string | undefined {
  const suffix = `.${PREVIEW_DOMAIN}`;
  if (!host.endsWith(suffix)) return undefined;
  const slug = host.slice(0, -suffix.length);
  return isSlug(slug) ? slug : undefined;
}

/**
 * The tag both images of a Preview's commit carry. PR `<N>`'s push of `<sha>`
 * is `pr-<N>-<sha>`: only PR `<N>` ever pushes it, while the shared
 * `sha-<sha>` tag can belong to another PR on the same commit, whose cleanup
 * deletes it. A Slug Preview's build is `slug-<slug>-<sha>`, the only tag the
 * slug-preview workflow pushes.
 */
export const imageTag = (key: PreviewKey, sha: string) =>
  typeof key === "number" ? `pr-${key}-${sha}` : `slug-${key}-${sha}`;

/** The name Compose gives a Preview's `web` container, which Newt reaches on `banki-previews`. */
export const webContainerName = (key: PreviewKey) => `${projectName(key)}-web-1`;

export const shortSha = (sha: string) => sha.slice(0, 7);
