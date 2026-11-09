import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMETERS } from "./fsrs";
import {
  type Optimizer,
  type TrainingItem,
  type TrainingReview,
  libraryOptimizer,
  trainingItems,
  tune,
} from "./tuning";

const at = (iso: string) => new Date(iso);
const UTC4 = { timezone: "UTC", dayStartHour: 4 };

let seq = 0;
const reviewOf = (
  cardId: string,
  iso: string,
  rating: TrainingReview["rating"] = "good",
): TrainingReview => {
  seq += 1;
  return { cardId, seq, reviewedAt: at(iso), rating };
};

describe("trainingItems", () => {
  test("one item per Review after a Card's first, each with the Reviews before it, in Study days", () => {
    const reviews = [
      reviewOf("c1", "2026-05-01T10:00:00Z", "again"),
      reviewOf("c1", "2026-05-01T10:10:00Z", "good"),
      reviewOf("c1", "2026-05-03T09:00:00Z", "hard"),
      reviewOf("c1", "2026-05-10T09:00:00Z", "easy"),
    ];

    expect(trainingItems(reviews, [], UTC4)).toEqual([
      [
        { rating: 1, deltaT: 0 },
        { rating: 3, deltaT: 0 },
        { rating: 2, deltaT: 2 },
      ],
      [
        { rating: 1, deltaT: 0 },
        { rating: 3, deltaT: 0 },
        { rating: 2, deltaT: 2 },
        { rating: 4, deltaT: 7 },
      ],
    ]);
  });

  test("leaves out an item with no Review a Study day or more after the one before (the library can't take it)", () => {
    const reviews = [
      reviewOf("c1", "2026-05-01T10:00:00Z"),
      reviewOf("c1", "2026-05-01T10:10:00Z"),
      reviewOf("c1", "2026-05-01T11:00:00Z"),
    ];

    expect(trainingItems(reviews, [], UTC4)).toEqual([]);
  });

  test("counts whole Study days under the Timezone and Day start, not 24-hour spans", () => {
    // 03:59 is still the Study day before (Day start 4:00); 04:00 starts the next.
    const reviews = [
      reviewOf("c1", "2026-05-01T22:00:00Z"),
      reviewOf("c1", "2026-05-02T03:59:00Z"),
      reviewOf("c1", "2026-05-02T04:00:00Z"),
    ];
    expect(trainingItems(reviews, [], UTC4)).toEqual([
      [
        { rating: 3, deltaT: 0 },
        { rating: 3, deltaT: 0 },
        { rating: 3, deltaT: 1 },
      ],
    ]);

    // In Warsaw (UTC+2 in May), 02:30Z is 04:30 there: past the Day start.
    const warsaw = { timezone: "Europe/Warsaw", dayStartHour: 4 };
    const there = [reviewOf("c2", "2026-05-01T12:00:00Z"), reviewOf("c2", "2026-05-02T02:30:00Z")];
    expect(trainingItems(there, [], warsaw)).toEqual([
      [
        { rating: 3, deltaT: 0 },
        { rating: 3, deltaT: 1 },
      ],
    ]);
    expect(trainingItems(there, [], UTC4)).toEqual([]);
  });

  test("starts each Card from its newest Progress reset, in the Write order", () => {
    const first = reviewOf("c1", "2026-05-01T10:00:00Z");
    const second = reviewOf("c1", "2026-05-05T10:00:00Z");
    const olderReset = { cardId: "c1", seq: (seq += 1) };
    const third = reviewOf("c1", "2026-05-06T10:00:00Z", "again");
    const newestReset = { cardId: "c1", seq: (seq += 1) };
    const fourth = reviewOf("c1", "2026-05-08T10:00:00Z", "hard");
    const fifth = reviewOf("c1", "2026-05-11T10:00:00Z", "good");
    const otherCard = [
      reviewOf("c2", "2026-05-01T10:00:00Z"),
      reviewOf("c2", "2026-05-02T10:00:00Z"),
    ];

    const items = trainingItems(
      [first, second, third, fourth, fifth, ...otherCard],
      [newestReset, olderReset, { cardId: "c2", seq: 0 }],
      UTC4,
    );

    expect(items).toEqual([
      [
        { rating: 2, deltaT: 0 },
        { rating: 3, deltaT: 3 },
      ],
      [
        { rating: 3, deltaT: 0 },
        { rating: 3, deltaT: 1 },
      ],
    ]);
  });

  test("orders a Card's Reviews by the Write order, never by the clock, which can step back", () => {
    const later: TrainingReview = {
      cardId: "c1",
      seq: 2,
      reviewedAt: at("2026-05-01T10:00:00Z"),
      rating: "good",
    };
    const earlier: TrainingReview = {
      cardId: "c1",
      seq: 1,
      reviewedAt: at("2026-05-04T10:00:00Z"),
      rating: "hard",
    };

    // The clock stepped back three days: it counts as the same Study day, not -3.
    expect(trainingItems([later, earlier], [], UTC4)).toEqual([]);
    const next: TrainingReview = {
      cardId: "c1",
      seq: 3,
      reviewedAt: at("2026-05-06T10:00:00Z"),
      rating: "easy",
    };
    expect(trainingItems([later, earlier, next], [], UTC4)).toEqual([
      [
        { rating: 2, deltaT: 0 },
        { rating: 3, deltaT: 0 },
        { rating: 4, deltaT: 5 },
      ],
    ]);
  });
});

/** A Card's items from reviews a few days apart, to train the real library on. */
function syntheticItems(cards: number): TrainingItem[] {
  let state = 7;
  const random = () => (state = (state * 16_807) % 2_147_483_647) / 2_147_483_647;
  const items: TrainingItem[] = [];
  for (let card = 0; card < cards; card += 1) {
    const history = [{ rating: 3, deltaT: 0 }];
    let gap = 1;
    for (let i = 0; i < 6; i += 1) {
      const rating = random() < 0.85 ? 3 : 1;
      history.push({ rating, deltaT: gap });
      gap = rating === 1 ? 1 : Math.ceil(gap * 2.5);
      items.push(history.map((review) => ({ ...review })));
    }
  }
  return items;
}

const fixed = (losses: { current: number; next: number }, produced = [...DEFAULT_PARAMETERS]) => {
  const seen: { evaluated: number[][]; items: TrainingItem[][] } = { evaluated: [], items: [] };
  const optimizer: Optimizer = {
    computeParameters: async (items) => {
      seen.items.push(items);
      return produced;
    },
    evaluate: (parameters, items) => {
      seen.evaluated.push([...parameters]);
      seen.items.push(items);
      return parameters === produced ? losses.next : losses.current;
    },
  };
  return { optimizer, seen };
};

const notEnough = () => {
  throw new Error("Evaluation failed: NotEnoughData");
};

const SOME_ITEMS: TrainingItem[] = [
  [
    { rating: 3, deltaT: 0 },
    { rating: 3, deltaT: 2 },
  ],
];

describe("tune", () => {
  test("applies the new Parameters when their log loss on the same items is strictly lower", async () => {
    const produced = DEFAULT_PARAMETERS.map((weight) => weight * 1.01);
    const { optimizer, seen } = fixed({ current: 0.5, next: 0.4 }, produced);

    expect(await tune(SOME_ITEMS, DEFAULT_PARAMETERS, optimizer)).toEqual({
      result: "applied",
      parameters: produced,
      currentLogLoss: 0.5,
      newLogLoss: 0.4,
    });
    expect(seen.items.every((items) => items === SOME_ITEMS)).toBe(true);
  });

  test("keeps the current Parameters when the new ones are no better, equal included", async () => {
    const produced = DEFAULT_PARAMETERS.map((weight) => weight * 1.01);
    for (const next of [0.5, 0.6]) {
      expect(
        await tune(
          SOME_ITEMS,
          DEFAULT_PARAMETERS,
          fixed({ current: 0.5, next }, produced).optimizer,
        ),
      ).toEqual({ result: "kept", parameters: produced, currentLogLoss: 0.5, newLogLoss: next });
    }
  });

  test("is not_enough_data when the library says so, fitting or evaluating, or there are no items", async () => {
    const failing: Optimizer = {
      computeParameters: async () => notEnough(),
      evaluate: () => 0.5,
    };
    expect(await tune(SOME_ITEMS, DEFAULT_PARAMETERS, failing)).toEqual({
      result: "not_enough_data",
    });
    expect(
      await tune(SOME_ITEMS, DEFAULT_PARAMETERS, {
        ...failing,
        computeParameters: async () => [1],
      }),
    ).toMatchObject({ result: "kept" });
    expect(
      await tune(SOME_ITEMS, DEFAULT_PARAMETERS, {
        computeParameters: async () => [1],
        evaluate: notEnough,
      }),
    ).toEqual({ result: "not_enough_data" });
    expect(await tune([], DEFAULT_PARAMETERS, fixed({ current: 1, next: 0 }).optimizer)).toEqual({
      result: "not_enough_data",
    });
  });

  test("throws any other error, for the caller to log as failed", async () => {
    const broken: Optimizer = {
      computeParameters: async () => {
        throw new Error("boom");
      },
      evaluate: () => 0.5,
    };
    expect(tune(SOME_ITEMS, DEFAULT_PARAMETERS, broken)).rejects.toThrow("boom");
  });

  test("the library fits FSRS-6's 21 Parameters that predict synthetic Reviews better than the defaults", async () => {
    const items = syntheticItems(50);
    const tuned = await tune(items, DEFAULT_PARAMETERS, libraryOptimizer);

    expect(tuned.result).toBe("applied");
    if (tuned.result !== "applied") return;
    expect(tuned.parameters).toHaveLength(21);
    expect(tuned.newLogLoss).toBeLessThan(tuned.currentLogLoss);
  });

  test("the library answers NotEnoughData for a handful of items", async () => {
    expect(await tune(syntheticItems(1).slice(0, 1), DEFAULT_PARAMETERS, libraryOptimizer)).toEqual(
      { result: "not_enough_data" },
    );
  });
});
