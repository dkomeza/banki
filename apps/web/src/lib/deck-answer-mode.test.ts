import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import {
  SETTINGS_ANSWER_MODE_OPTIONS,
  answerModeErrorText,
  answerModeName,
  answerModeOptions,
  deckAnswerModeSaverFor,
  dropDeckAnswerModeSavers,
  matchAnswerModes,
  pickedAnswerMode,
  settingsAnswerModeErrorText,
} from "./deck-answer-mode";

/** The labels a search for `query` finds among a Deck's choices. */
const found = (query: string) =>
  matchAnswerModes(answerModeOptions("self-rate"), query).map((option) => option.label);

/** The labels a search for `query` finds among Settings' choices. */
const foundInSettings = (query: string) =>
  matchAnswerModes(SETTINGS_ANSWER_MODE_OPTIONS, query).map((option) => option.label);

describe("a Deck's Answer mode, as Deck settings show it", () => {
  test("offers Follow Settings, showing Settings' mode, then each mode by name", () => {
    expect(answerModeOptions("self-rate").map((option) => option.label)).toEqual([
      "Follow Settings",
      "Rate yourself",
      "Write and grade",
    ]);
    expect(answerModeOptions("self-rate")[0]?.display).toBe("Follow Settings (Rate yourself)");
    expect(answerModeOptions("write")[0]?.display).toBe("Follow Settings (Write and grade)");
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
    expect(answerModeErrorText("write", null, "self-rate")).toBe(
      "The change to Write and grade didn't save, so it still follows Settings (Rate yourself).",
    );
    expect(answerModeErrorText("self-rate", null, "write")).toBe(
      "The change to Rate yourself didn't save, so it still follows Settings (Write and grade).",
    );
    expect(answerModeErrorText(null, "write", "self-rate")).toBe(
      "The change to following Settings didn't save, so it's still Write and grade.",
    );
  });
});

describe("Settings' Answer mode, as Settings show it", () => {
  test("offers each mode by name, and no Follow Settings", () => {
    expect(SETTINGS_ANSWER_MODE_OPTIONS.map((option) => option.label)).toEqual([
      "Rate yourself",
      "Write and grade",
    ]);
    expect(foundInSettings("write")).toEqual(["Write and grade"]);
    expect(foundInSettings("follow")).toEqual([]);
  });

  test("a change that didn't save says what it tried and the mode kept", () => {
    expect(settingsAnswerModeErrorText("write", "self-rate")).toBe(
      "The change to Write and grade didn't save, so it's still Rate yourself.",
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
