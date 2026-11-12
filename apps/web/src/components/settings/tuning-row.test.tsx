// @vitest-environment happy-dom
import type { TuneResponse, TuningStatus } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { tuningQueryOptions } from "@/lib/tuning";
import { TuningRow } from "./tuning-row";

const STATUS: TuningStatus = {
  parameters: "default",
  tuned: null,
  lastAttempt: null,
  reviewsUntilAutomatic: 200,
  paused: false,
  running: false,
  recommendedRetention: null,
  ownDecks: 0,
};

const TUNED: TuningStatus = {
  ...STATUS,
  parameters: "tuned",
  tuned: { at: "2026-10-20T09:00:00.000Z", reviews: 412 },
  lastAttempt: { at: "2026-10-20T09:00:00.000Z", trigger: "manual", outcome: "applied" },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The API as these tests see it: each request to `path` waits for its answer from the test. */
function stubApi() {
  const pending: { path: string; answer: (status: number, body: unknown) => void }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          const url = new URL(input instanceof Request ? input.url : input.toString(), "http://x");
          pending.push({
            path: url.pathname,
            answer: (status, body) => resolve(Response.json(body, { status })),
          });
        }),
    ),
  );
  /** Answers the oldest request still waiting, which must be to `path`. */
  const answer = async (path: string, status: number, body: unknown) => {
    await waitFor(() => expect(pending[0]?.path).toBe(path));
    await act(async () => pending.shift()?.answer(status, body));
  };
  return { answer, pending };
}

function renderRow(status: TuningStatus) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(tuningQueryOptions().queryKey, status);
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <TuningRow />
      </Suspense>
    </QueryClientProvider>,
  );
  return queryClient;
}

const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("TuningRow", () => {
  test("shows the status, with Reset to defaults disabled while the defaults are in use", () => {
    stubApi();
    renderRow(STATUS);

    expect(screen.getByRole("group", { name: "Personal scheduling" })).toBeTruthy();
    expect(screen.getByText(/Standard scheduling until there's enough/)).toBeTruthy();
    expect(button("Tune now").disabled).toBe(false);
    expect(button("Reset to defaults").disabled).toBe(true);
  });

  test("Tune now is busy while it runs, then shows its result inline and the new status", async () => {
    const { answer } = stubApi();
    renderRow(STATUS);

    fireEvent.click(button("Tune now"));
    expect(button("Checking…").disabled).toBe(true);
    const body: TuneResponse = { result: "applied", status: TUNED };
    await answer("/api/tuning", 200, body);

    await waitFor(() => expect(button("Tune now").disabled).toBe(false));
    expect(screen.getByRole("status").textContent).toBe(
      "Done: a better fit for how you remember is now in use.",
    );
    expect(
      screen.getByText(/Fitted to how you remember on 20 October, from 412 reviews/),
    ).toBeTruthy();
    expect(button("Reset to defaults").disabled).toBe(false);
  });

  test("Tune now says so when there isn't enough history, or Banki can't be reached", async () => {
    const { answer } = stubApi();
    renderRow(STATUS);

    fireEvent.click(button("Tune now"));
    await answer("/api/tuning", 200, { result: "not_enough_data", status: STATUS });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Not enough review history to fit yet. Keep studying.",
      ),
    );

    fireEvent.click(button("Tune now"));
    expect(screen.getByRole("status").textContent).toBe("");
    await answer("/api/tuning", 500, {});
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Couldn't reach Banki. Check your connection.",
      ),
    );
  });

  test("Reset to defaults asks first; Cancel leaves everything as it was", async () => {
    const { pending } = stubApi();
    renderRow(TUNED);

    fireEvent.click(button("Reset to defaults"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Reset scheduling to defaults?");
    expect(dialog.textContent).toContain("Your cards keep their due dates.");

    fireEvent.click(button("Cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(pending).toEqual([]);
  });

  test("Reset to defaults, confirmed, resets and shows the paused status", async () => {
    const { answer } = stubApi();
    renderRow(TUNED);

    fireEvent.click(button("Reset to defaults"));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Reset to defaults",
    );
    if (confirm === undefined) throw new Error("No confirm button");
    fireEvent.click(confirm);
    expect(confirm.textContent).toBe("Resetting…");
    const paused: TuningStatus = {
      ...STATUS,
      lastAttempt: { at: "2026-10-26T09:00:00.000Z", trigger: "reset", outcome: "reset" },
      reviewsUntilAutomatic: 0,
      paused: true,
    };
    await answer("/api/tuning/reset", 200, paused);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText(/reset by you/)).toBeTruthy();
    expect(screen.getByText(/starts the checks every 200 reviews again/)).toBeTruthy();
    expect(screen.queryByText(/^Every 200 reviews/)).toBeNull();
    expect(button("Reset to defaults").disabled).toBe(true);
  });

  test("a failed Reset says so in the dialog, which stays open", async () => {
    const { answer } = stubApi();
    renderRow(TUNED);

    fireEvent.click(button("Reset to defaults"));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Reset to defaults",
    );
    confirm?.click();
    await answer("/api/tuning/reset", 500, {});

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Couldn't reset. Check your connection."),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
