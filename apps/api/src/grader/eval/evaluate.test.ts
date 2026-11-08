import { describe, expect, test } from "bun:test";
import {
  CardSide,
  DEFAULT_MODEL_ID,
  GradingNotes,
  MacroList,
  MODELS,
  type Rating,
  RATINGS,
} from "@banki/shared";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type EvalResults,
  report,
  staleTemperatureFlags,
  stepsApart,
  type Suggestion,
} from "./evaluate";
import { type EvalSample, SAMPLES } from "./samples";

describe("SAMPLES", () => {
  test("are Cards Banki would store, with answers and expected Ratings", () => {
    for (const sample of SAMPLES) {
      expect(CardSide.safeParse(sample.front).success).toBe(true);
      expect(CardSide.safeParse(sample.back).success).toBe(true);
      expect(GradingNotes.safeParse(sample.gradingNotes).success).toBe(true);
      expect(MacroList.safeParse(sample.macros).success).toBe(true);
      expect(sample.answer.trim()).not.toBe("");
      expect(RATINGS).toContain(sample.expected);
      if (sample.image !== undefined) {
        expect(sample.front + sample.back).toContain(`images/${sample.image}`);
        expect(existsSync(join(import.meta.dir, "images", sample.image))).toBe(true);
      }
    }
  });
});

describe("stepsApart", () => {
  test("counts the Ratings between two", () => {
    expect(stepsApart("good", "good")).toBe(0);
    expect(stepsApart("hard", "good")).toBe(1);
    expect(stepsApart("again", "good")).toBe(2);
    expect(stepsApart("easy", "again")).toBe(3);
  });
});

/** A sample to report on, expecting `expected`. */
const sample = (name: string, expected: Rating): EvalSample => ({
  name,
  front: "f",
  back: "b",
  gradingNotes: null,
  macros: [],
  answer: "a",
  expected,
});

describe("report", () => {
  const samples = [sample("First", "good"), sample("Second", "again")];
  const [byDefault, other] = [
    MODELS.filter((model) => model.id === DEFAULT_MODEL_ID),
    MODELS.filter((model) => model.id !== DEFAULT_MODEL_ID).slice(0, 1),
  ];
  const models = [...byDefault, ...other];
  const otherId = other[0]?.id ?? DEFAULT_MODEL_ID;
  const results = (mine: Suggestion[], theirs: Suggestion[] = mine): EvalResults =>
    new Map([
      [DEFAULT_MODEL_ID, mine],
      [otherId, theirs],
    ]);

  test("puts each Model's Rating beside the expected one, marking the default Model", () => {
    const { table } = report(results(["good", "failed"], ["easy", "hard"]), models, samples);
    expect(table.split("\n")[0]).toContain("(default)");
    expect(table).toContain("| First | good | good | easy |");
    expect(table).toContain("| Second | again | failed | hard |");
  });

  test("ends with each Model's cost, n/a when it reported none", () => {
    const costs = new Map([[DEFAULT_MODEL_ID, 0.01234]]);
    const { table } = report(results(["good", "again"]), models, samples, costs);
    expect(table.split("\n").at(-1)).toBe("| Cost | | $0.0123 | n/a |");
  });

  test("passes the default Model a step off, or failing to grade", () => {
    expect(report(results(["hard", "failed"]), models, samples).failures).toEqual([]);
  });

  test("fails the default Model two or more steps off, but not another Model", () => {
    const theirsOff = report(results(["good", "again"], ["again", "easy"]), models, samples);
    expect(theirsOff.failures).toEqual([]);
    expect(theirsOff.table).toContain("again ⚠");

    const { failures } = report(results(["good", "good"]), models, samples);
    expect(failures).toEqual(["Second: expected again, got good"]);
  });
});

/** An OpenRouter whose catalog lists these Models, by whether each takes `temperature`. */
const catalog = (listed: Record<string, boolean>) => async () =>
  Response.json({
    data: Object.entries(listed).map(([id, takes]) => ({
      id,
      supported_parameters: takes ? ["temperature", "max_tokens"] : ["max_tokens"],
    })),
  });

describe("staleTemperatureFlags", () => {
  test("is empty when every flag matches the catalog", async () => {
    const listed = Object.fromEntries(MODELS.map((m) => [m.id, m.temperature]));
    expect(await staleTemperatureFlags(catalog(listed), MODELS)).toEqual([]);
  });

  test("names a Model whose flag is stale, or that is gone", async () => {
    const [first, second] = MODELS;
    const stale = await staleTemperatureFlags(
      catalog({ [first?.id ?? ""]: !first?.temperature }),
      [first, second].flatMap((m) => (m ? [m] : [])),
    );
    expect(stale).toEqual([
      `${first?.id}: temperature is ${first?.temperature} here, ${!first?.temperature} on OpenRouter`,
      `${second?.id}: no longer on OpenRouter`,
    ]);
  });

  test("is no evidence when the catalog can't be read", async () => {
    expect(
      await staleTemperatureFlags(async () => new Response("", { status: 500 }), MODELS),
    ).toEqual([]);
  });
});
