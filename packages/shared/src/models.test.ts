import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_ID, MODELS, ModelId, effectiveModelId, modelById } from "./models";

describe("MODELS", () => {
  test("is the curated list, in order, with what each one is good at", () => {
    expect(
      MODELS.map(({ id, name, maker, handwriting, speed, cost }) => [
        id,
        `${name} · ${maker}`,
        handwriting,
        speed,
        cost,
      ]),
    ).toEqual([
      ["anthropic/claude-haiku-5.5", "Claude Haiku 5.5 · Anthropic", 2, 3, 1],
      ["openai/gpt-6-luna", "GPT-6 Luna · OpenAI", 2, 3, 1],
      ["z-ai/glm-5.3-flash", "GLM-5.3 Flash · Z.ai", "untested", 2, 1],
      ["google/gemini-3.8-flash", "Gemini 3.8 Flash · Google", 3, 2, 3],
    ]);
    expect(MODELS.map((model) => model.sentence)).toEqual([
      "Quick and inexpensive. Grades typed answers well, but misreads messy handwriting more often.",
      "Quick and inexpensive, much like Claude Haiku.",
      "Inexpensive, but not yet tested on handwriting, so results may vary.",
      "Reads handwritten math most reliably. A little slower, and about 8× the price.",
    ]);
  });

  test("defaults to Claude Haiku 5.5", () => {
    expect(DEFAULT_MODEL_ID).toBe("anthropic/claude-haiku-5.5");
    expect(modelById(DEFAULT_MODEL_ID).name).toBe("Claude Haiku 5.5");
  });
});

describe("ModelId", () => {
  test("takes a Model on the list and refuses any other ID", () => {
    expect(ModelId.parse("google/gemini-3.8-flash")).toBe("google/gemini-3.8-flash");
    expect(ModelId.safeParse("openai/gpt-4o").success).toBe(false);
  });
});

describe("effectiveModelId", () => {
  test("keeps a stored Model on the list", () => {
    expect(effectiveModelId("openai/gpt-6-luna")).toBe("openai/gpt-6-luna");
  });

  test.each([null, undefined, "mistral/retired-model"])(
    "falls back to the default for %p",
    (stored) => {
      expect(effectiveModelId(stored)).toBe(DEFAULT_MODEL_ID);
    },
  );
});
