import { describe, expect, test } from "vitest";
import {
  LEARNING_LIMIT_RANGE,
  NEW_CARD_BATCH_RANGE,
  moreOffer,
  pacingErrorText,
  paged,
  stepped,
} from "./new-cards";

describe("stepped", () => {
  test("moves the New-card batch in fives, within 5–100", () => {
    expect(stepped(20, 1, NEW_CARD_BATCH_RANGE)).toBe(25);
    expect(stepped(20, -1, NEW_CARD_BATCH_RANGE)).toBe(15);
    expect(stepped(100, 1, NEW_CARD_BATCH_RANGE)).toBe(100);
    expect(stepped(5, -1, NEW_CARD_BATCH_RANGE)).toBe(5);
  });

  test("moves a value off the steps to the next step that way", () => {
    expect(stepped(37, 1, NEW_CARD_BATCH_RANGE)).toBe(40);
    expect(stepped(37, -1, NEW_CARD_BATCH_RANGE)).toBe(35);
    expect(stepped(98, 1, NEW_CARD_BATCH_RANGE)).toBe(100);
    expect(stepped(6, -1, NEW_CARD_BATCH_RANGE)).toBe(5);
  });

  test("moves the Learning limit one at a time, within 5–50", () => {
    expect(stepped(10, 1, LEARNING_LIMIT_RANGE)).toBe(11);
    expect(stepped(10, -1, LEARNING_LIMIT_RANGE)).toBe(9);
    expect(stepped(50, 1, LEARNING_LIMIT_RANGE)).toBe(50);
    expect(stepped(5, -1, LEARNING_LIMIT_RANGE)).toBe(5);
  });
});

describe("paged", () => {
  test("moves five steps at once, landing on the steps from a value off them", () => {
    expect(paged(20, 1, NEW_CARD_BATCH_RANGE)).toBe(45);
    expect(paged(37, 1, NEW_CARD_BATCH_RANGE)).toBe(60);
    expect(paged(37, -1, NEW_CARD_BATCH_RANGE)).toBe(15);
    expect(paged(10, 1, LEARNING_LIMIT_RANGE)).toBe(15);
  });

  test("stops at the ends", () => {
    expect(paged(90, 1, NEW_CARD_BATCH_RANGE)).toBe(100);
    expect(paged(12, -1, NEW_CARD_BATCH_RANGE)).toBe(5);
    expect(paged(7, -1, LEARNING_LIMIT_RANGE)).toBe(5);
  });
});

test("a failed save says what didn't change, and what is kept", () => {
  expect(pacingErrorText(25, 20)).toBe("The change to 25 didn't save, so it's still 20.");
});

describe("moreOffer", () => {
  test("says how many New cards are waiting, and offers a batch of the New-card batch's size", () => {
    expect(moreOffer(37, 20)).toEqual({
      waiting: "37 new cards are waiting.",
      action: "Learn 20 more",
    });
    expect(moreOffer(1, 5)).toEqual({ waiting: "1 new card is waiting.", action: "Learn 5 more" });
  });

  test("names no number while the New-card batch isn't known", () => {
    expect(moreOffer(3, undefined)?.action).toBe("Learn more");
  });

  test("offers nothing when no New card is held", () => {
    expect(moreOffer(0, 20)).toBeUndefined();
  });
});
