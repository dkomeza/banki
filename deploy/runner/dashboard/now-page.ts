import { FIVE_HOUR_LIMIT, percent } from "../dispatch/gate";
import { isUrgent } from "../dispatch/queue";
import { supervisorLog } from "../dispatch/spawn";
import { flagText } from "./flags";
import { dollars, duration, type Html, markup, issueLink, page, time } from "./html";
import type { LiveView } from "./live";
import { outcome, waitDetail } from "./parts";
import { logHref } from "./paths";

// The Now page (`/`): what `runner status` shows, live, from the same view.
// The Stages running (with their cost so far) and paused, the ready queue
// with why each would or wouldn't start, what the Dispatcher waits on with
// each wait's deadline and its deployments' states, the issues it skips
// because someone holds them, the gate's last reading against the Ceiling,
// the In Progress issues no supervisor started, the recent Stages, and the
// deployments the pull agent hasn't claimed. Its live part is also what
// /events sends every 30 seconds. Pure, so it is unit-tested.

const section = (title: string, body: Html | Html[], empty: string, count?: number) =>
  markup`<section>
    <h2>${title}</h2>
    ${count === 0 || (Array.isArray(body) && body.length === 0) ? markup`<p class="empty">${empty}</p>` : body}
  </section>`;

/** The part of the Now page that changes, which /events sends again every 30 seconds. */
export function nowFragment(live: LiveView, tz: string | undefined): string {
  const { status } = live;
  const now = new Date(live.at);
  const parts: Html[] = [];
  parts.push(
    markup`<p class="meta">
      As of
      ${time(live.at, tz)}${status.closed === undefined ? "" : markup`, <strong>${status.closed}</strong>: only an urgent issue starts now`}.
    </p>`,
  );
  if (live.error !== undefined) {
    parts.push(
      markup`<p class="error">
        Linear or GitHub couldn't be read: ${live.error}. What follows is the volume's alone.
      </p>`,
    );
  }

  parts.push(
    section(
      "Running",
      status.running.length === 0
        ? []
        : markup`<table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Stage</th>
                <th>For</th>
                <th>Cost so far</th>
                <th>Log</th>
              </tr>
            </thead>
            <tbody>
              ${status.running.map((record) => {
                const run = record.runs.at(-1);
                return markup`<tr>
                  <td>${issueLink(record.issue)}</td>
                  <td>${record.kind}</td>
                  <td>
                    ${
                      run === undefined
                        ? "starting"
                        : run.endedAt === undefined
                          ? duration(now.getTime() - Date.parse(run.startedAt))
                          : // Its supervisor is posting the result: the run is over, the Stage not yet.
                            `${duration(Date.parse(run.endedAt) - Date.parse(run.startedAt))}, finishing`
                    }
                  </td>
                  <td>${dollars(live.spent[record.issue] ?? 0)}</td>
                  <td>
                    ${run === undefined ? "" : markup`<a href="${logHref(record.issue, run.log)}">log</a> · <a href="${logHref(record.issue, supervisorLog(run.log))}">supervisor</a>`}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>`,
      "None.",
    ),
  );
  parts.push(
    section(
      "Paused",
      status.paused.length === 0
        ? []
        : markup`<ul>
            ${status.paused.map(
              (record) =>
                markup`<li>
                  ${issueLink(record.issue)} ${record.kind}, by the five-hour limit until
                  ${record.resetsAt === undefined ? "?" : time(record.resetsAt, tz)},
                  ${dollars(live.spent[record.issue] ?? 0)} so far
                </li>`,
            )}
          </ul>`,
      "None.",
    ),
  );
  parts.push(
    section(
      `Ready, in order${status.closed === undefined ? "" : ` (${status.closed})`}`,
      status.queue.length === 0
        ? []
        : markup`<ol>
            ${status.queue.map((verdict) => {
              const verdictText = verdict.start
                ? status.closed === undefined || isUrgent(verdict.ready)
                  ? "would start now"
                  : "would fit the gate"
                : `waits: ${verdict.why}`;
              return markup`<li>
                ${issueLink(verdict.ready.issue)}
                ${verdict.ready.stage}${verdict.ready.resume === true ? " (resume)" : ""}:
                <span class="${verdict.start ? "ok" : "no"}">${verdictText}</span>
              </li>`;
            })}
          </ol>`,
      live.error === undefined ? "Nothing." : "Not known: Linear couldn't be read.",
    ),
  );
  parts.push(
    section(
      "Waiting",
      status.waiting.length === 0
        ? []
        : markup`<ul class="waits">
            ${status.waiting.map(
              (wait) =>
                markup`<li>
                  ${issueLink(wait.issue)} (${wait.status}):
                  ${wait.what}${wait.on === undefined ? "" : waitDetail(wait.on, now, tz)}
                </li>`,
            )}
          </ul>`,
      live.error === undefined ? "Nothing." : "Not known: Linear couldn't be read.",
    ),
  );

  parts.push(
    section(
      "Held, skipped while assigned",
      status.held.length === 0
        ? []
        : markup`<ul>
            ${status.held.map(
              (held) => markup`<li>${issueLink(held.issue)} (${held.status}): ${held.what}</li>`,
            )}
          </ul>`,
      live.error === undefined ? "None." : "Not known: Linear couldn't be read.",
    ),
  );

  const reading = status.gate?.reading;
  const gate: Html[] = [];
  if (reading !== undefined) {
    gate.push(
      markup`<p>
          At ${time(reading.at, tz)}: the week at
          <strong>${percent(reading.sevenDay.utilization)}</strong> of the Ceiling's
          ${percent(live.ceiling)} (starts over ${time(reading.sevenDay.resetsAt, tz)}); the five
          hours at <strong>${percent(reading.fiveHour.utilization)}</strong> of
          ${percent(FIVE_HOUR_LIMIT)} (starts over ${time(reading.fiveHour.resetsAt, tz)}).
        </p>
        <p>
          <meter min="0" max="1" high="${live.ceiling}" value="${reading.sevenDay.utilization}">
            ${percent(reading.sevenDay.utilization)}
          </meter>
        </p>`,
    );
  } else {
    gate.push(markup`<p class="empty">No reading taken yet.</p>`);
  }
  if (status.gate?.error !== undefined)
    gate.push(
      markup`<p class="error">
        The last reading failed at ${time(status.gate.at, tz)}: ${status.gate.error}
      </p>`,
    );
  gate.push(
    markup`<p>
      Estimates:
      ${Object.entries(status.estimates)
        .map(([kind, value]) => `${kind} ${percent(value)}`)
        .join(", ")}.
    </p>`,
  );
  parts.push(section("Gate", gate, ""));

  const flags: Html[] =
    live.flags.length === 0
      ? [
          markup`<p class="empty">
            ${live.flagsError === undefined ? "Every Preview deployment is claimed." : `Not known: ${live.flagsError}`}
          </p>`,
        ]
      : [
          markup`<ul>
            ${live.flags.map(
              (flag) =>
                markup`<li>
                  <code>${flag.name}</code> (${flag.environment}): ${flag.state ?? "no status"}
                  since ${time(flag.createdAt, tz)},
                  <strong class="flag">${flagText(flag.minutes)}</strong>
                </li>`,
            )}
          </ul>`,
        ];
  parts.push(section("The pull agent", flags, ""));

  parts.push(
    section(
      "In Progress, not started by a supervisor of the Runner",
      status.orphans.length === 0
        ? []
        : markup`<ul>
            ${status.orphans.map((issue) => markup`<li>${issueLink(issue)}</li>`)}
          </ul>`,
      live.error === undefined ? "None." : "Not known: Linear couldn't be read.",
    ),
  );
  parts.push(
    section(
      "Recent Stages",
      status.recent.length === 0
        ? []
        : markup`<table>
            <thead>
              <tr>
                <th>Ended</th>
                <th>Issue</th>
                <th>Stage</th>
                <th>Outcome</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              ${status.recent.map(
                ({ record, cost }) =>
                  markup`<tr>
                    <td>${time(record.endedAt, tz)}</td>
                    <td>${issueLink(record.issue)}</td>
                    <td>${record.kind}</td>
                    <td>${outcome(record.outcome)}</td>
                    <td>
                      ${cost === undefined ? "not known" : percent(cost)}${record.runs.length > 1 ? ` over ${record.runs.length} runs` : ""}
                    </td>
                  </tr>`,
              )}
            </tbody>
          </table>`,
      "None yet.",
    ),
  );
  return parts.map((part) => part.html).join("\n");
}

export function nowPage(live: LiveView, tz: string | undefined): string {
  return page({
    title: "Now",
    streams: true,
    refreshS: 30,
    body: markup`<h1>The Runner, now</h1>
      <div id="live" data-stream="/events" data-mode="replace">
        ${{ html: nowFragment(live, tz) }}
      </div>`,
  });
}
