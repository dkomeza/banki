import { describe, expect, test } from "bun:test";
import { PR_PREVIEW_RESOURCES } from "./config";
import { composeEnv, projectsFrom, slugProjectsFrom, targetOf } from "./docker";

// `docker ps`, `docker volume ls` and `docker network ls` print one line per
// object in the agent's format: the project, the Preview labels, and for a
// container its service, whether it is a one-off and its state.

const SHA = "a".repeat(40);
const API = `sha256:${"1".repeat(64)}`;
const WEB = `sha256:${"2".repeat(64)}`;
const AT = "2026-10-20T11:00:00.000Z";

const labels = (project: string, sha = SHA) => [project, sha, AT, API, WEB].join("\t");
const container = (project: string, service: string, state: string, oneoff = "False") =>
  `${labels(project)}\t${service}\t${oneoff}\t${state}`;

describe("projectsFrom", () => {
  test("a running Preview, from its containers", () => {
    const projects = projectsFrom({
      containers: [
        container("banki-pr-5", "api", "running"),
        container("banki-pr-5", "web", "running"),
      ].join("\n"),
      volumes: labels("banki-pr-5"),
      networks: labels("banki-pr-5"),
    });

    expect(projects).toEqual([
      {
        pr: 5,
        sha: SHA,
        deployedAt: new Date(AT),
        digests: { api: API, web: WEB },
        api: "running",
        web: "running",
      },
    ]);
  });

  test("a project with only a volume and a network, as a failed seed leaves it", () => {
    const projects = projectsFrom({
      containers: "",
      volumes: labels("banki-pr-5"),
      networks: labels("banki-pr-5"),
    });

    expect(projects).toEqual([
      expect.objectContaining({ pr: 5, sha: SHA, api: "missing", web: "missing" }),
    ]);
  });

  test("a project with only a network is still found", () => {
    const projects = projectsFrom({ containers: "", volumes: "", networks: labels("banki-pr-9") });

    expect(projects.map((project) => project.pr)).toEqual([9]);
  });

  test("a restarting or paused container keeps its state: it still holds its place", () => {
    const projects = projectsFrom({
      containers: [
        container("banki-pr-5", "api", "restarting"),
        container("banki-pr-5", "web", "paused"),
      ].join("\n"),
      volumes: "",
      networks: "",
    });

    expect(projects).toEqual([expect.objectContaining({ api: "restarting", web: "paused" })]);
  });

  test("every other state is stopped", () => {
    const projects = ["exited", "created", "dead", "removing"].map(
      (state) =>
        projectsFrom({
          containers: [
            container("banki-pr-5", "api", state),
            container("banki-pr-5", "web", state),
          ].join("\n"),
          volumes: "",
          networks: "",
        })[0],
    );

    for (const project of projects) {
      expect(project).toEqual(expect.objectContaining({ api: "stopped", web: "stopped" }));
    }
  });

  test("a one-off container from banki setup finds the project, but isn't its api", () => {
    const projects = projectsFrom({
      containers: container("banki-pr-5", "api", "running", "True"),
      volumes: "",
      networks: "",
    });

    expect(projects).toEqual([expect.objectContaining({ pr: 5, api: "missing", web: "missing" })]);
  });

  test("the service containers' labels win over the volume's", () => {
    const newer = "b".repeat(40);
    const projects = projectsFrom({
      containers: `${labels("banki-pr-5", newer)}\tweb\tFalse\trunning`,
      volumes: labels("banki-pr-5"),
      networks: "",
    });

    expect(projects).toEqual([expect.objectContaining({ sha: newer })]);
  });

  test("objects with no Preview labels give a project with nothing known", () => {
    const projects = projectsFrom({ containers: "", volumes: "banki-pr-5\t\t\t\t", networks: "" });

    expect(projects).toEqual([
      {
        pr: 5,
        sha: undefined,
        deployedAt: undefined,
        digests: undefined,
        api: "missing",
        web: "missing",
      },
    ]);
  });

  test("every other Compose project is ignored", () => {
    const projects = projectsFrom({
      containers: [
        container("banki", "api", "running"),
        container("banki-pr-", "api", "running"),
        container("banki-pr-05", "api", "running"),
        container("banki-pr-5-x", "api", "running"),
        container("homelab", "web", "running"),
      ].join("\n"),
      volumes: labels("banki-smoke-1"),
      networks: labels("banki-preview"),
    });

    expect(projects).toEqual([]);
  });

  test("several projects, ordered by PR", () => {
    const projects = projectsFrom({
      containers: container("banki-pr-12", "web", "running"),
      volumes: [labels("banki-pr-3"), labels("banki-pr-12")].join("\n"),
      networks: "",
    });

    expect(projects.map((project) => project.pr)).toEqual([3, 12]);
  });
});

describe("slugProjectsFrom", () => {
  test("a running Slug Preview, from its containers, volume and network", () => {
    const projects = slugProjectsFrom({
      containers: [
        container("banki-slug-blue", "api", "running"),
        container("banki-slug-blue", "web", "restarting"),
      ].join("\n"),
      volumes: labels("banki-slug-blue"),
      networks: labels("banki-slug-blue"),
    });

    expect(projects).toEqual([
      {
        slug: "blue",
        sha: SHA,
        deployedAt: new Date(AT),
        digests: { api: API, web: WEB },
        api: "running",
        web: "restarting",
      },
    ]);
  });

  test("the two pools never see each other's projects, ordered by Slug", () => {
    const listed = {
      containers: [
        container("banki-pr-5", "api", "running"),
        container("banki-slug-cyan", "api", "running"),
      ].join("\n"),
      volumes: [labels("banki-slug-blue"), labels("banki-pr-7")].join("\n"),
      networks: "",
    };

    expect(projectsFrom(listed).map((project) => project.pr)).toEqual([5, 7]);
    expect(slugProjectsFrom(listed).map((project) => project.slug)).toEqual(["blue", "cyan"]);
  });

  test("a project named for an invalid or reserved Slug is ignored", () => {
    const projects = slugProjectsFrom({
      containers: [
        container("banki-slug-", "api", "running"),
        container("banki-slug-www", "api", "running"),
        container("banki-slug-Blue", "api", "running"),
        container("banki-slug-pr-5", "api", "running"),
      ].join("\n"),
      volumes: "",
      networks: "",
    });

    expect(projects).toEqual([]);
  });
});

describe("the template's variables", () => {
  const resources = { apiMemory: "128m", apiCpus: "0.5", webMemory: "48m", webCpus: "0.25" };
  const at = new Date(AT);

  test("name a PR Preview's pool, host and limits", () => {
    const target = targetOf(
      {
        pr: 5,
        sha: SHA,
        deployedAt: at,
        digests: { api: API, web: WEB },
        api: "running",
        web: "running",
      },
      at,
      PR_PREVIEW_RESOURCES,
    );

    expect(composeEnv(target)).toEqual({
      PREVIEW_POOL: "pr",
      PREVIEW_KEY: "5",
      PREVIEW_HOST: "pr-5.banki.dkomeza.com",
      PREVIEW_SHA: SHA,
      PREVIEW_DEPLOYED_AT: AT,
      API_DIGEST: API,
      WEB_DIGEST: WEB,
      API_MEMORY: "256m",
      API_CPUS: "1.0",
      WEB_MEMORY: "128m",
      WEB_CPUS: "0.5",
    });
  });

  test("name a Slug Preview's pool, host and limits", () => {
    const target = targetOf(
      {
        slug: "blue",
        sha: undefined,
        deployedAt: undefined,
        digests: undefined,
        api: "missing",
        web: "missing",
      },
      at,
      resources,
    );

    expect(composeEnv(target)).toMatchObject({
      PREVIEW_POOL: "slug",
      PREVIEW_KEY: "blue",
      PREVIEW_HOST: "blue.banki.dkomeza.com",
      PREVIEW_SHA: "unknown",
      PREVIEW_DEPLOYED_AT: AT,
      API_MEMORY: "128m",
      API_CPUS: "0.5",
      WEB_MEMORY: "48m",
      WEB_CPUS: "0.25",
    });
  });
});
