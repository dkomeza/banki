import { STAGE_KINDS, type StageKind } from "../cli/args";
import { asObject, asString, isRecord, ParseError } from "../lib/parse";

// A Stage's result (`references/stages.md` § The result), as the Stage writes
// it to `<wt>/.ui/stage-result.json` and as its closing comment holds it.
// Read loosely: only the fields the Dispatcher acts on are checked, and the
// rest is kept as it was written. Pure, so it is unit-tested.

export type Variant = {
  key: string;
  branch: string;
  commit: string;
  slug: string;
  name: string;
  bet: string;
  states: string[];
};

/** A wait a stop came from: the reply restarts it, rather than a Stage. */
export const WAITS = ["slug-previews", "claude-review", "pr-preview"] as const;
export type Wait = (typeof WAITS)[number];

export type KeptCommit = { sha: string; worktree: string };

export type StageResult = {
  stage: StageKind;
  issue: string;
  outcome: "done" | "stopped";
  summary: string;
  nextStatus: string;
  question: string | null;
  /** A stop's options, the recommended one first. */
  options: string[];
  /** The local commits a stop kept, unpushed. */
  keptCommits: KeptCommit[];
  pr: number | null;
  headSha: string | null;
  pushed: boolean;
  roundsEnded: boolean | null;
  routes: string[];
  variants: Variant[];
  /** Only on a stop the Dispatcher made when a wait failed. */
  wait: Wait | null;
};

const isKind = (value: unknown): value is StageKind =>
  (STAGE_KINDS as readonly unknown[]).includes(value);
const isWait = (value: unknown): value is Wait => (WAITS as readonly unknown[]).includes(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const optionalString = (value: unknown) => (typeof value === "string" ? value : null);

export function parseResult(value: unknown): StageResult {
  const body = asObject(value, "result");
  const stage = asString(body.stage, "result.stage");
  if (!isKind(stage)) throw new ParseError(`result.stage: no Stage ${JSON.stringify(stage)}`);
  const outcome = body.outcome;
  if (outcome !== "done" && outcome !== "stopped") {
    throw new ParseError("result.outcome: expected done or stopped");
  }
  const wait = isWait(body.wait) ? body.wait : null;
  return {
    stage,
    issue: asString(body.issue, "result.issue"),
    outcome,
    summary: typeof body.summary === "string" ? body.summary : "",
    nextStatus: asString(body.nextStatus, "result.nextStatus"),
    question: optionalString(body.question),
    options: strings(body.options),
    keptCommits: Array.isArray(body.keptCommits)
      ? body.keptCommits
          .filter(isRecord)
          .flatMap((kept) =>
            typeof kept.sha === "string" && typeof kept.worktree === "string"
              ? [{ sha: kept.sha, worktree: kept.worktree }]
              : [],
          )
      : [],
    pr: typeof body.pr === "number" && Number.isInteger(body.pr) ? body.pr : null,
    headSha: optionalString(body.headSha),
    pushed: body.pushed === true,
    roundsEnded: typeof body.roundsEnded === "boolean" ? body.roundsEnded : null,
    routes: strings(body.routes),
    variants: Array.isArray(body.variants)
      ? body.variants.filter(isRecord).flatMap((variant) => {
          const fields = ["key", "branch", "commit", "slug", "name", "bet"] as const;
          if (!fields.every((field) => typeof variant[field] === "string")) return [];
          return [
            {
              key: String(variant.key),
              branch: String(variant.branch),
              commit: String(variant.commit),
              slug: String(variant.slug),
              name: String(variant.name),
              bet: String(variant.bet),
              states: strings(variant.states),
            },
          ];
        })
      : [],
    wait,
  };
}
