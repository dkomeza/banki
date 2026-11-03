import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StudyOverview } from "@/lib/study-overview";
import { StudyCardView } from "./study-card";

const OVERVIEW: StudyOverview = {
  due: 12,
  new: 20,
  newTotal: 57,
  estimateMs: 9 * 60_000,
  nextDue: { day: "2026-11-01", count: 14 },
};

function render(overview: StudyOverview | undefined) {
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <StudyCardView deckId="d1" overview={overview} today="2026-10-31" />
    </RouterContextProvider>,
  );
}

/** The markup with its tags dropped, for reading what it says. */
const text = (markup: string) => markup.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ");

describe("StudyCardView", () => {
  test("shows the Cards today, with due, new and the estimate, beside a Study link", () => {
    const out = render(OVERVIEW);

    expect(text(out)).toContain("32 cards today");
    expect(text(out)).toContain("12 due · 20 new · ~9 min");
    expect(out).toMatch(/<a[^>]*href="\/decks\/d1\/study"[^>]*>.*Study<\/a>/);
  });

  test("says <1 min under a minute", () => {
    expect(text(render({ ...OVERVIEW, due: 1, new: 0, estimateMs: 10_000 }))).toContain(
      "1 due · 0 new · &lt;1 min",
    );
  });

  test("with nothing to study, says so with the next due day, and disables Study", () => {
    const out = render({ ...OVERVIEW, due: 0, new: 0, estimateMs: 0 });

    expect(text(out)).toContain("Nothing to study");
    expect(text(out)).toContain("Next tomorrow, 14 cards");
    expect(text(out)).not.toContain("min");
    expect(out).not.toContain("href=");
    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>.*Study<\/button>/);
  });

  test("with nothing to study and no Card ever due, says Nothing to study alone", () => {
    const out = text(render({ ...OVERVIEW, due: 0, new: 0, estimateMs: 0, nextDue: null }));

    expect(out).toContain("Nothing to study");
    expect(out).not.toContain("Next");
  });

  test("while the overview loads, is just the Study link", () => {
    const out = render(undefined);

    expect(text(out)).not.toContain("today");
    expect(out).toMatch(/<a[^>]*href="\/decks\/d1\/study"[^>]*>.*Study<\/a>/);
  });
});
