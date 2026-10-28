import { describe, expect, test } from "bun:test";
import {
  type LongLivedAction,
  type LongLivedDeployment,
  type LongLivedInstallation,
  type LongLivedPlanInput,
  longLivedPayload,
  planLongLived,
  planLongLivedParts,
  readEnoughLongLived,
} from "./long-lived-planner";
import type { LongLivedEnvironment } from "./naming";

// The long-lived planner, from what Docker says of Edge and Production and
// their `edge` and `production` Deployments, as main-images (and a Release)
// create them.

const NOW = new Date("2026-10-20T12:00:00Z");
const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);
const OLDER_SHA = "c".repeat(40);
const digest = (n: number) => `sha256:${String(n).repeat(64)}`;
const NEW = { api: digest(1), web: digest(2) };
const OLD = { api: digest(3), web: digest(4) };
const OLDER = { api: digest(5), web: digest(6) };
const api = (d: string) => `ghcr.io/dkomeza/banki-api@${d}`;
const web = (d: string) => `ghcr.io/dkomeza/banki-web@${d}`;

let nextId = 100;
function deployment(
  status: LongLivedDeployment["status"],
  overrides: Partial<LongLivedDeployment> & { digests?: { api: string; web: string } } = {},
): LongLivedDeployment {
  const id = overrides.id ?? nextId++;
  const sha = overrides.sha ?? SHA;
  const { digests = NEW, ...rest } = overrides;
  return {
    environment: "edge",
    id,
    sha,
    createdAt: new Date(NOW.getTime() - (1000 - id) * 60_000),
    status,
    description: undefined,
    payload: { sha, ...digests },
    ...rest,
  };
}

const KEPT: LongLivedInstallation = {
  project: {
    sha: OLD_SHA,
    deployedAt: NOW,
    digests: OLD,
    api: "running",
    web: "running",
  },
  volume: { exists: true, deploymentId: 1 },
};
const NONE: LongLivedInstallation = { project: undefined, volume: { exists: false } };

function input(
  deployments: LongLivedDeployment[],
  installations: Partial<Record<LongLivedEnvironment, LongLivedInstallation>> = {},
): LongLivedPlanInput {
  return {
    installations: { edge: KEPT, production: NONE, ...installations },
    deployments,
    now: NOW,
  };
}

const kinds = (actions: LongLivedAction[]) =>
  actions.map((action) => `${action.environment} ${action.kind} ${action.deploymentId}`);

const of = (payload: unknown, sha = SHA) => longLivedPayload({ sha, payload });

describe("longLivedPayload", () => {
  test("is the digests of `{ sha, api, web }` for the Deployment's own commit", () => {
    expect(of({ sha: SHA, ...NEW })).toEqual(NEW);
    expect(of({ sha: SHA.toUpperCase(), ...NEW })).toEqual(NEW);
  });

  test("ignores other fields, such as a reset mark", () => {
    expect(of({ sha: SHA, ...NEW, reset: true })).toEqual(NEW);
  });

  test("rejects any other payload", () => {
    for (const payload of [
      undefined,
      null,
      "garbage",
      [SHA, NEW.api, NEW.web],
      { ...NEW },
      { sha: OLD_SHA, ...NEW },
      { sha: SHA, api: NEW.api },
      { sha: SHA, api: "sha256:abc", web: NEW.web },
      { sha: SHA, api: NEW.api, web: `sha256:${"G".repeat(64)}` },
      { sha: SHA, api: `sha512:${"1".repeat(64)}`, web: NEW.web },
      { sha: SHA, api: ` ${NEW.api}`, web: NEW.web },
    ]) {
      expect(of(payload)).toBeUndefined();
    }
  });
});

describe("planning a Long-lived installation", () => {
  test("deploys the newest Deployment while it waits: no status yet, queued, or in_progress", () => {
    for (const status of [undefined, "queued", "in_progress"] as const) {
      const head = deployment(status);
      const [action] = planLongLived(input([head]));

      expect(action).toMatchObject({
        pool: "long-lived",
        environment: "edge",
        kind: "deploy",
        deploymentId: head.id,
        sha: SHA,
        digests: NEW,
        volume: "kept",
        deployedAt: NOW,
      });
    }
  });

  test("retries an in_progress one, which a restart cut short, on every start until it ends", () => {
    const head = deployment("in_progress");

    expect(kinds(planLongLived(input([head])))).toEqual([`edge deploy ${head.id}`]);
    expect(kinds(planLongLived(input([head])))).toEqual([`edge deploy ${head.id}`]);
  });

  test("does nothing once the newest ended in a success or a failure", () => {
    for (const status of ["success", "failure", "error", "inactive"] as const) {
      expect(planLongLived(input([deployment(status)]))).toEqual([]);
    }
  });

  test("never brings back a project someone stopped", () => {
    const stopped: LongLivedInstallation = {
      ...KEPT,
      project: { ...KEPT.project!, sha: SHA, api: "stopped", web: "stopped" },
    };

    expect(planLongLived(input([deployment("success")], { edge: stopped }))).toEqual([]);
  });

  test("supersedes the older ones still waiting, and deploys only the newest", () => {
    const oldest = deployment("queued", { sha: OLDER_SHA, digests: OLDER });
    const older = deployment("in_progress", { sha: OLD_SHA, digests: OLD });
    const settled = deployment("success", { sha: OLD_SHA, digests: OLD });
    const head = deployment("queued");

    const { upkeep, deploys } = planLongLivedParts(input([head, settled, older, oldest]));

    expect(upkeep).toEqual([
      expect.objectContaining({
        kind: "mark-inactive",
        deploymentId: older.id,
        reason: "superseded",
      }),
      expect.objectContaining({ kind: "mark-inactive", deploymentId: oldest.id }),
    ]);
    expect(kinds(deploys)).toEqual([`edge deploy ${head.id}`]);
  });

  test("supersedes the older waiting ones once the newest has ended too", () => {
    const older = deployment("queued", { sha: OLD_SHA, digests: OLD });
    const head = deployment("failure");

    expect(kinds(planLongLived(input([older, head])))).toEqual([`edge mark-inactive ${older.id}`]);
  });

  test("marks a bad payload a failure, and never deploys it", () => {
    const head = deployment("queued", { payload: { sha: SHA, api: "latest", web: NEW.web } });

    expect(planLongLived(input([head]))).toEqual([
      { pool: "long-lived", environment: "edge", kind: "mark-invalid", deploymentId: head.id },
    ]);
  });

  test("marks a bad payload once: one already failed is left alone", () => {
    expect(planLongLived(input([deployment("failure", { payload: "garbage" })]))).toEqual([]);
  });

  test("a bad newest payload deploys nothing older in its place, and supersedes the older ones", () => {
    const older = deployment("queued", { sha: OLD_SHA, digests: OLD });
    const head = deployment(undefined, { payload: undefined });

    expect(kinds(planLongLived(input([older, head])))).toEqual([
      `edge mark-invalid ${head.id}`,
      `edge mark-inactive ${older.id}`,
    ]);
  });

  test("rolls back to the newest success, and none when there is none", () => {
    const older = deployment("success", { sha: OLDER_SHA, digests: OLDER });
    const previous = deployment("success", { sha: OLD_SHA, digests: OLD });
    const failed = deployment("failure", { sha: OLD_SHA, digests: OLDER });
    const head = deployment("queued");

    expect(planLongLived(input([head, failed, previous, older]))).toEqual([
      expect.objectContaining({
        kind: "deploy",
        rollbackTo: { deploymentId: previous.id, sha: OLD_SHA, digests: OLD },
      }),
    ]);
    expect(planLongLived(input([deployment("queued")], { edge: NONE }))).toEqual([
      expect.objectContaining({ kind: "deploy", rollbackTo: undefined }),
    ]);
  });

  test("never rolls back to a success whose payload is bad", () => {
    const bad = deployment("success", { payload: { sha: OLD_SHA }, sha: OLD_SHA });

    expect(planLongLived(input([deployment("queued"), bad]))).toEqual([
      expect.objectContaining({ kind: "deploy", rollbackTo: undefined }),
    ]);
  });

  test("a first boot when the volume doesn't exist, or this same Deployment made it", () => {
    const head = deployment("in_progress");

    expect(planLongLived(input([head], { edge: NONE }))).toEqual([
      expect.objectContaining({ kind: "deploy", volume: "missing" }),
    ]);
    expect(
      planLongLived(
        input([head], {
          edge: { project: undefined, volume: { exists: true, deploymentId: head.id } },
        }),
      ),
    ).toEqual([expect.objectContaining({ kind: "deploy", volume: "own" })]);
  });

  test("keeps a volume made by another Deployment, or by hand", () => {
    for (const deploymentId of [1, undefined]) {
      const edge: LongLivedInstallation = { ...KEPT, volume: { exists: true, deploymentId } };

      expect(planLongLived(input([deployment("queued")], { edge }))).toEqual([
        expect.objectContaining({ kind: "deploy", volume: "kept" }),
      ]);
    }
  });

  test("plans each installation apart, Edge's deploy first", () => {
    const edge = deployment("queued");
    const production = deployment("queued", { environment: "production" });

    expect(kinds(planLongLived(input([production, edge])))).toEqual([
      `edge deploy ${edge.id}`,
      `production deploy ${production.id}`,
    ]);
  });

  test("never rolls back to the other installation's success", () => {
    const production = deployment("success", { environment: "production", sha: OLD_SHA });

    expect(planLongLived(input([deployment("queued"), production]))).toEqual([
      expect.objectContaining({ environment: "edge", rollbackTo: undefined }),
    ]);
  });
});

/** A Deployment carrying the reset mark, `reset: true` in its payload. */
function marked(
  status: LongLivedDeployment["status"],
  overrides: Partial<LongLivedDeployment> & { digests?: { api: string; web: string } } = {},
): LongLivedDeployment {
  const { sha = SHA, digests = NEW } = overrides;
  return deployment(status, { ...overrides, payload: { sha, ...digests, reset: true } });
}

/** Each deploy's installation, Deployment and whether it is a Reset. */
const resets = (actions: LongLivedAction[]) =>
  actions.flatMap((action) =>
    action.kind === "deploy"
      ? [`${action.environment} ${action.deploymentId} ${action.reset}`]
      : [],
  );

describe("a Reset", () => {
  test("is planned from the mark on the newest Edge Deployment", () => {
    const head = marked("queued");

    expect(planLongLived(input([head]))).toEqual([
      expect.objectContaining({ kind: "deploy", deploymentId: head.id, reset: true }),
    ]);
  });

  test("an ordinary deploy is no Reset", () => {
    expect(resets(planLongLived(input([deployment("queued")])))).toEqual([
      expect.stringMatching(/ false$/),
    ]);
  });

  test("carries from an older one still waiting onto the newest, which still supersedes it", () => {
    for (const status of [undefined, "queued", "in_progress"] as const) {
      const older = marked(status, { sha: OLD_SHA, digests: OLD });
      const head = deployment("queued");

      const { upkeep, deploys } = planLongLivedParts(input([older, head]));

      expect(upkeep).toEqual([
        expect.objectContaining({
          kind: "mark-inactive",
          deploymentId: older.id,
          reason: "superseded",
        }),
      ]);
      expect(resets(deploys)).toEqual([`edge ${head.id} true`]);
    }
  });

  test("an ended one doesn't carry", () => {
    for (const status of ["success", "failure", "error", "inactive"] as const) {
      const older = marked(status, { sha: OLD_SHA, digests: OLD });
      const head = deployment("queued");

      expect(resets(planLongLived(input([older, head])))).toEqual([`edge ${head.id} false`]);
    }
  });

  test("one with a bad payload doesn't carry", () => {
    const older = deployment("queued", { sha: OLD_SHA, payload: { sha: OLD_SHA, reset: true } });
    const head = deployment("queued");

    expect(resets(planLongLived(input([older, head])))).toEqual([`edge ${head.id} false`]);
  });

  test("an ordinary deploy cut short stays ordinary: the volume's Reset mark, not GitHub, finishes a Reset", () => {
    const plain = deployment("in_progress", { description: "resetting to aaaaaaa" });

    expect(resets(planLongLived(input([plain])))).toEqual([`edge ${plain.id} false`]);
  });

  test("the mark is ignored on Production", () => {
    const head = marked("queued", { environment: "production" });
    const later = deployment("queued", { environment: "production", sha: OLD_SHA, digests: OLD });

    expect(resets(planLongLived(input([head])))).toEqual([`production ${head.id} false`]);
    expect(resets(planLongLived(input([head, later])))).toEqual([`production ${later.id} false`]);
  });

  test("only `reset: true` is the mark: any other value is an ordinary deploy", () => {
    for (const reset of [false, "true", 1, null, {}, [true]]) {
      const head = deployment("queued");
      const withReset = { ...head, payload: { sha: SHA, ...NEW, reset } };

      expect(resets(planLongLived(input([withReset])))).toEqual([`edge ${head.id} false`]);
    }
  });

  test("on a missing volume, is planned as a Reset of a first boot", () => {
    const head = marked("queued");

    expect(planLongLived(input([head], { edge: NONE }))).toEqual([
      expect.objectContaining({ kind: "deploy", volume: "missing", reset: true }),
    ]);
  });
});

describe("the images a success removes", () => {
  test("are the installation's older Deployments' images, keeping this deploy's and the rollback's", () => {
    const oldest = deployment("success", { sha: OLDER_SHA, digests: OLDER });
    const previous = deployment("success", { sha: OLD_SHA, digests: OLD });
    const head = deployment("queued");

    const [action] = planLongLived(input([head, previous, oldest]));

    expect(action).toMatchObject({ staleImages: [api(OLDER.api), web(OLDER.web)] });
  });

  test("never include what Production runs, deploys next or would roll back to", () => {
    const shared = { api: digest(7), web: digest(8) };
    const third = { api: digest(9), web: digest(0) };
    const edgeOld = [
      deployment("success", { sha: OLDER_SHA, digests: OLDER }),
      deployment("success", { sha: OLDER_SHA, digests: shared }),
      deployment("success", { sha: OLDER_SHA, digests: third }),
      deployment("success", { sha: OLD_SHA, digests: OLD }),
    ];
    const production = [
      deployment("success", { environment: "production", sha: OLDER_SHA, digests: shared }),
      deployment("queued", { environment: "production", sha: OLDER_SHA, digests: third }),
    ];
    const running: LongLivedInstallation = {
      project: { sha: OLDER_SHA, deployedAt: NOW, digests: OLDER, api: "running", web: "running" },
      volume: { exists: true, deploymentId: 1 },
    };

    const [action] = planLongLived(
      input([deployment("queued"), ...edgeOld, ...production], { production: running }),
    );

    expect(action).toMatchObject({ environment: "edge", staleImages: [] });
  });
});

describe("readEnoughLongLived", () => {
  test("stops once the newest success is read and the page holds none still waiting", () => {
    const page = [deployment("failure"), deployment("success")];

    expect(readEnoughLongLived(page, page)).toBe(true);
  });

  test("reads on while no success is read: a rollback needs one", () => {
    const page = [deployment("failure"), deployment("inactive")];

    expect(readEnoughLongLived(page, page)).toBe(false);
  });

  test("reads on while the page holds one still waiting, which needs superseding", () => {
    const page = [deployment("success"), deployment("queued")];

    expect(readEnoughLongLived(page, page)).toBe(false);
  });
});
