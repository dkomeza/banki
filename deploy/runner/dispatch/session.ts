import { readFileSync } from "node:fs";
import type { Broker } from "../cli/broker-client";
import { issueBranchOf } from "../cli/plan";
import { errorText } from "../lib/config";
import { type Closing, closingComment, closingsOf, MAINTAINER } from "./closing";
import { type GitHub, newestFor, type SlugDeployment } from "./github";
import {
  crashStop,
  type ActiveRecord,
  type Outcome,
  statusBefore,
  type Unposted,
} from "./lifecycle";
import { type Linear, type LinearIssue, moveTo } from "./linear";
import type { StageResult } from "./result";
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

    /** The tip of the issue's branch on origin, or undefined when GitHub can't say. */
    async function tipOf(
      issue: LinearIssue,
      say: (line: string) => void,
    ): Promise<string | undefined> {
      try {
        return await github.branchHead(await branchOf(issue));
      } catch (error) {
        say(
          `Couldn't read the tip of ${issue.identifier}'s branch from GitHub: ${errorText(error)}`,
        );
        return undefined;
      }
    }

    /** The stop a crash makes: the status from before In Progress comes back, while the issue is still In Progress. */
    async function crashStopOf(issue: LinearIssue, record: ActiveRecord, why: string) {
      let status = issue.status;
      if (issue.status === STATUS.inProgress) {
        const before = statusBefore((await linear.history(issue.id)).statuses);
        if (before !== undefined) status = before;
        else
          deps.log(
            `${record.issue} has no status before In Progress in its history, so it stays In Progress`,
          );
      }
      return crashStop({ kind: record.kind, issue: record.issue, status, why });
    }

    /** The closing comment the record's last run posted already, if it did. */
    async function closingOfRun(
      issue: LinearIssue,
      record: ActiveRecord,
    ): Promise<Closing | undefined> {
      const runStart = record.runs.at(-1)?.startedAt;
      if (runStart === undefined) return undefined;
      return closingsOf(await linear.comments(issue.id), {
        runner: runnerId,
        issue: issue.identifier,
      })
        .filter((closing) => closing.result.stage === record.kind && closing.at >= runStart)
        .at(-1);
    }

    /**
     * Unassigns the issue (in Linear, and in `issue`) when it is the Runner
     * app's: Linear assigns a linked PR's author, and only a person's
     * assignment holds an issue. Says whether it did.
     */
    async function release(issue: LinearIssue): Promise<boolean> {
      if (issue.assigneeId !== runnerId) return false;
      await linear.update(issue.id, { assigneeId: null });
      issue.assigneeId = null;
      deps.log(
        `Unassigned ${issue.identifier} from the Runner app (Linear assigns a linked PR's author)`,
      );
      return true;
    }

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
          design[variant.slug] =
            found === undefined
              ? null
              : { ...(await github.newestStatus(found.id)), createdAt: found.createdAt };
        }
        return decide(facts, now, { design });
      },

      stop,

      release,

      tipOf,

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
        await stop(issue, await crashStopOf(issue, record, why), tailOf(record, redact));
      },

      /**
       * Posts how the Stage ended and moves its issue on: its closing comment,
       * with the branch's real tip, and the status its result names, or a
       * crash's stop. A closing comment its last run posted already isn't
       * posted again, so a close that failed half way can be tried again, by
       * its supervisor or by the next tick.
       */
      async close(
        record: ActiveRecord,
        unposted: Unposted,
        say: (line: string) => void,
      ): Promise<Outcome> {
        const found = await linear.issue(record.issue);
        if (found === undefined) throw new Error(`Linear has no issue ${record.issue}`);
        const posted = await closingOfRun(found, record);
        let result: StageResult;
        if (posted !== undefined) {
          result = posted.result;
        } else if (unposted.type === "closing") {
          // The branch's real tip, and whether it moved, over what the Stage wrote.
          const headAfter = await tipOf(found, say);
          const pushed =
            record.headBefore !== undefined && headAfter !== undefined
              ? record.headBefore !== headAfter
              : unposted.result.pushed;
          const headSha = headAfter ?? unposted.result.headSha;
          result = { ...unposted.result, headSha, pushed };
          await linear.comment(
            found.id,
            closingComment(result, { ...unposted.json, headSha, pushed }),
          );
        } else {
          result = await crashStopOf(found, record, unposted.why);
          await linear.comment(found.id, closingComment(result, { ...result }, unposted.tail));
        }
        const assignee = result.outcome === "stopped" ? MAINTAINER.linearId : undefined;
        if (found.status === STATUS.inProgress && result.nextStatus !== found.status) {
          await moveTo(linear, found, result.nextStatus, assignee);
        } else if (assignee !== undefined) {
          await linear.update(found.id, { assigneeId: assignee });
        }
        if (assignee === undefined) {
          // A PR the Stage opened got the issue assigned to the Runner app; one
          // linked after this read, or a release that fails, is the next tick's.
          try {
            const fresh = await linear.issue(record.issue);
            if (fresh !== undefined) await release(fresh);
          } catch (error) {
            say(
              `Couldn't undo the Runner app's assignment of ${record.issue}: ${errorText(error)}`,
            );
          }
        }
        return unposted.type === "crash" ? unposted.outcome : result.outcome;
      },
    };
  } catch (error) {
    await deps.broker.endLinearToken(minted.id).catch(() => undefined);
    throw error;
  }
}

/** The last 30 events of the record's last run's log, redacted. */
export function tailOf(record: ActiveRecord, redact: (text: string) => string): string[] {
  const log = record.runs.at(-1)?.log;
  let lines: string[] = [];
  if (log !== undefined) {
    try {
      lines = readFileSync(log, "utf8").split("\n");
    } catch {
      lines = [];
    }
  }
  return logTail(lines).map(redact);
}
