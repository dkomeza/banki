import { readFileSync } from "node:fs";
import type { Broker } from "../cli/broker-client";
import { issueBranchOf } from "../cli/plan";
import { errorText } from "../lib/config";
import { closingComment, closingsOf, MAINTAINER } from "./closing";
import { type GitHub, newestFor, type SlugDeployment } from "./github";
import { crashStop, type ActiveRecord, statusBefore } from "./lifecycle";
import { type Linear, type LinearIssue, moveTo } from "./linear";
import {
  decide,
  type Decision,
  type DesignFacts,
  type IssueFacts,
  STATUS,
  type Stop,
} from "./select";
import { logTail } from "./stage-log";

// One conversation with Linear and GitHub, for a tick, a `run-now` or a
// `runner status`: a Linear token from the Broker for it alone, revoked at
// its end, the Runner app's own ID from `viewer` (an assignment to it is
// Linear's, and holds nothing), and the GitHub facts an issue's decision
// needs, fetched only when it needs them.

export type SessionDeps = {
  broker: Pick<Broker, "linearToken" | "endLinearToken" | "githubToken">;
  linear: (token: string) => Linear;
  github: (token: () => Promise<string>) => GitHub;
  log: (line: string) => void;
};

export type Session = Awaited<ReturnType<typeof openSession>>;

export async function openSession(deps: SessionDeps) {
  const minted = await deps.broker.linearToken();
  try {
    const linear = deps.linear(minted.token);
    const runnerId = await linear.viewer();
    const github = deps.github(() => deps.broker.githubToken());
    let slugs: Promise<SlugDeployment[]> | undefined;
    const slugDeployments = () => {
      slugs ??= github.slugDeployments();
      return slugs;
    };
    let branches: Promise<string[]> | undefined;
    /** The issue's branch on origin, whoever started it, from Linear's name for it. */
    const branchOf = async (issue: LinearIssue): Promise<string> => {
      branches ??= github.branches();
      return issueBranchOf(issue.branch, await branches);
    };

    /** Posts a stop's closing comment and assigns the Maintainer, with the status the stop names, if it changed. */
    async function stop(
      issue: LinearIssue,
      stopped: Stop,
      tail: readonly string[] = [],
    ): Promise<void> {
      await linear.comment(issue.id, closingComment(stopped, { ...stopped }, tail));
      if (stopped.nextStatus !== issue.status)
        await moveTo(linear, issue, stopped.nextStatus, MAINTAINER.linearId);
      else await linear.update(issue.id, { assigneeId: MAINTAINER.linearId });
    }

    return {
      linear,
      github,
      runnerId,
      slugDeployments,
      branchOf,

      async end(): Promise<void> {
        await deps.broker
          .endLinearToken(minted.id)
          .catch((error: unknown) =>
            deps.log(
              `Couldn't revoke the Linear token (the Broker revokes it 4 hours after issue): ${errorText(error)}`,
            ),
          );
      },

      /** What the issue's decision is made from in Linear. */
      async facts(issue: LinearIssue): Promise<IssueFacts> {
        const [history, comments, branch] = await Promise.all([
          linear.history(issue.id),
          linear.comments(issue.id),
          branchOf(issue),
        ]);
        return {
          identifier: issue.identifier,
          priority: issue.priority,
          createdAt: issue.createdAt,
          status: issue.status,
          // Read-only, the app's assignment is decided past, as a tick would release it.
          assigneeId: issue.assigneeId === runnerId ? null : issue.assigneeId,
          assignedAt: history.assignedAt,
          branch,
          description: issue.description,
          history: history.statuses,
          closings: closingsOf(comments, { runner: runnerId, issue: issue.identifier }),
        };
      },

      /** The issue's decision, with whatever it needs from GitHub fetched. */
      async decide(facts: IssueFacts, now: Date): Promise<Decision> {
        const first = decide(facts, now);
        if (first.type !== "need") return first;
        if (first.what === "review")
          return decide(facts, now, { review: await github.review(facts.branch) });
        const all = await slugDeployments();
        const design: DesignFacts = {};
        for (const variant of first.variants) {
          const found = newestFor(all, variant.slug, variant.commit);
          design[variant.slug] = found === undefined ? null : await github.newestStatus(found.id);
        }
        return decide(facts, now, { design });
      },

      stop,

      /**
       * Unassigns the issue (in Linear, and in `issue`) when it is the Runner
       * app's: Linear assigns a linked PR's author, and only a person's
       * assignment holds an issue. Says whether it did.
       */
      async release(issue: LinearIssue): Promise<boolean> {
        if (issue.assigneeId !== runnerId) return false;
        await linear.update(issue.id, { assigneeId: null });
        issue.assigneeId = null;
        deps.log(
          `Unassigned ${issue.identifier} from the Runner app (Linear assigns a linked PR's author)`,
        );
        return true;
      },

      /**
       * After a crash or a timeout: the status from before In Progress comes
       * back (only while the issue is still In Progress), a stop comment with
       * the log's tail is posted, and the Maintainer is assigned.
       */
      async crashed(
        record: ActiveRecord,
        why: string,
        redact: (text: string) => string,
      ): Promise<void> {
        const issue = await linear.issue(record.issue);
        if (issue === undefined) {
          deps.log(`${record.issue} isn't in Linear any more, so its crash goes unreported`);
          return;
        }
        let status = issue.status;
        if (issue.status === STATUS.inProgress) {
          const before = statusBefore((await linear.history(issue.id)).statuses);
          if (before !== undefined) status = before;
          else
            deps.log(
              `${record.issue} has no status before In Progress in its history, so it stays In Progress`,
            );
        }
        const log = record.runs.at(-1)?.log;
        let lines: string[] = [];
        if (log !== undefined) {
          try {
            lines = readFileSync(log, "utf8").split("\n");
          } catch {
            lines = [];
          }
        }
        const tail = logTail(lines).map(redact);
        await stop(issue, crashStop({ kind: record.kind, issue: record.issue, status, why }), tail);
      },
    };
  } catch (error) {
    await deps.broker.endLinearToken(minted.id).catch(() => undefined);
    throw error;
  }
}
