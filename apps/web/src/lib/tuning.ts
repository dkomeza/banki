import {
  DeckTuningStatus,
  TuneResponse,
  type TuningOutcome,
  type TuningResult,
  TuningStatus,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { ApiRequestError } from "./query";

// Tuning (CONTEXT.md) as Settings → Advanced shows it. The User never needs
// to understand FSRS, so nothing here says "FSRS" or "parameters": Banki
// fits its scheduling to how they remember.

/** How Tuning stands, from `GET /api/tuning`. */
export const tuningQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["tuning"],
    queryFn: async (): Promise<TuningStatus> => {
      const res = await client.api.tuning.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return TuningStatus.parse(await res.json());
    },
  });

/**
 * How Tuning stands for the Deck `deckId` (ADR-0033), from
 * `GET /api/decks/:deckId/tuning`; null for a Deck that is gone. It sits under
 * the Deck's key, so whatever fetches the Decks again fetches it too.
 */
export const deckTuningQueryOptions = (deckId: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["decks", deckId, "tuning"],
    queryFn: async (): Promise<DeckTuningStatus | null> => {
      const res = await client.api.decks[":deckId"].tuning.$get({ param: { deckId } });
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return DeckTuningStatus.parse(await res.json());
    },
  });

/**
 * After new scheduling applies, every Card keeps its due date but works out
 * its memory again (ADR-0029), so what shows schedules is fetched afresh:
 * the Decks' due counts and Study overviews, with each Deck's Tuning status,
 * and the Cards.
 */
const refetchSchedules = (queryClient: QueryClient) =>
  Promise.all(
    [["decks"], ["cards"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );

/**
 * Tune now: runs a Tuning and answers its overall result, keeping the status
 * it answers. Whatever that result, a Deck may have got a fit of its own, so
 * schedules are fetched again.
 */
export async function tuneNow(
  queryClient: QueryClient,
  client: ApiClient = api,
): Promise<TuningResult> {
  const res = await client.api.tuning.$post();
  if (!res.ok) throw new ApiRequestError(res.status);
  const { result, status } = TuneResponse.parse(await res.json());
  queryClient.setQueryData(tuningQueryOptions().queryKey, status);
  await refetchSchedules(queryClient);
  return result;
}

/**
 * Reset to defaults, keeping the status it answers. Answers whether it reset:
 * false when the defaults were in use already (another tab got there first),
 * in which case the status is fetched again.
 */
export async function resetTuning(
  queryClient: QueryClient,
  client: ApiClient = api,
): Promise<boolean> {
  const res = await client.api.tuning.reset.$post();
  const status: number = res.status;
  if (status === 409) {
    await queryClient.invalidateQueries({ queryKey: tuningQueryOptions().queryKey });
    return false;
  }
  if (!res.ok) throw new ApiRequestError(status);
  queryClient.setQueryData(tuningQueryOptions().queryKey, TuningStatus.parse(await res.json()));
  await refetchSchedules(queryClient);
  return true;
}

/** "26 October" this year, "26 October 2025" before. */
function dateLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

const reviews = (count: number) =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? "review" : "reviews"}`;

/** What each outcome of a check means, after "Last check, <date>: ". */
const OUTCOME_LINES: Record<TuningOutcome, string> = {
  applied: "found a better fit and switched to it.",
  kept: "no better fit than the current one, so it stayed.",
  not_enough_data: "not enough review history yet.",
  failed: "it couldn't finish.",
  reset: "reset to standard scheduling.",
};

/**
 * The status line: paused after a Reset; tuned on a date from so many
 * Reviews; or standard scheduling until there is enough history. Then how
 * many Decks have a fit of their own, if any; the last check and how it
 * went, unless that was the Reset or the Tuning that applied, which the first
 * part says.
 */
export function tuningStatusLines(status: TuningStatus, now = new Date()): string[] {
  const { tuned, lastAttempt } = status;
  const lines: string[] = [];
  if (status.paused) {
    lines.push(
      "Standard scheduling, reset by you. Banki won't fit it to you again until you press Tune now.",
    );
  } else if (tuned !== null) {
    lines.push(
      `Fitted to how you remember on ${dateLabel(tuned.at, now)}, from ${reviews(tuned.reviews)}.`,
    );
  } else {
    lines.push("Standard scheduling until there's enough of your review history to fit it to you.");
  }
  if (status.ownDecks > 0) {
    lines.push(
      status.ownDecks === 1
        ? "1 deck has a fit of its own."
        : `${status.ownDecks.toLocaleString("en-GB")} decks have a fit of their own.`,
    );
  }
  const said =
    lastAttempt === null ||
    lastAttempt.outcome === "reset" ||
    (lastAttempt.outcome === "applied" && tuned !== null && lastAttempt.at === tuned.at);
  if (lastAttempt !== null && !said) {
    lines.push(
      `Last check, ${dateLabel(lastAttempt.at, now)}: ${OUTCOME_LINES[lastAttempt.outcome]}`,
    );
  }
  if (!status.paused) {
    lines.push(
      status.reviewsUntilAutomatic === 0
        ? "Next check after your next review."
        : `Next check after ${status.reviewsUntilAutomatic.toLocaleString("en-GB")} more ${status.reviewsUntilAutomatic === 1 ? "review" : "reviews"}.`,
    );
  }
  return lines;
}

/**
 * How Deck settings says the Deck is scheduled (ADR-0033): fitted to it on a
 * date from so many Reviews; following the overall scheduling until it has
 * the Reviews it needs; following it because the last check found it fits
 * the Deck best; or, with the Reviews it needs, following it until a check.
 */
export function deckSchedulingLine(status: DeckTuningStatus, now = new Date()): string {
  const { tuned, reviewCount, threshold, lastAttempt } = status;
  if (status.parameters === "own") {
    return tuned === null
      ? "Fitted to how you remember this deck."
      : `Fitted to how you remember this deck on ${dateLabel(tuned.at, now)}, from ${reviews(tuned.reviews)}.`;
  }
  if (reviewCount < threshold) {
    return `Follows your overall scheduling until this deck has ${reviews(threshold)} (${reviewCount.toLocaleString("en-GB")} so far).`;
  }
  if (lastAttempt?.outcome === "kept") {
    return "Follows your overall scheduling, which fits this deck best.";
  }
  return `Follows your overall scheduling for now. With ${reviews(reviewCount)}, the next check sees whether a fit of its own would suit it better.`;
}

/** What Tune now says once it has run. */
export const TUNE_RESULTS: Record<TuningResult, string> = {
  applied: "Done: a better fit for how you remember is now in use.",
  kept: "Done: no better fit than the current one, so nothing changed.",
  not_enough_data: "Not enough review history to fit yet. Keep studying.",
  failed: "Couldn't finish the check. Try again later.",
};

export const TUNE_FAILED = "Couldn't reach Banki. Check your connection.";
export const RESET_FAILED = "Couldn't reset. Check your connection.";
