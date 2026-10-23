import { IMAGES, imageTag, type PreviewKey, projectName, shortSha } from "./naming";
import { asObject, asString, parseJson } from "./parse";
import type { ImageDigests } from "./planner";

// The GHCR adapter: whether CI has pushed both images of a Preview's commit, and
// their digests. Reads are anonymous (the packages are public): a pull token
// from the registry's token endpoint, then a manifest HEAD, whose
// Docker-Content-Digest the Preview then pulls by.

const REGISTRY = "https://ghcr.io";
const TIMEOUT_MS = 30_000;

// A plain image per push (provenance off), but accept whatever CI stored.
const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * Both images' digests for `pr-<N>-<sha>` or `slug-<slug>-<sha>`, or
 * undefined when GHCR answered that either is missing (a 404). Any other
 * failure throws, also when one image is missing and the other's lookup
 * failed: only an answer confirms an image missing.
 */
export async function resolveDigests(
  key: PreviewKey,
  sha: string,
): Promise<ImageDigests | undefined> {
  const tag = imageTag(key, sha);
  const [api, web] = await Promise.all([digestOf(IMAGES.api, tag), digestOf(IMAGES.web, tag)]);
  return api === undefined || web === undefined ? undefined : { api, web };
}

async function digestOf(repository: string, tag: string): Promise<string | undefined> {
  const tokenRes = await fetch(
    `${REGISTRY}/token?service=ghcr.io&scope=repository:${repository}:pull`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!tokenRes.ok) throw new Error(`GHCR token for ${repository}: HTTP ${tokenRes.status}`);
  const token = asString(
    asObject(parseJson(await tokenRes.text(), "GHCR token"), "GHCR token").token,
    "GHCR token.token",
  );

  const res = await fetch(`${REGISTRY}/v2/${repository}/manifests/${tag}`, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_TYPES },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return undefined;
  if (res.status === 401 || res.status === 403) {
    throw new Error(`GHCR ${repository}:${tag}: HTTP ${res.status}. Is the package public?`);
  }
  if (!res.ok) throw new Error(`GHCR ${repository}:${tag}: HTTP ${res.status}`);
  const digest = res.headers.get("docker-content-digest");
  if (digest === null || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`GHCR ${repository}:${tag}: no valid Docker-Content-Digest`);
  }
  return digest;
}

/**
 * A build's images, as the planners take them: both digests, `missing` when
 * GHCR answered that either isn't there, or `failed` when it couldn't be
 * asked. Only the slug pool tells the last two apart, since only it times a
 * missing build out. One Preview's lookup failing leaves only that Preview
 * waiting, not every other.
 */
export async function lookUp(
  key: PreviewKey,
  sha: string,
  resolve: typeof resolveDigests = resolveDigests,
): Promise<{ digests: ImageDigests } | "missing" | "failed"> {
  try {
    const digests = await resolve(key, sha);
    return digests === undefined ? "missing" : { digests };
  } catch (error) {
    console.error(
      `${projectName(key)}: couldn't look up the images of ${shortSha(sha)}, so they count as not ready: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "failed";
  }
}
