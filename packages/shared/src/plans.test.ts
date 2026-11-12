import { describe, expect, test } from "bun:test";
import {
  Deadline,
  PlanCheckQuery,
  PlanCheckResponse,
  PlanResponse,
  PutPlanRequest,
  deadlineProblem,
  lastDeadline,
} from "./plans";

describe("Deadline", () => {
  test("takes a real calendar date", () => {
    expect(Deadline.parse("2026-12-12")).toBe("2026-12-12");
    expect(Deadline.parse("2028-02-29")).toBe("2028-02-29");
  });

  test.each(["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-01", "12/12/2026", ""])(
    "refuses %p",
    (day) => {
      expect(Deadline.safeParse(day).success).toBe(false);
    },
  );
});

describe("PutPlanRequest", () => {
  test("takes a Deadline and a Daily goal from 5 to 600", () => {
    expect(PutPlanRequest.parse({ deadline: "2026-12-12", dailyMinutes: 5 })).toEqual({
      deadline: "2026-12-12",
      dailyMinutes: 5,
    });
    expect(PutPlanRequest.parse({ deadline: "2026-12-12", dailyMinutes: 600 }).dailyMinutes).toBe(
      600,
    );
  });

  test.each([
    { deadline: "2026-12-12", dailyMinutes: 4 },
    { deadline: "2026-12-12", dailyMinutes: 601 },
    { deadline: "2026-12-12", dailyMinutes: 30.5 },
    { deadline: "2026-12-12", dailyMinutes: "30" },
    { deadline: "2026-12-12" },
    { dailyMinutes: 30 },
    { deadline: "2026-12-12", dailyMinutes: 30, extra: true },
  ])("refuses %p", (body) => {
    expect(PutPlanRequest.safeParse(body).success).toBe(false);
  });
});

describe("PlanCheckQuery", () => {
  test("takes the minutes as a query string gives them", () => {
    expect(PlanCheckQuery.parse({ deadline: "2026-12-12", dailyMinutes: "35" })).toEqual({
      deadline: "2026-12-12",
      dailyMinutes: 35,
    });
  });

  test.each([
    { deadline: "2026-12-12", dailyMinutes: "4" },
    { deadline: "2026-12-12", dailyMinutes: "601" },
    { deadline: "2026-12-12", dailyMinutes: "3.5" },
    { deadline: "2026-12-12", dailyMinutes: "" },
    { deadline: "2026-12-32", dailyMinutes: "30" },
    { dailyMinutes: "30" },
  ])("refuses %p", (query) => {
    expect(PlanCheckQuery.safeParse(query).success).toBe(false);
  });
});

describe("PlanResponse and PlanCheckResponse", () => {
  test("parse what the API answers", () => {
    expect(PlanResponse.parse({ deadline: "2026-12-12", dailyMinutes: 30 })).toEqual({
      deadline: "2026-12-12",
      dailyMinutes: 30,
    });
    expect(PlanCheckResponse.parse({ newCards: 300, unlearned: 0, neededMinutes: null })).toEqual({
      newCards: 300,
      unlearned: 0,
      neededMinutes: null,
    });
  });
});

describe("deadlineProblem", () => {
  test("takes tomorrow up to the same date 2 years on", () => {
    expect(deadlineProblem("2026-11-13", "2026-11-12")).toBeUndefined();
    expect(deadlineProblem("2028-11-12", "2026-11-12")).toBeUndefined();
  });

  test("refuses today and before as too soon", () => {
    expect(deadlineProblem("2026-11-12", "2026-11-12")).toBe("too_soon");
    expect(deadlineProblem("2026-11-01", "2026-11-12")).toBe("too_soon");
  });

  test("refuses the day after 2 years as too far", () => {
    expect(deadlineProblem("2028-11-13", "2026-11-12")).toBe("too_far");
  });

  test("takes 29 February 2 years on as 1 March", () => {
    expect(lastDeadline("2028-02-29")).toBe("2030-03-01");
  });
});
