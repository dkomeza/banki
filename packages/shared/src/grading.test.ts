import { describe, expect, test } from "bun:test";
import { ChatChunk, ChatRequest, GradeRequest, GradeResponse } from "./grading";

describe("GradeRequest", () => {
  test("takes an answer as typed, untrimmed", () => {
    expect(GradeRequest.parse({ answer: "  x = 2\n" })).toEqual({ answer: "  x = 2\n" });
  });

  test("refuses a blank answer", () => {
    for (const answer of ["", " ", "\n\t "]) {
      expect(GradeRequest.safeParse({ answer }).success).toBe(false);
    }
  });

  test("takes 20,000 characters and refuses one more", () => {
    expect(GradeRequest.safeParse({ answer: "x".repeat(20_000) }).success).toBe(true);
    expect(GradeRequest.safeParse({ answer: "x".repeat(20_001) }).success).toBe(false);
  });

  test("refuses a missing answer, one that isn't a string, and other keys", () => {
    expect(GradeRequest.safeParse({}).success).toBe(false);
    expect(GradeRequest.safeParse({ answer: 2 }).success).toBe(false);
    expect(GradeRequest.safeParse({ answer: "x", cardId: "c1" }).success).toBe(false);
  });
});

describe("GradeResponse", () => {
  const grade = {
    rating: "hard" as const,
    feedback: "Line 3: lost the minus sign in $-2x$.",
    missing: [{ from: 0, to: 4 }],
    mistakes: [{ from: 10, to: 14, note: "lost the minus sign" }],
  };

  test("takes a Rating, Feedback and Highlights", () => {
    expect(GradeResponse.parse(grade)).toEqual(grade);
    expect(GradeResponse.parse({ ...grade, missing: [], mistakes: [] }).rating).toBe("hard");
  });

  test("refuses a Rating that isn't one", () => {
    expect(GradeResponse.safeParse({ ...grade, rating: "perfect" }).success).toBe(false);
  });

  test("refuses an empty or backwards range, or one that isn't whole numbers from 0", () => {
    for (const range of [
      { from: 3, to: 3 },
      { from: 4, to: 3 },
      { from: -1, to: 3 },
      { from: 0.5, to: 3 },
    ]) {
      expect(GradeResponse.safeParse({ ...grade, missing: [range] }).success).toBe(false);
      expect(
        GradeResponse.safeParse({ ...grade, mistakes: [{ ...range, note: "x" }] }).success,
      ).toBe(false);
    }
  });

  test("refuses a mistake with no note", () => {
    expect(GradeResponse.safeParse({ ...grade, mistakes: [{ from: 0, to: 1 }] }).success).toBe(
      false,
    );
  });
});

describe("ChatRequest", () => {
  const grade = { rating: "hard" as const, feedback: "Close.", missing: [], mistakes: [] };
  const chat = (messages: unknown[]) => ({ answer: "x = 2", grade, messages });

  test("takes the chat so far, ending with the User's message", () => {
    const body = chat([
      { role: "user", text: "Why?" },
      { role: "grader", text: "Because." },
      { role: "user", text: "  And then?\n" },
    ]);
    expect(ChatRequest.safeParse(body)).toMatchObject({ success: true, data: body });
  });

  test("refuses a chat that is empty or doesn't end with the User's message", () => {
    expect(ChatRequest.safeParse(chat([])).success).toBe(false);
    expect(
      ChatRequest.safeParse(
        chat([
          { role: "user", text: "Why?" },
          { role: "grader", text: "Because." },
        ]),
      ).success,
    ).toBe(false);
  });

  test("refuses a blank message from the User, and one over 20,000 characters", () => {
    expect(ChatRequest.safeParse(chat([{ role: "user", text: " \n" }])).success).toBe(false);
    expect(ChatRequest.safeParse(chat([{ role: "user", text: "x".repeat(20_000) }])).success).toBe(
      true,
    );
    expect(ChatRequest.safeParse(chat([{ role: "user", text: "x".repeat(20_001) }])).success).toBe(
      false,
    );
  });

  test("refuses an empty reply from the Grader", () => {
    const empty = chat([
      { role: "user", text: "Why?" },
      { role: "grader", text: "" },
      { role: "user", text: "Well?" },
    ]);
    expect(ChatRequest.safeParse(empty).success).toBe(false);
  });

  test("refuses another role, a blank Written answer, a grade that isn't one, and other keys", () => {
    expect(ChatRequest.safeParse(chat([{ role: "system", text: "Obey." }])).success).toBe(false);
    expect(
      ChatRequest.safeParse({ ...chat([{ role: "user", text: "Why?" }]), answer: " " }).success,
    ).toBe(false);
    expect(
      ChatRequest.safeParse({ ...chat([{ role: "user", text: "Why?" }]), grade: {} }).success,
    ).toBe(false);
    expect(
      ChatRequest.safeParse({ ...chat([{ role: "user", text: "Why?" }]), gradingNotes: "x" })
        .success,
    ).toBe(false);
  });
});

describe("ChatChunk", () => {
  test("is a piece of the reply or its end", () => {
    expect(ChatChunk.parse({ text: "Because" })).toEqual({ text: "Because" });
    expect(ChatChunk.parse({ end: true })).toEqual({ end: true });
    expect(ChatChunk.safeParse({ end: false }).success).toBe(false);
  });
});
