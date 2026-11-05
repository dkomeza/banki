import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MODEL_ID, type Model, type ModelId, RATINGS, type Rating } from "@banki/shared";
import type { OpenRouterFetch } from "../../openrouter/check-api-key";
import { grade } from "../grade";
import type { ReadImage } from "../request";
import type { EvalSample } from "./samples";

/** What one Model suggested for one sample: a Rating, or `"failed"` when grading failed. */
export type Suggestion = Rating | "failed";

/** A curated Model, by its ID on the list. */
export type EvalModel = Model & { id: ModelId };

/** Each Model's suggestion for each sample, by Model ID, in the samples' order. */
export type EvalResults = Map<ModelId, Suggestion[]>;

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
 * Grades every sample with every Model, on the real OpenRouter: one Model at
 * a time, its samples at once, so one key isn't sent a burst it is
 * rate-limited for.
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
}): Promise<EvalResults> {
  const results: EvalResults = new Map();
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
          });
          return "failed" in result ? "failed" : result.rating;
        }),
      ),
    );
  }
  return results;
}

/** A table cell: the suggestion, with ⚠ when it is two or more steps off. */
const cell = (suggestion: Suggestion | undefined, expected: Rating) => {
  if (suggestion === undefined || suggestion === "failed") return "failed";
  return stepsApart(suggestion, expected) >= 2 ? `${suggestion} ⚠` : suggestion;
};

/**
 * The eval's table, in Markdown: a row per sample, with the expected Rating
 * and each Model's suggestion beside it, ⚠ on one two or more steps off; and
 * the samples the default Model got two or more steps off, which fail it.
 */
export function report(
  results: EvalResults,
  models: readonly EvalModel[],
  samples: readonly EvalSample[],
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
  ];
  const failures = samples.flatMap((sample, i) => {
    const suggestion = results.get(DEFAULT_MODEL_ID)?.[i];
    if (suggestion === undefined || suggestion === "failed") return [];
    return stepsApart(suggestion, sample.expected) >= 2
      ? [`${sample.name}: expected ${sample.expected}, got ${suggestion}`]
      : [];
  });
  return { table: lines.join("\n"), failures };
}
