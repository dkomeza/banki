import { describe, expect, test } from "bun:test";
import { helperInvocation } from "./helper";

// The helper holds the Docker socket like the agent, so it runs with the
// agent's hardening, builds only the clone of `main`, and tells the new agent
// which commit it is.

const MAIN = "b".repeat(40);
const SECRETS = "/home/dawid/.config/banki-preview";

const valuesOf = (argv: string[], flag: string) =>
  argv.flatMap((value, index) => (argv[index - 1] === flag ? [value] : []));

describe("the helper's invocation", () => {
  const argv = helperInvocation(MAIN, SECRETS);

  test("runs Compose on the clone's agent.compose.yaml from the agent's own image", () => {
    const image = argv.indexOf("banki-preview-agent");

    expect(argv.slice(0, 3)).toEqual(["docker", "run", "--detach"]);
    expect(valuesOf(argv, "--name")).toEqual(["banki-preview-updater"]);
    expect(argv.slice(image)).toEqual([
      "banki-preview-agent",
      "docker",
      "compose",
      "--file",
      "/src/deploy/preview/agent.compose.yaml",
      "up",
      "--detach",
      "--build",
    ]);
  });

  test("has the agent's hardening, on Docker's default bridge network", () => {
    expect(argv).toContain("--read-only");
    expect(argv).toContain("--init");
    expect(valuesOf(argv, "--tmpfs")).toEqual(["/tmp"]);
    expect(valuesOf(argv, "--security-opt")).toEqual(["no-new-privileges:true"]);
    expect(valuesOf(argv, "--cap-drop")).toEqual(["ALL"]);
    expect(valuesOf(argv, "--cap-add")).toEqual(["DAC_READ_SEARCH"]);
    expect(valuesOf(argv, "--network")).toEqual(["bridge"]);
  });

  test("mounts the socket, the clone read-only, and the secrets read-only at their host path", () => {
    expect(valuesOf(argv, "--mount")).toEqual([
      "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
      "type=volume,source=banki-preview-src,target=/src,readonly",
      `type=bind,source=${SECRETS},target=${SECRETS},readonly`,
    ]);
  });

  test("gives Compose the secrets directory and the commit it builds", () => {
    expect(valuesOf(argv, "--env")).toEqual([
      "HOME=/tmp",
      `BANKI_PREVIEW_SECRETS=${SECRETS}`,
      `BANKI_PREVIEW_COMMIT=${MAIN}`,
    ]);
  });

  for (const secrets of ["", "relative/dir", "/a,b", "/a:/etc"]) {
    test(`refuses a secrets directory of ${JSON.stringify(secrets)}`, () => {
      expect(() => helperInvocation(MAIN, secrets)).toThrow(/BANKI_PREVIEW_SECRETS/);
    });
  }
});
