import { describe, expect, it } from "vitest";
import { daysUntil, zonedDateEnd } from "@/lib/time";

describe("deadline time handling", () => {
  it("resolves Warsaw end-of-day across daylight saving time", () => {
    expect(zonedDateEnd("2026-06-21", "Europe/Warsaw").toISOString()).toBe("2026-06-21T21:59:59.999Z");
    expect(zonedDateEnd("2026-12-21", "Europe/Warsaw").toISOString()).toBe("2026-12-21T22:59:59.999Z");
  });

  it("always supplies at least one planning day", () => {
    expect(daysUntil(new Date("2026-06-21T10:01:00Z"), new Date("2026-06-21T10:00:00Z"))).toBe(1);
  });
});
