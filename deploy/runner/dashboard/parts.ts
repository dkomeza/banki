import type { Outcome } from "../dispatch/lifecycle";
import type { Wait } from "../dispatch/result";
import type { WaitOn } from "../dispatch/select";
import { flagText, unclaimedFor } from "./flags";
import { type Html, markup, time } from "./html";

// The pieces the Now page and the issue page share: what an outcome is
// called, what a wait waits for, and a wait's deadline with its deployments'
// states and the pull agent's flags. Pure, so it is unit-tested with them.

export type Label = Outcome | "never-started" | "running" | "paused";

export const LABELS: Record<Label, string> = {
  done: "done",
  stopped: "stopped",
  crashed: "crashed",
  "timed-out": "timed out",
  "no-result": "no result",
  lost: "lost",
  abandoned: "abandoned",
  "never-started": "never started",
  running: "running",
  paused: "paused",
};

/** An outcome's badge. */
export const outcome = (label: Label): Html =>
  markup`<span class="outcome outcome-${label}">${LABELS[label]}</span>`;

export const WAIT_NAMES: Record<Wait, string> = {
  "slug-previews": "the Slug Previews",
  "claude-review": "claude-review",
  "pr-preview": "the PR Preview",
};

/** A wait: since when, its deadline and how far along it is, and each deployment's newest state. */
export function waitDetail(on: WaitOn, now: Date, tz: string | undefined): Html {
  const since = Date.parse(on.since);
  const elapsed = Math.max(0, now.getTime() - since);
  const total = Math.round(on.deadlineMs / 60_000);
  const minutes = Math.min(Math.floor(elapsed / 60_000), 9_999);
  const late = elapsed > on.deadlineMs;
  const deployments = on.deployments.map(({ name, deployment }) => {
    const flagged = unclaimedFor(deployment, now);
    const state =
      deployment?.state ?? (deployment === null ? "no deployment yet" : "no status yet");
    // One that is up waits for nothing more.
    const along = state === "success" ? "" : `, ${minutes} min of ${total}`;
    return markup`<li><code>${name}</code>: ${state}${along}${flagged === undefined ? "" : markup` <strong class="flag">${flagText(flagged)}</strong>`}</li>`;
  });
  return markup`<div class="wait">
    <p>
      Waiting for ${WAIT_NAMES[on.wait]} since ${time(on.since, tz)}, until
      ${time(new Date(since + on.deadlineMs).toISOString(), tz)}:
      <span class="${late ? "late" : ""}">${minutes} min of ${total}</span>
    </p>
    <progress max="${total}" value="${Math.min(minutes, total)}">
      ${minutes} min of ${total}
    </progress>
    ${
      deployments.length === 0
        ? ""
        : markup`<ul>
            ${deployments}
          </ul>`
    }
  </div>`;
}
