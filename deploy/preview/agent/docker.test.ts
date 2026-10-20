import { describe, expect, test } from "bun:test";
import { projectsFrom } from "./docker";

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

  test("stopped and restarting containers aren't running", () => {
    const projects = projectsFrom({
      containers: [
        container("banki-pr-5", "api", "restarting"),
        container("banki-pr-5", "web", "exited"),
      ].join("\n"),
      volumes: "",
      networks: "",
    });

    expect(projects).toEqual([expect.objectContaining({ api: "stopped", web: "stopped" })]);
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
