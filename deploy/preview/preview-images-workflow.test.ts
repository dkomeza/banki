import { describe, expect, test } from "bun:test";
import { type Answer, REPO, workflowHarness, writes } from "./workflow-harness";

// The preview-images workflow, read from .github/workflows the way GitHub
// reads it: the tags a PR's images get, and cleanup's script, run under bash
// against a fake `gh` that answers from fixtures and records every call.

const { job, runStep } = workflowHarness("preview-images.yml");

const SHA = "a".repeat(40);
const OPEN_PRS = `GET repos/${REPO}/pulls?state=open&per_page=100`;
const versionsOf = (pkg: string) =>
  `GET users/dkomeza/packages/container/${pkg}/versions?per_page=100`;
const deleteOf = (pkg: string, id: number) =>
  `DELETE users/dkomeza/packages/container/${pkg}/versions/${id}`;
const version = (id: number, tags: string[]) => ({ id, metadata: { container: { tags } } });

describe("a PR's images", () => {
  test("are tagged pr-<N> and pr-<N>-<sha> only", () => {
    const meta = job("build").steps.find((step) =>
      step.uses?.startsWith("docker/metadata-action@"),
    );

    expect(meta?.with?.tags).toBe(
      "type=ref,event=pr\ntype=sha,format=long,prefix=pr-${{ github.event.pull_request.number }}-\n",
    );
  });
});

const cleanup = (fixtures: Record<string, Answer>) =>
  runStep("cleanup", "cleanup", {}, { [OPEN_PRS]: [{ number: 7 }], ...fixtures });

describe("cleanup", () => {
  test("deletes closed PRs' versions, and never a main build or a Release", async () => {
    const result = await cleanup({
      [versionsOf("banki-api")]: [
        version(1, ["pr-5", `pr-5-${SHA}`]),
        version(2, [`pr-6-${SHA}`, `sha-${SHA}`]),
        version(3, ["pr-7", `pr-7-${SHA}`]),
        version(4, ["main", `sha-${SHA}`]),
        version(5, [`sha-${SHA}`]),
        version(6, ["v0.1.0", `sha-${SHA}`]),
        version(7, [`slug-blue-${SHA}`]),
        version(8, []),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls).map((call) => `${call.method} ${call.path}`)).toEqual([
      deleteOf("banki-api", 1),
      deleteOf("banki-api", 2),
    ]);
  });

  test("tolerates GHCR keeping a version, and a version already deleted", async () => {
    const result = await cleanup({
      [versionsOf("banki-api")]: [
        version(1, [`pr-5-${SHA}`]),
        version(2, [`pr-6-${SHA}`]),
        version(3, [`pr-8-${SHA}`]),
      ],
      [deleteOf("banki-api", 1)]: {
        stderr: "gh: You cannot delete the last tagged version of a package. (HTTP 400)\n",
        exit: 1,
      },
      [deleteOf("banki-api", 2)]: {
        stderr:
          "gh: Publicly visible package versions with more than 5000 downloads cannot be deleted. Contact GitHub support for further assistance. (HTTP 400)\n",
        exit: 1,
      },
      [deleteOf("banki-api", 3)]: { stderr: "gh: Not Found (HTTP 404)\n", exit: 1 },
    });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("kept version 1");
    expect(result.out).toContain("kept version 2");
    expect(result.out).toContain("version 3 is already deleted");
  });

  test("fails on any other error deleting a version", async () => {
    for (const stderr of [
      "gh: Server Error (HTTP 500)\n",
      "gh: Package version is invalid. (HTTP 400)\n",
    ]) {
      const result = await cleanup({
        [versionsOf("banki-api")]: [version(1, [`pr-5-${SHA}`])],
        [deleteOf("banki-api", 1)]: { stderr, exit: 1 },
      });

      expect(result.exitCode).toBe(1);
    }
  });
});
