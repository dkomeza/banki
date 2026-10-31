import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Deck } from "@/lib/decks";
import type { StudyOverview } from "@/lib/study-overview";
import { SummaryView, nextLine } from "./summary";

const DECK: Deck = {
  id: "d1",
  name: "Spanish",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 30,
  desiredRetention: null,
  macros: [],
};

// Saturday 31 October 2026.
const TODAY = "2026-10-31";

const OVERVIEW: StudyOverview = {
  due: 0,
  new: 0,
  newTotal: 0,
  estimateMs: 0,
  nextDue: { day: "2026-11-01", count: 14 },
};

const PROPS: ComponentProps<typeof SummaryView> = {
  deck: DECK,
  summary: { studied: 37, newStudied: 12, recall: { kept: 22, of: 25 }, timeMs: 14 * 60_000 },
  left: false,
  overview: OVERVIEW,
  today: TODAY,
  offer: undefined,
  loadingMore: false,
  onMore: () => {},
  onResume: () => {},
};

function render(props: Partial<ComponentProps<typeof SummaryView>> = {}) {
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <SummaryView {...PROPS} {...props} />
    </RouterContextProvider>,
  );
}

/** The markup with its tags dropped, for reading what it says. */
const text = (markup: string) => markup.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ");

describe("SummaryView", () => {
  test("at the end of the Queue: the Recall rate, the Cards and New, the time, Next due, Back to deck", () => {
    const out = text(render());

    expect(out).toContain("Session done");
    expect(out).toContain("88%");
    expect(out).toContain("22 of 25 review cards recalled");
    expect(out).toContain("37");
    expect(out).toContain("cards · 12 new");
    expect(out).toContain("14 min");
    expect(out).toContain("Next: tomorrow, 14 cards.");
    expect(out).toContain("Back to deck");
    expect(out).not.toContain("Keep studying");
  });

  test("with New cards held back, offers another batch", () => {
    const out = render({
      offer: { waiting: "37 new cards are waiting.", action: "Learn 20 more" },
    });

    expect(text(out)).toContain("37 new cards are waiting.");
    expect(out).toMatch(/<button[^>]*>[^<]*Learn 20 more<\/button>/);
    expect(text(out)).toContain("Back to deck");
  });

  test("disables Learn more while the next batch loads", () => {
    const out = render({
      offer: { waiting: "3 new cards are waiting.", action: "Learn 20 more" },
      loadingMore: true,
    });

    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>.*Learn 20 more<\/button>/);
  });

  test("left early: says how many are still to study, and offers Keep studying", () => {
    const out = render({ left: true, overview: { ...OVERVIEW, due: 12, new: 8 } });

    expect(text(out)).toContain("Session paused");
    expect(text(out)).toContain("20 still to study.");
    expect(out).toMatch(/<button[^>]*>[^<]*Keep studying<\/button>/);
    expect(text(out)).toContain("Back to deck");
  });

  test("a Session of New cards only leads with the Cards learned, and has no Recall rate", () => {
    const out = text(
      render({ summary: { studied: 20, newStudied: 20, recall: null, timeMs: 45_000 } }),
    );

    expect(out).toContain("20");
    expect(out).toContain("new cards learned");
    expect(out).not.toContain("recall");
    expect(out).toContain("45 s");
  });

  test("names one Card in the singular", () => {
    expect(
      text(render({ summary: { studied: 1, newStudied: 1, recall: null, timeMs: 4000 } })),
    ).toContain("new card learned");
    expect(
      text(
        render({
          summary: { studied: 1, newStudied: 0, recall: { kept: 1, of: 1 }, timeMs: 4000 },
        }),
      ),
    ).toContain("card · 0 new");
  });

  test("a Session without review Cards that isn't all New leads with the Cards studied", () => {
    const out = text(
      render({ summary: { studied: 3, newStudied: 1, recall: null, timeMs: 4000 } }),
    );

    expect(out).toContain("cards studied");
    expect(out).toContain("1 new");
  });

  test("says nothing of what comes next until the overview is in", () => {
    const out = text(render({ overview: undefined }));

    expect(out).not.toContain("Next");
    expect(out).not.toContain("Nothing scheduled");
  });
});

/** The line at the end of the Queue with 9 Cards next due on `day`. */
const nextOn = (day: string) =>
  nextLine({ ...OVERVIEW, nextDue: { day, count: 9 } }, { left: false, today: TODAY });

describe("nextLine", () => {
  test("words the next due day: tomorrow, a weekday within 6 days, a date beyond", () => {
    expect(nextOn("2026-11-01")).toBe("Next: tomorrow, 9 cards.");
    expect(nextOn("2026-11-06")).toBe("Next: Friday, 9 cards.");
    expect(nextOn("2026-11-12")).toBe("Next: 12 Nov, 9 cards.");
  });

  test("says Nothing scheduled when no Card is ever due", () => {
    expect(nextLine({ ...OVERVIEW, nextDue: null }, { left: false, today: TODAY })).toBe(
      "Nothing scheduled.",
    );
  });

  test("left early, counts due and new still to study", () => {
    expect(nextLine({ ...OVERVIEW, due: 3, new: 2 }, { left: true, today: TODAY })).toBe(
      "5 still to study.",
    );
  });

  test("left early with nothing still to study, says what comes next instead", () => {
    expect(nextLine(OVERVIEW, { left: true, today: TODAY })).toBe("Next: tomorrow, 14 cards.");
  });

  test("at the end of the Queue never counts what's still to study", () => {
    expect(nextLine({ ...OVERVIEW, due: 3 }, { left: false, today: TODAY })).toBe(
      "Next: tomorrow, 14 cards.",
    );
  });

  test("is undefined until the overview is in", () => {
    expect(nextLine(undefined, { left: false, today: TODAY })).toBeUndefined();
  });
});
