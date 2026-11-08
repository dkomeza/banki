import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import {
  ANSWER_MODE_OPTIONS,
  answerModeErrorText,
  answerModeName,
  deckAnswerModeSaverFor,
  dropDeckAnswerModeSavers,
  matchAnswerModes,
  pickedAnswerMode,
} from "./deck-answer-mode";

/** The labels a search for `query` finds. */
const found = (query: string) => matchAnswerModes(query).map((option) => option.label);

describe("a Deck's Answer mode, as Deck settings show it", () => {
  test("offers Follow Settings, showing Settings' mode, then each mode by name", () => {
    expect(ANSWER_MODE_OPTIONS.map((option) => option.label)).toEqual([
      "Follow Settings",
      "Rate yourself",
      "Write and grade",
    ]);
    expect(ANSWER_MODE_OPTIONS[0].display).toBe("Follow Settings (Rate yourself)");
    expect(answerModeName("write")).toBe("Write and grade");
  });

  test("a search finds by name, and Follow Settings by follow or global", () => {
    expect(found("")).toHaveLength(3);
    expect(found("write")).toEqual(["Write and grade"]);
    expect(found(" RATE ")).toEqual(["Rate yourself"]);
    expect(found("follow")).toEqual(["Follow Settings"]);
    expect(found("glob")).toEqual(["Follow Settings"]);
    expect(found("grade")).toEqual(["Write and grade"]);
    expect(found("xyz")).toEqual([]);
  });

  test("a pick is a mode, null to follow Settings, and nothing else", () => {
    expect(pickedAnswerMode("write")).toBe("write");
    expect(pickedAnswerMode("self-rate")).toBe("self-rate");
    expect(pickedAnswerMode("follow")).toBeNull();
    expect(pickedAnswerMode("grade")).toBeUndefined();
  });

  test("a change that didn't save says what it tried and what the Deck keeps", () => {
    expect(answerModeErrorText("write", null)).toBe(
      "The change to Write and grade didn't save, so it still follows Settings (Rate yourself).",
    );
    expect(answerModeErrorText(null, "write")).toBe(
      "The change to following Settings didn't save, so it's still Write and grade.",
    );
  });

  test("each Deck has one saver per query client, until sign-out drops them", () => {
    const queryClient = new QueryClient();
    const saver = deckAnswerModeSaverFor(queryClient, "d1");
    expect(deckAnswerModeSaverFor(queryClient, "d1")).toBe(saver);
    expect(deckAnswerModeSaverFor(queryClient, "d2")).not.toBe(saver);

    dropDeckAnswerModeSavers(queryClient);
    expect(deckAnswerModeSaverFor(queryClient, "d1")).not.toBe(saver);
  });
});
