import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Comment } from "./closing";
import { MAINTAINER } from "./closing";
import type { DispatcherDeps } from "./dispatcher";
import type { Reading } from "./gate";
import type { GitHub } from "./github";
import type { Linear, LinearIssue } from "./linear";
import type { ReviewFacts, Transition } from "./select";
import type { Start } from "./spawn";
import { store } from "./store";

// Stand-ins for Linear, GitHub, the Broker and `claude`, for the tests that
// drive the tick, `run-now` and the supervisor through their adapters' seams.

export const RUNNER_ID = "runner-app";
export const STATES = [
  "Backlog",
  "In Design",
  "Design Review",
  "Todo",
  "In Progress",
  "In Review",
  "Acceptance",
  "Done",
  "Canceled",
];

export type FakeIssue = LinearIssue & {
  history: Transition[];
  assignedAt?: string;
  comments: Comment[];
  stateType?: "completed" | "canceled";
};

export function fakeIssue(identifier: string, fields: Partial<FakeIssue> = {}): FakeIssue {
  return {
    id: `id-${identifier}`,
    identifier,
    number: Number(identifier.split("-")[1]),
    priority: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    branch: `dkomeza/${identifier.toLowerCase()}-x`,
    description: "",
    status: "Todo",
    assigneeId: null,
    teamId: "team",
    history: [],
    comments: [],
    ...fields,
  };
}

export function fakeLinear(issues: FakeIssue[]) {
  const calls: string[] = [];
  let next = 0;
  const find = (id: string) => issues.find((issue) => issue.id === id || issue.identifier === id);
  const client: Linear = {
    viewer: async () => RUNNER_ID,
    openIssues: async () =>
      issues.filter((issue) => issue.stateType === undefined).map((issue) => ({ ...issue })),
    issue: async (id) => {
      const found = find(id);
      return found === undefined ? undefined : { ...found };
    },
    history: async (id) => ({
      statuses: find(id)?.history ?? [],
      assignedAt: find(id)?.assignedAt,
    }),
    comments: async (id) => find(id)?.comments ?? [],
    ended: async (numbers) =>
      new Map(
        issues.flatMap((issue) =>
          numbers.includes(issue.number) && issue.stateType !== undefined
            ? [[issue.number, issue.stateType]]
            : [],
        ),
      ),
    states: async () => new Map(STATES.map((name) => [name, `state-${name}`])),
    update: async (id, input) => {
      const found = find(id);
      if (found === undefined) throw new Error(`no issue ${id}`);
      if (input.stateId !== undefined) {
        const status = input.stateId.replace(/^state-/, "");
        found.history.push({ at: new Date().toISOString(), from: found.status, to: status });
        found.status = status;
        calls.push(`${found.identifier} → ${status}`);
      }
      if (input.assigneeId !== undefined) {
        found.assigneeId = input.assigneeId;
        calls.push(
          `${found.identifier} assigned ${input.assigneeId === MAINTAINER.linearId ? "the Maintainer" : String(input.assigneeId)}`,
        );
      }
    },
    comment: async (id, body) => {
      const found = find(id);
      if (found === undefined) throw new Error(`no issue ${id}`);
      next += 1;
      found.comments.push({
        id: `posted-${next}`,
        body,
        createdAt: new Date().toISOString(),
        userId: RUNNER_ID,
        parentId: null,
      });
      calls.push(`${found.identifier} comment`);
      return `posted-${next}`;
    },
  };
  return { client, calls };
}

export function fakeGitHub(review: Partial<ReviewFacts> = {}): GitHub {
  return {
    review: async () => ({
      pr: null,
      pushedAt: null,
      check: null,
      summary: null,
      openThreads: 0,
      preview: null,
      ...review,
    }),
    slugDeployments: async () => [],
    newestStatus: async () => ({ state: null, description: "", url: null }),
    takeDown: async () => undefined,
    pullNumber: async () => undefined,
  };
}

export const reading = (sevenDay = 0.2, fiveHour = 0.1): Reading => ({
  at: new Date().toISOString(),
  fiveHour: { utilization: fiveHour, resetsAt: "2026-10-24T05:00:00.000Z" },
  sevenDay: { utilization: sevenDay, resetsAt: "2026-10-27T00:00:00.000Z" },
});

/** A Saturday noon, inside the default window, and a Wednesday noon, outside it, in UTC. */
export const SATURDAY = new Date("2026-10-24T12:00:00.000Z");
export const WEDNESDAY = new Date("2026-10-21T12:00:00.000Z");

export function dispatcher(
  issues: FakeIssue[],
  options: { now?: Date; github?: GitHub; reading?: () => Promise<Reading>; alive?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "banki-dispatch-"));
  const linear = fakeLinear(issues);
  const started: Start[] = [];
  const lines: string[] = [];
  const revoked: string[] = [];
  const deps: DispatcherDeps = {
    broker: {
      linearToken: async () => ({ id: "tick-token", token: "lin-token" }),
      endLinearToken: async (id) => {
        revoked.push(id);
      },
      githubToken: async () => "gh-token",
    },
    linear: () => linear.client,
    github: () => options.github ?? fakeGitHub(),
    log: (line) => lines.push(line),
    records: store(join(dir, "dispatcher")),
    config: {
      window: { night: { start: 60, end: 420 }, openDays: new Set([6, 0]) },
      ceiling: 0.6,
      maxStages: 2,
      timeZone: "UTC",
    },
    takeReading: options.reading ?? (async () => reading()),
    startSupervisor: (start) => {
      started.push(start);
      return 4242;
    },
    alive: () => options.alive ?? true,
    redact: (text) => text,
    housekeeper: {
      logFiles: () => [],
      removeLogs: () => undefined,
      listWorktrees: async () => [],
      worktreeFacts: async (entry) => ({ ...entry, clean: true, pushed: true }),
      removeWorktree: async () => undefined,
    },
    logs: join(dir, "logs"),
    now: () => options.now ?? SATURDAY,
  };
  return { deps, linear, started, lines, revoked, dir };
}
