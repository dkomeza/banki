import type { SettingsPatch, SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { settingsQueryOptions } from "@/lib/settings";
import { settingsSaverFor } from "@/lib/settings-store";
import { AdvancedCard } from "./advanced-card";

const SETTINGS: SettingsResponse = {
  timezone: "Europe/Warsaw",
  dayStartHour: 4,
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
  autoClose: "brackets",
  desiredRetention: 90,
  newCardBatch: 20,
  learningLimit: 10,
  macros: [],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A query client holding `settings`, with its saver saving through `save`. */
function clientWith(
  settings: Partial<SettingsResponse> = {},
  save: (patch: SettingsPatch) => Promise<SettingsResponse> = async (patch) => ({
    ...SETTINGS,
    ...settings,
    ...patch,
  }),
) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(settingsQueryOptions().queryKey, {
    settings: { ...SETTINGS, ...settings },
    issuedAt: 0,
  });
  const saver = settingsSaverFor(queryClient, { save });
  return { queryClient, saver };
}

const render = (queryClient: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdvancedCard />
    </QueryClientProvider>,
  );

/** The markup with its tags dropped, for reading what it says. */
const text = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll(/\s+/g, " ");

/** Whether the element whose aria-label is `label` is disabled. */
const disabled = (markup: string, label: string) =>
  / disabled=""/.test(markup.match(new RegExp(`<[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "");

describe("AdvancedCard", () => {
  test("is the Advanced section, with both steppers at their stored values and what they mean", () => {
    const out = render(clientWith().queryClient);

    expect(out).toContain('id="advanced"');
    expect(text(out)).toContain("Advanced");
    expect(text(out)).toContain("New cards per batch");
    expect(text(out)).toContain("A session introduces this many new cards, then offers you more.");
    expect(text(out)).toContain("Learning limit");
    expect(text(out)).toContain(
      "New cards pause while this many cards are still in their learning steps.",
    );
    expect(out).toMatch(
      /role="spinbutton"[^>]*aria-valuenow="20"[^>]*aria-valuemin="5"[^>]*aria-valuemax="100"/,
    );
    expect(out).toMatch(
      /role="spinbutton"[^>]*aria-valuenow="10"[^>]*aria-valuemin="5"[^>]*aria-valuemax="50"/,
    );
  });

  test("names each spinbutton by its label and describes it by its hint", () => {
    const out = render(clientWith().queryClient);

    for (const spin of out.match(/<div role="spinbutton"[^>]*>/g) ?? []) {
      const label = spin.match(/aria-labelledby="([^"]+)"/)?.[1];
      const hint = spin.match(/aria-describedby="([^"]+)"/)?.[1];
      expect(out).toContain(`id="${label}"`);
      expect(out).toContain(`id="${hint}"`);
    }
    expect(out.match(/role="spinbutton"/g)).toHaveLength(2);
  });

  test("disables − at the lowest value and + at the highest", () => {
    const low = render(clientWith({ newCardBatch: 5, learningLimit: 5 }).queryClient);
    expect(disabled(low, "Fewer new cards per batch")).toBe(true);
    expect(disabled(low, "Lower learning limit")).toBe(true);
    expect(disabled(low, "More new cards per batch")).toBe(false);

    const high = render(clientWith({ newCardBatch: 100, learningLimit: 50 }).queryClient);
    expect(disabled(high, "More new cards per batch")).toBe(true);
    expect(disabled(high, "Higher learning limit")).toBe(true);
    expect(disabled(high, "Lower learning limit")).toBe(false);
  });

  test("shows a change at once, saving, then saved", async () => {
    let answer: ((settings: SettingsResponse) => void) | undefined;
    const { queryClient, saver } = clientWith(
      {},
      () => new Promise((resolve) => (answer = resolve)),
    );

    saver.change({ field: "newCardBatch", attempted: 25 });
    const saving = render(queryClient);
    expect(saving).toMatch(/aria-valuenow="25"/);
    expect(text(saving)).toContain("Saving");

    answer?.({ ...SETTINGS, newCardBatch: 25 });
    await flush();
    const saved = render(queryClient);
    expect(saved).toMatch(/aria-valuenow="25"/);
    expect(text(saved)).toContain("Saved");
  });

  test("a change that didn't save goes back, with an inline error and Try again", async () => {
    const { queryClient, saver } = clientWith({}, async () => {
      throw new Error("offline");
    });

    saver.change({ field: "learningLimit", attempted: 11 });
    await flush();
    const out = render(queryClient);

    expect(out).toMatch(/aria-valuenow="10"[^>]*aria-valuemin="5"[^>]*aria-valuemax="50"/);
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain("The change to 11 didn't save, so it's still 10.");
    expect(text(out)).toContain("Try again");
  });
});
