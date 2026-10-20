// The names a Preview goes by, in Docker, GHCR, Pangolin and GitHub. Each one
// is built here and parsed back here, so the two can't drift apart.

/** The repo whose pull requests get Previews. */
export const REPO = "dkomeza/banki";

/** Previews live at `pr-<N>.` under this domain (ADR-0008). */
export const PREVIEW_DOMAIN = "banki.dkomeza.com";

/** The GitHub Deployments environment every Preview reports to. */
export const ENVIRONMENT = "preview";

/** The GHCR packages CI pushes, under `ghcr.io/<owner>/`. */
export const IMAGES = { api: "dkomeza/banki-api", web: "dkomeza/banki-web" } as const;

/** The labels the Preview template puts on every object of a project. */
export const LABELS = {
  pr: "banki.preview.pr",
  sha: "banki.preview.sha",
  deployedAt: "banki.preview.deployed-at",
  apiDigest: "banki.preview.api-digest",
  webDigest: "banki.preview.web-digest",
} as const;

const POSITIVE_INT = "[1-9][0-9]*";

export const projectName = (pr: number) => `banki-pr-${pr}`;

/** The PR number of a Compose project named `banki-pr-<N>`, or undefined for any other name. */
export function prFromProjectName(name: string): number | undefined {
  const match = new RegExp(`^banki-pr-(${POSITIVE_INT})$`).exec(name);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export const previewHost = (pr: number) => `pr-${pr}.${PREVIEW_DOMAIN}`;

export const previewUrl = (pr: number) => `https://${previewHost(pr)}`;

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
 * The tag both images of PR `<N>`'s push of `<sha>` carry. Only PR `<N>` ever
 * pushes it; the shared `sha-<sha>` tag can belong to another PR on the same
 * commit, whose cleanup deletes it.
 */
export const imageTag = (pr: number, sha: string) => `pr-${pr}-${sha}`;

/** The name Compose gives a Preview's `web` container, which Newt reaches on `banki-previews`. */
export const webContainerName = (pr: number) => `${projectName(pr)}-web-1`;

export const shortSha = (sha: string) => sha.slice(0, 7);
