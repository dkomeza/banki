import { z } from "zod";

/** A rating from 1 (the least) to 3 (the most). */
export type Rating = 1 | 2 | 3;

/**
 * A Model the Grader can run: one of Banki's curated list, each able to take
 * images and give structured output on OpenRouter. What a User who doesn't
 * follow LLMs needs to choose: its name, maker, one plain sentence, and how
 * it does on handwriting, speed and cost.
 */
export type Model = {
  /** The OpenRouter model ID. */
  id: string;
  name: string;
  maker: string;
  sentence: string;
  /** How well it reads handwriting, or `"untested"` when nobody has measured it. */
  handwriting: Rating | "untested";
  speed: Rating;
  /** 1 is the cheapest. */
  cost: Rating;
};

/**
 * The curated list, in the order Settings shows it. A Model is added or
 * removed by a Banki release; there is no custom model ID.
 *
 * Handwriting comes from WildHandBench, the UIUC handwritten-math grading
 * study (arXiv 2605.19043) and Roboflow's OCR evals; cost from OpenRouter's
 * prices, at roughly 2k tokens in and 500 out per answer; speed is a judgment
 * call, since OpenRouter publishes no latency figures for these (checked
 * 2026-10-24).
 */
export const MODELS = [
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Claude Haiku 5.5",
    maker: "Anthropic",
    sentence:
      "Quick and inexpensive. Grades typed answers well, but misreads messy handwriting more often.",
    handwriting: 2,
    speed: 3,
    cost: 1,
  },
  {
    id: "openai/gpt-6-luna",
    name: "GPT-6 Luna",
    maker: "OpenAI",
    sentence: "Quick and inexpensive, much like Claude Haiku.",
    handwriting: 2,
    speed: 3,
    cost: 1,
  },
  {
    id: "z-ai/glm-5.3-flash",
    name: "GLM-5.3 Flash",
    maker: "Z.ai",
    sentence: "Inexpensive, but not yet tested on handwriting, so results may vary.",
    handwriting: "untested",
    speed: 2,
    cost: 1,
  },
  {
    id: "google/gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    maker: "Google",
    sentence: "Reads handwritten math most reliably. A little slower, and about 8× the price.",
    handwriting: 3,
    speed: 2,
    cost: 3,
  },
] as const satisfies readonly Model[];

/** The ID of a Model on the curated list. */
export type ModelId = (typeof MODELS)[number]["id"];

export const isModelId = (id: string): id is ModelId => MODELS.some((model) => model.id === id);

/** A Model on the curated list, by its OpenRouter ID. */
export const ModelId = z.custom<ModelId>(
  (value) => typeof value === "string" && isModelId(value),
  "Expected a Model on Banki's list",
);

/** The Model a User has until they pick one: Claude Haiku 5.5. */
export const DEFAULT_MODEL_ID: ModelId = "anthropic/claude-haiku-5.5";

/** The curated Model with `id`. */
export const modelById = (id: ModelId): Model =>
  MODELS.find((model) => model.id === id) ?? MODELS[0];
/**
 * The Model a stored ID stands for: the default when none is stored, or when
 * a later release dropped it from the list.
 */
export const effectiveModelId = (stored: string | null | undefined): ModelId =>
  stored != null && isModelId(stored) ? stored : DEFAULT_MODEL_ID;
