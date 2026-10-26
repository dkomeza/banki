import { describe, expect, test } from "bun:test";
import { BLIND_RETRIES_MS } from "../cli/linear";
import { linear } from "./linear";

// The Dispatcher's Linear adapter waits out a fresh token's blindness, as
// `runner stage` does (cli/linear.test.ts), in a lookup's errors and in a
// list of open issues that comes back empty.

describe("the Dispatcher's Linear adapter", () => {
  test("retries a query a fresh token couldn't see, and gets its answer", async () => {
    const answers = [
      {
        status: 400,
        body: {
          errors: [{ message: "Entity not found: Issue", extensions: { code: "INPUT_ERROR" } }],
        },
      },
      { status: 200, body: { data: { viewer: { id: "runner" } } } },
    ];
    let calls = 0;
    const client = linear("lin", {
      fetch: async () => {
        const answer = answers[Math.min(calls++, answers.length - 1)];
        return new Response(JSON.stringify(answer?.body), { status: answer?.status ?? 500 });
      },
      sleep: async () => undefined,
    });

    expect(await client.viewer()).toBe("runner");
    expect(calls).toBe(2);
  });

  test("reads the open issues again while a fresh token lists none", async () => {
    const issue = {
      id: "id-1",
      identifier: "BAN-1",
      number: 1,
      title: "",
      priority: 0,
      createdAt: "2026-10-01T00:00:00.000Z",
      branchName: "dkomeza/ban-1",
      description: "",
      state: { name: "Todo" },
      assignee: null,
      team: { id: "team" },
    };
    const lists = [[], [], [issue]];
    let calls = 0;
    const client = linear("lin", {
      fetch: async () =>
        Response.json({
          data: {
            issues: {
              nodes: lists[Math.min(calls++, lists.length - 1)],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      sleep: async () => undefined,
    });

    expect((await client.openIssues()).map((found) => found.identifier)).toEqual(["BAN-1"]);
    expect(calls).toBe(3);
  });

  test("believes an empty list of open issues once the retries are spent", async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = linear("lin", {
      fetch: async () => {
        calls++;
        return Response.json({
          data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
        });
      },
      sleep: async (ms) => waits.push(ms),
    });

    expect(await client.openIssues()).toEqual([]);
    expect(calls).toBe(BLIND_RETRIES_MS.length + 1);
    expect(waits).toEqual(BLIND_RETRIES_MS);
  });

  test("reads an issue's moves, oldest first, each with who made it", async () => {
    const nodes = [
      {
        createdAt: "2026-10-24T02:00:00.000Z",
        actor: { id: "maintainer" },
        fromState: null,
        toState: null,
        fromAssignee: { id: "maintainer" },
        toAssignee: null,
      },
      {
        createdAt: "2026-10-24T01:00:00.000Z",
        actor: null,
        fromState: { name: "Todo" },
        toState: { name: "In Progress" },
        fromAssignee: null,
        toAssignee: null,
      },
      { createdAt: "2026-10-24T03:00:00.000Z", actor: { id: "x" }, fromState: null, toState: null },
    ];
    const queries: string[] = [];
    const client = linear("lin", {
      fetch: async (_url, init) => {
        queries.push(typeof init.body === "string" ? init.body : "");
        return Response.json({
          data: {
            issue: { history: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } },
          },
        });
      },
    });

    expect(await client.moves("id-1")).toEqual([
      { at: "2026-10-24T01:00:00.000Z", by: null, status: { from: "Todo", to: "In Progress" } },
      {
        at: "2026-10-24T02:00:00.000Z",
        by: "maintainer",
        assignee: { from: "maintainer", to: null },
      },
    ]);
    expect(queries[0]).toContain("actor { id }");
  });
});
