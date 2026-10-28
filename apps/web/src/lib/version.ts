import { HealthResponse } from "@banki/shared";
import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { ApiRequestError } from "./query";

/** The upstream repo, whose Releases and commits the version links to. */
const REPO_URL = "https://github.com/dkomeza/banki";

/** The build the API runs, from the public `GET /api/health`. */
export const healthQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await client.api.health.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return HealthResponse.parse(await res.json());
    },
  });

/** The version as Settings shows it, and where it links, if anywhere. */
export type VersionLabel = { text: string; href: string | undefined };

/**
 * How Settings shows the version (ADR-0017): a Release (Production) as its
 * number, linking to its notes; any other build with a commit (Edge and the
 * Previews) with its short commit, linking to it; a build with no commit as
 * `+dev`, linking nowhere.
 */
export function versionLabel({
  version,
  commit,
  release,
}: Pick<HealthResponse, "version" | "commit" | "release">): VersionLabel {
  if (release) {
    return { text: version, href: `${REPO_URL}/releases/tag/v${encodeURIComponent(version)}` };
  }
  if (commit === "dev") return { text: `${version}+dev`, href: undefined };
  return {
    text: `${version}+${commit.slice(0, 7)}`,
    href: `${REPO_URL}/commit/${encodeURIComponent(commit)}`,
  };
}
