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
import { type EvalResults, report, stepsApart, type Suggestion } from "./evaluate";
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
