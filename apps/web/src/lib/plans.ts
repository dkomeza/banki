import {
  DAILY_MINUTES_MAX,
  DAILY_MINUTES_MIN,
  PlanCheckResponse,
  PlanResponse,
  type StudyDay,
  addStudyDays,
  deadlineProblem,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { CANT_REACH, type Deck, deckQueryOptions, decksQueryOptions } from "./decks";
import { ApiRequestError } from "./query";

// A Deck's Plan (CONTEXT.md: Plan, Deadline, Daily goal) as the Plan card on
// Deck settings shows it: saving and removing it, its feasibility check, and
// how the card words them.

export type Plan = PlanResponse;
export type PlanCheck = PlanCheckResponse;

/** A new Plan's Daily goal, until the User changes it. */
export const NEW_PLAN_MINUTES = 30;

/**
 * The feasibility check of `plan` for the Deck `deckId`, from
 * `GET /api/decks/:deckId/plan/check`; null for a Deck that is gone.
 */
export const planCheckQueryOptions = (deckId: string, plan: Plan, client: ApiClient = api) =>
  queryOptions({
    queryKey: [...planCheckKey(deckId), plan.deadline, plan.dailyMinutes],
    queryFn: async (): Promise<PlanCheck | null> => {
      const res = await client.api.decks[":deckId"].plan.check.$get({
        param: { deckId },
        query: { deadline: plan.deadline, dailyMinutes: String(plan.dailyMinutes) },
      });
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return PlanCheckResponse.parse(await res.json());
    },
  });

/** The key every check of the Deck `deckId` sits under. */
export const planCheckKey = (deckId: string) => ["decks", deckId, "plan-check"] as const;

/** Puts the Deck's Plan, or none, into its cache entry, and has the list fetched again. */
async function remember(queryClient: QueryClient, deckId: string, plan: Plan | null) {
  queryClient.setQueryData(deckQueryOptions(deckId).queryKey, (deck: Deck | null | undefined) =>
    deck === null || deck === undefined ? deck : { ...deck, plan },
  );
  await queryClient.invalidateQueries({ queryKey: decksQueryOptions().queryKey, exact: true });
}

/** What saving or removing a Plan answers: done, or a message saying why not. */
export type PlanOutcome = { ok: true } | { ok: false; message: string };

/** Creates or replaces the Deck's Plan with `PUT /api/decks/:deckId/plan`. */
export async function savePlan(
  queryClient: QueryClient,
  deckId: string,
  plan: Plan,
  client: ApiClient = api,
): Promise<PlanOutcome> {
  let res: Response;
  try {
    res = await client.api.decks[":deckId"].plan.$put({ param: { deckId }, json: plan });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (res.status === 404) return { ok: false, message: "This deck was deleted meanwhile." };
  if (res.status === 400) {
    return { ok: false, message: "Pick a deadline after today and within 2 years." };
  }
  if (!res.ok) return { ok: false, message: "Banki couldn't save the plan. Try again." };
  await remember(queryClient, deckId, PlanResponse.parse(await res.json()));
  return { ok: true };
}

/** Removes the Deck's Plan with `DELETE /api/decks/:deckId/plan`. */
export async function removePlan(
  queryClient: QueryClient,
  deckId: string,
  client: ApiClient = api,
): Promise<PlanOutcome> {
  let res: Response;
  try {
    res = await client.api.decks[":deckId"].plan.$delete({ param: { deckId } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (!res.ok && res.status !== 404) {
    return { ok: false, message: "Banki couldn't remove the plan. Try again." };
  }
  await remember(queryClient, deckId, null);
  return { ok: true };
}

const dateOf = (day: StudyDay) => new Date(`${day}T00:00:00Z`);

/** The Study days from `from` to `to`: 1 from today to tomorrow. */
export const daysBetween = (from: StudyDay, to: StudyDay) =>
  Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000);

/** "12 Dec". */
export const shortDate = (day: StudyDay) =>
  dateOf(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Saturday 12 December 2026", without the comma some engines put after the weekday. */
export const longDate = (day: StudyDay) =>
  dateOf(day)
    .toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
    .replace(",", "");

/** "Sat 12 Dec 2026", as the Deadline field shows it. */
export const fieldDate = (day: StudyDay) =>
  dateOf(day)
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .replace(",", "");

/** "In 33 days", "Tomorrow", "Today", "3 days ago", from `today`. */
export function relativeDays(day: StudyDay, today: StudyDay): string {
  const days = daysBetween(today, day);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

/** What the Deadline field says is wrong with `deadline`, if anything, when today is `today`. */
export function deadlineError(deadline: StudyDay, today: StudyDay): string | undefined {
  const problem = deadlineProblem(deadline, today);
  if (problem === "too_soon") return "Pick a day after today.";
  if (problem === "too_far") return "Pick a day within 2 years.";
  return undefined;
}

/** The Daily goal the minutes field holds, or what is wrong with it. */
export function parseMinutes(text: string): { minutes: number } | { error: string } {
  if (text.trim() === "") return { error: "Enter the minutes a day." };
  const minutes = Number(text);
  if (!Number.isInteger(minutes) || minutes < DAILY_MINUTES_MIN || minutes > DAILY_MINUTES_MAX) {
    return { error: `Between ${DAILY_MINUTES_MIN} and ${DAILY_MINUTES_MAX} minutes.` };
  }
  return { minutes };
}

/** How a check came out, which says how the card shows it. */
export type CheckOutcome = "covers" | "warning" | "impossible" | "none";

export const outcomeOf = (check: PlanCheck): CheckOutcome =>
  check.newCards === 0
    ? "none"
    : check.unlearned === 0
      ? "covers"
      : check.neededMinutes === null
        ? "impossible"
        : "warning";

/** "1 new card", "300 new cards". */
const newCards = (count: number) => (count === 1 ? "1 new card" : `${count} new cards`);

/** The check's sentence for `plan`, as the spec words it. */
export function checkText(check: PlanCheck, plan: Plan): string {
  const by = shortDate(plan.deadline);
  switch (outcomeOf(check)) {
    case "covers":
      return check.newCards === 1
        ? `Covers its 1 new card by ${by}.`
        : `Covers all ${newCards(check.newCards)} by ${by}.`;
    case "warning":
      return `At ${plan.dailyMinutes} min a day, ~${check.unlearned} of ${newCards(check.newCards)} won't be learned by ${by}. ${check.neededMinutes} min a day would cover them.`;
    case "impossible":
      return `Even ${DAILY_MINUTES_MAX} min a day won't cover all ${newCards(check.newCards)} by ${by}. A later deadline would give them time.`;
    default:
      return "No new cards to learn.";
  }
}

/** The first Deadline a Plan takes when today is `today`. */
export const firstDeadline = (today: StudyDay) => addStudyDays(today, 1);
