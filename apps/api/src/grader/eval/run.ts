import { appendFileSync } from "node:fs";
import { MODELS, modelById, DEFAULT_MODEL_ID } from "@banki/shared";
import { configure, getConsoleSink } from "@logtape/logtape";
import { report, runEval, staleTemperatureFlags } from "./evaluate";
import { SAMPLES } from "./samples";

// The Grader's eval: every curated Model over the samples, on the real
// OpenRouter, with the key in OPENROUTER_API_KEY. It prints each Model's
// Rating beside the expected one, adds the table to the GitHub job summary
// when there is one, and fails when the default Model is two or more steps
// off on any sample, or fails one with a permanent error (an API key
// OpenRouter refuses, no credits, a Model it can't run). With no key, it
// skips. README § The Grader's eval.

const summary = (text: string) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file !== undefined && file !== "") appendFileSync(file, `${text}\n`);
};

const apiKey = process.env.OPENROUTER_API_KEY ?? "";
if (apiKey === "") {
  const note = "The Grader's eval skipped: no OPENROUTER_API_KEY.";
  console.log(note);
  summary(note);
  process.exit(0);
}

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["banki"], sinks: ["console"], lowestLevel: "warning" },
    { category: ["logtape", "meta"], sinks: [], lowestLevel: "warning" },
  ],
});

const { results, costs } = await runEval({
  apiKey,
  fetch: (input, init) => fetch(input, init),
  models: MODELS,
  samples: SAMPLES,
});
const { table, failures } = report(results, MODELS, SAMPLES, costs);
console.log(table);
summary(`## The Grader's eval\n\n${table}\n`);

const stale = await staleTemperatureFlags((input, init) => fetch(input, init), MODELS);
if (stale.length > 0) {
  const message = `A Model's temperature flag in models.ts is stale:\n${stale.map((s) => `- ${s}`).join("\n")}`;
  console.error(message);
  summary(message);
  process.exitCode = 1;
}

const model = modelById(DEFAULT_MODEL_ID).name;
// A sample the default Model couldn't grade after its retries doesn't fail the eval, but says so.
const unsure = (results.get(DEFAULT_MODEL_ID) ?? []).filter((s) => s === "failed").length;
if (unsure > 0) {
  const warning = `⚠ ${model}, the default Model, failed to grade ${unsure} of ${SAMPLES.length} samples (see the log for OpenRouter's status).`;
  console.warn(warning);
  summary(warning);
}
if (failures.length > 0) {
  const message = `${model}, the default Model, is two or more steps off, or failed with a permanent error, on:\n${failures.map((f) => `- ${f}`).join("\n")}`;
  console.error(message);
  summary(message);
  process.exit(1);
}
console.log(`${model}, the default Model, is within a step on every sample it graded.`);
