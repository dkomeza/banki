import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MODEL_ID, type Model, type ModelId, RATINGS, type Rating } from "@banki/shared";
import { z } from "zod";
import type { OpenRouterFetch } from "../../openrouter/check-api-key";
import { type GradingFailure, grade } from "../grade";
import type { ReadImage } from "../request";
import type { EvalSample } from "./samples";

/** The permanent errors OpenRouter can answer a Model with: never retried, and named in the table. */
export type PermanentError = Exclude<GradingFailure, "grading_failed" | "cancelled">;

/**
 * What one Model suggested for one sample: a Rating, `"failed"` when
 * grading failed after its retries, or the permanent error it failed with.
 */
export type Suggestion = Rating | "failed" | PermanentError;

/** Whether a suggestion is a Rating, not a failure. */
const isRating = (suggestion: Suggestion | undefined): suggestion is Rating =>
  (RATINGS as readonly string[]).includes(suggestion ?? "");

/** Whether a suggestion is a permanent error. */
const isPermanentError = (suggestion: Suggestion | undefined): suggestion is PermanentError =>
  suggestion !== undefined && suggestion !== "failed" && !isRating(suggestion);

/** A curated Model, by its ID on the list. */
export type EvalModel = Model & { id: ModelId };

/** Each Model's suggestion for each sample, by Model ID, in the samples' order. */
export type EvalResults = Map<ModelId, Suggestion[]>;

/** What each Model cost over the samples, in US dollars, by Model ID. */
export type EvalCosts = Map<ModelId, number>;

/** How many steps apart two Ratings are: Again to Good is 2. */
export const stepsApart = (a: Rating, b: Rating) =>
  Math.abs(RATINGS.indexOf(a) - RATINGS.indexOf(b));

/** The eval's Images, from this folder's `images/`, as PNGs. */
const readSampleImage: ReadImage = (file) => {
  try {
    return { contentType: "image/png", bytes: readFileSync(join(import.meta.dir, "images", file)) };
  } catch {
    return undefined;
  }
};

/**
 * Grades every sample with every Model, on the real OpenRouter, through the
 * Grader's `grade()` and its retries: one Model at a time, its samples at
 * once, so one key isn't sent a burst it is rate-limited for.
 */
export async function runEval({
  apiKey,
  fetch,
  models,
  samples,
}: {
  apiKey: string;
  fetch: OpenRouterFetch;
  models: readonly EvalModel[];
  samples: readonly EvalSample[];
}): Promise<{ results: EvalResults; costs: EvalCosts }> {
  const results: EvalResults = new Map();
  const costs: EvalCosts = new Map();
  for (const model of models) {
    results.set(
      model.id,
      await Promise.all(
        samples.map(async (sample): Promise<Suggestion> => {
          const result = await grade(sample, {
            apiKey,
            model: model.id,
            fetch,
            readImage: readSampleImage,
            onCost: (usd) => costs.set(model.id, (costs.get(model.id) ?? 0) + usd),
          });
          if (!("failed" in result)) return result.rating;
          return result.failed === "grading_failed" || result.failed === "cancelled"
            ? "failed"
            : result.failed;
        }),
      ),
    );
  }
  return { results, costs };
}

/** OpenRouter's public model catalog. */
const MODELS_URL = "https://openrouter.ai/api/v1/models";

const Catalog = z.object({
  data: z.array(z.object({ id: z.string(), supported_parameters: z.array(z.string()).optional() })),
});

/**
 * The Models whose `temperature` flag disagrees with the `temperature` that
 * OpenRouter lists for them now, or that it no longer lists. The flag decides
 * whether the Grader sends `temperature`; a stale `true` makes OpenRouter
 * answer 404. Empty when the catalog can't be read, which is no evidence.
 */
export async function staleTemperatureFlags(
  fetch: OpenRouterFetch,
  models: readonly EvalModel[],
): Promise<string[]> {
  let catalog: Map<string, boolean>;
  try {
    const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return [];
    const { data } = Catalog.parse(await res.json());
    catalog = new Map(
      data.map((m) => [m.id, m.supported_parameters?.includes("temperature") === true]),
    );
  } catch {
    return [];
  }
  return models.flatMap((model) => {
    const listed = catalog.get(model.id);
    if (listed === undefined) return [`${model.id}: no longer on OpenRouter`];
    return listed === model.temperature
      ? []
      : [`${model.id}: temperature is ${model.temperature} here, ${listed} on OpenRouter`];
  });
}

/** A table cell: the suggestion, with ⚠ when it is two or more steps off; a permanent error by its code. */
const cell = (suggestion: Suggestion | undefined, expected: Rating) => {
  if (isPermanentError(suggestion)) return `failed: ${suggestion}`;
  if (!isRating(suggestion)) return "failed";
  return stepsApart(suggestion, expected) >= 2 ? `${suggestion} ⚠` : suggestion;
};

/**
 * The eval's table, in Markdown: a row per sample, with the expected Rating
 * and each Model's suggestion beside it, ⚠ on one two or more steps off, then
 * a row of what each Model cost over all the samples; and
 * the samples the default Model got two or more steps off, or failed with a
 * permanent error, which fail it.
 */
export function report(
  results: EvalResults,
  models: readonly EvalModel[],
  samples: readonly EvalSample[],
  costs: EvalCosts = new Map(),
): { table: string; failures: string[] } {
  const names = models.map((model) =>
    model.id === DEFAULT_MODEL_ID ? `${model.name} (default)` : model.name,
  );
  const lines = [
    `| Sample | Expected | ${names.join(" | ")} |`,
    `| --- | --- | ${names.map(() => "---").join(" | ")} |`,
    ...samples.map(
      (sample, i) =>
        `| ${sample.name} | ${sample.expected} | ${models
          .map((model) => cell(results.get(model.id)?.[i], sample.expected))
          .join(" | ")} |`,
    ),
    `| Cost | | ${models
      .map((model) => {
        const usd = costs.get(model.id);
        return usd === undefined ? "n/a" : `$${usd.toFixed(4)}`;
      })
      .join(" | ")} |`,
  ];
  const failures = samples.flatMap((sample, i) => {
    const suggestion = results.get(DEFAULT_MODEL_ID)?.[i];
    if (isPermanentError(suggestion)) return [`${sample.name}: OpenRouter answered ${suggestion}`];
    if (!isRating(suggestion)) return [];
    return stepsApart(suggestion, sample.expected) >= 2
      ? [`${sample.name}: expected ${sample.expected}, got ${suggestion}`]
      : [];
  });
  return { table: lines.join("\n"), failures };
}
