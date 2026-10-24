import { describe, expect, test } from "bun:test";
import { inWindow, localTime, parseDays, parseNight, type Window } from "./window";

// When Stages may start (ADR-0013): every night, and all day on the open
// days, in server time.

const DEFAULT: Window = { night: parseNight("01:00-07:00"), openDays: parseDays("sat,sun") };
/** Whether a moment, given as the server's wall-clock time (here UTC), is inside the window. */
const at = (local: string, window = DEFAULT) =>
  inWindow(localTime(new Date(`${local}Z`), "UTC"), window);

describe("the window", () => {
  test("is open every night, from its start up to its end", () => {
    // 2026-10-21 is a Wednesday.
    expect(at("2026-10-21T00:59:00")).toBe(false);
    expect(at("2026-10-21T01:00:00")).toBe(true);
    expect(at("2026-10-21T06:59:00")).toBe(true);
    expect(at("2026-10-21T07:00:00")).toBe(false);
    expect(at("2026-10-21T14:00:00")).toBe(false);
  });

  test("runs from Saturday 00:00 to Monday 07:00 as one stretch", () => {
    expect(at("2026-10-23T23:59:00")).toBe(false); // Friday evening
    expect(at("2026-10-24T00:00:00")).toBe(true); // Saturday
    expect(at("2026-10-24T13:00:00")).toBe(true);
    expect(at("2026-10-25T13:00:00")).toBe(true); // Sunday
    expect(at("2026-10-26T00:30:00")).toBe(true); // Monday, before the night starts
    expect(at("2026-10-26T06:59:00")).toBe(true);
    expect(at("2026-10-26T07:00:00")).toBe(false);
  });

  test("with no open days, is open only at night, the weekend too", () => {
    const nightly: Window = { night: parseNight("01:00-07:00"), openDays: parseDays("") };

    expect(at("2026-10-24T12:00:00", nightly)).toBe(false); // Saturday noon
    expect(at("2026-10-25T03:00:00", nightly)).toBe(true); // Sunday night
    expect(at("2026-10-26T00:30:00", nightly)).toBe(false); // Monday, before the night starts
  });

  test("takes a night that crosses midnight", () => {
    const late: Window = { night: parseNight("23:00-02:00"), openDays: parseDays("") };

    expect(at("2026-10-21T22:59:00", late)).toBe(false);
    expect(at("2026-10-21T23:00:00", late)).toBe(true);
    expect(at("2026-10-22T01:59:00", late)).toBe(true);
    expect(at("2026-10-22T02:00:00", late)).toBe(false);
  });

  test("reads the local weekday and time in the server's timezone", () => {
    // 22:30 UTC on a Friday is 00:30 on Saturday in Warsaw (CEST).
    expect(localTime(new Date("2026-10-23T22:30:00Z"), "Europe/Warsaw")).toEqual({
      weekday: 6,
      minutes: 30,
    });
  });
});

describe("the window's settings", () => {
  test("read a night as HH:MM-HH:MM", () => {
    expect(parseNight("01:00-07:00")).toEqual({ start: 60, end: 420 });
    expect(parseNight(" 23:30-05:15 ")).toEqual({ start: 1410, end: 315 });
  });

  test("refuse a night that isn't two times, or starts when it ends", () => {
    for (const bad of ["1-7", "01:00", "25:00-07:00", "01:00-01:00", "01:60-02:00"]) {
      expect(() => parseNight(bad)).toThrow("BANKI_RUNNER_NIGHT");
    }
  });

  test("read the open days as three-letter names, any case", () => {
    expect([...parseDays("sat,sun")]).toEqual([6, 0]);
    expect([...parseDays(" Fri, SAT ")]).toEqual([5, 6]);
    expect([...parseDays("")]).toEqual([]);
  });

  test("refuse a day that isn't one", () => {
    expect(() => parseDays("sat,funday")).toThrow("BANKI_RUNNER_OPEN_DAYS");
  });
});
