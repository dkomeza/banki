import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Card } from "@/lib/cards";
import { ResetProgress } from "./reset-progress";

const card = (studied: boolean): Card => ({
  id: "c1",
  deckId: "d1",
  front: "el desayuno",
  back: "breakfast",
  tags: [],
  gradingNotes: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  studied,
});

const row = (studied: boolean, props: { checked?: boolean; disabled?: boolean } = {}) =>
  renderToStaticMarkup(
    <ResetProgress card={card(studied)} checked={false} onChange={() => {}} {...props} />,
  );

describe("ResetProgress", () => {
  test("isn't there on a New Card", () => {
    expect(row(false)).toBe("");
    expect(row(false, { checked: true })).toBe("");
  });

  test("on a studied Card, shows as it is ticked, and can be turned off while a Save is on its way", () => {
    const unticked = row(true);
    expect(unticked).toContain("Reset progress");
    expect(unticked).toMatch(/<input type="checkbox"(?![^>]*checked)/);

    expect(row(true, { checked: true })).toMatch(/<input type="checkbox"[^>]*checked/);
    expect(row(true, { disabled: true })).toMatch(/<input type="checkbox"[^>]*disabled/);
  });
});
