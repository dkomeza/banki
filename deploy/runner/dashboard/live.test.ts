import { describe, expect, test } from "bun:test";
import type { PreviewEnvironment } from "../dispatch/github";
import { dispatcher, fakeGitHub, fakeIssue, reading, SATURDAY } from "../dispatch/test-fakes";
import { liveComputer, spentSoFar } from "./live";

// One computation of the live view, through the Dispatcher's stand-ins for
// Linear, GitHub and the Broker.

const ago = (minutes: number) => new Date(SATURDAY.getTime() - minutes * 60_000).toISOString();

const resultEvent = (usd: number) => JSON.stringify({ type: "result", total_cost_usd: usd });

function setup(options: { linearFails?: boolean } = {}) {
  const { deps, revoked } = dispatcher([
    fakeIssue("BAN-1"),
    fakeIssue("BAN-2", { status: "In Progress" }),
  ]);
  deps.records.saveGate({ reading: reading(0.3), at: ago(5) });
  deps.records.saveActive({
    issue: "BAN-11",
    kind: "design",
    state: "running",
    pid: 7,
    runs: [
      {
        startedAt: ago(300),
        endedAt: ago(250),
        log: "/work/logs/BAN-11/a.jsonl",
        before: null,
        costUsd: 1.25,
      },
      { startedAt: ago(47), log: "/work/logs/BAN-11/b.jsonl", before: null },
    ],
  });
  const statusAsked: number[] = [];
  const github = fakeGitHub();
  github.recentDeployments = async (environment: PreviewEnvironment) =>
    environment === "slug-preview"
      ? [
          { id: 1, environment, name: "ban-11-b", createdAt: ago(47) },
          { id: 2, environment, name: "ban-11-a", createdAt: ago(60) },
        ]
      : [{ id: 3, environment, name: "PR #38", createdAt: ago(3) }];
  github.newestStatus = async (id) => {
    statusAsked.push(id);
    return { state: id === 2 ? "success" : "queued", description: "", url: null };
  };
  if (options.linearFails === true) {
    deps.broker.linearToken = async () => {
      throw new Error("Can't reach the broker");
    };
  }
  const compute = liveComputer({
    ...deps,
    github: () => github,
    readLog: (path) => (path.endsWith("b.jsonl") ? [resultEvent(0.5)] : []),
  });
  return { compute, revoked, statusAsked };
}

describe("a computation of the live view", () => {
  test("is runner status's view, with one Linear token, revoked after it", async () => {
    const { compute, revoked } = setup();

    const live = await compute();

    expect(live.error).toBeUndefined();
    expect(live.status.queue.map((verdict) => verdict.ready.issue)).toEqual(["BAN-1"]);
    expect(live.status.orphans).toEqual(["BAN-2"]);
    expect(revoked).toEqual(["tick-token"]);
  });

  test("flags the Previews' newest deployments the pull agent hasn't claimed, and asks no more of one it has", async () => {
    const { compute, statusAsked } = setup();

    const live = await compute();
    await compute();

    expect(live.flags).toEqual([
      {
        environment: "slug-preview",
        name: "ban-11-b",
        state: "queued",
        minutes: 47,
        createdAt: ago(47),
      },
    ]);
    expect(statusAsked.toSorted((a, b) => a - b)).toEqual([1, 1, 2, 3, 3]);
  });

  test("gives each Stage running its dollars so far, from its runs and its log", async () => {
    const { compute } = setup();

    expect((await compute()).spent).toEqual({ "BAN-11": 1.75 });
  });

  test("falls back to the volume's records when Linear can't be read, and says why", async () => {
    const { compute } = setup({ linearFails: true });

    const live = await compute();

    expect(live.error).toContain("Can't reach the broker");
    expect(live.status.running.map((record) => record.issue)).toEqual(["BAN-11"]);
    expect(live.status.queue).toEqual([]);
    expect(live.status.gate?.reading?.sevenDay.utilization).toBe(0.3);
  });
});

describe("a Stage's dollars so far", () => {
  test("are its ended runs' and what its current log's result says", () => {
    expect(
      spentSoFar(
        {
          issue: "BAN-1",
          kind: "implement",
          state: "paused",
          pid: null,
          runs: [
            { startedAt: ago(9), endedAt: ago(8), log: "x", before: null, costUsd: 0.4 },
            { startedAt: ago(7), endedAt: ago(6), log: "y", before: null },
          ],
        },
        () => [resultEvent(9)],
      ),
    ).toBe(0.4);
  });
});
