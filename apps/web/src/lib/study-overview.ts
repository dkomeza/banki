import {
  type StudyDay,
  type StudyDaySettings,
  StudyOverviewResponse,
  studyDayOf,
} from "@banki/shared";
import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { ApiRequestError } from "./query";

// What Study will bring, before a Session (the deck page's Study card) and
// after one (the summary's next-due or still-to-study line), and how both
// word it.

export type StudyOverview = StudyOverviewResponse;

/** What Study on a Deck brings now, from `GET /api/decks/:deckId/study/overview`; null for a Deck that is gone. */
export const studyOverviewQueryOptions = (deckId: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["decks", deckId, "study-overview"],
    queryFn: async (): Promise<StudyOverview | null> => {
      const res = await client.api.decks[":deckId"].study.overview.$get({ param: { deckId } });
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return StudyOverviewResponse.parse(await res.json());
    },
  });

/** "~9 min", rounded to whole minutes; "<1 min" under a minute. */
export function estimateLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "<1 min" : `~${minutes} min`;
}

/** "1 card", "14 cards". */
export const cardsLabel = (count: number) => (count === 1 ? "1 card" : `${count} cards`);

const dateOf = (day: StudyDay) => new Date(`${day}T00:00:00Z`);

/**
 * A Study day after today as Next due words it: "tomorrow"; its weekday
 * ("Friday") within the next 6 days; else its date ("12 Nov"). `today` is
 * the User's Study day now.
 */
export function nextDayLabel(day: StudyDay, today: StudyDay): string {
  const days = Math.round((dateOf(day).getTime() - dateOf(today).getTime()) / 86_400_000);
  if (days <= 1) return "tomorrow";
  if (days <= 6)
    return dateOf(day).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return dateOf(day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The User's Study day at `now`, by their Timezone and Day start. */
export const todayOf = (settings: StudyDaySettings, now = new Date()): StudyDay =>
  studyDayOf(now, settings);

/** "tomorrow, 14 cards": the next due day and its count, or undefined when none is. */
export function nextDueLabel(
  nextDue: StudyOverview["nextDue"],
  today: StudyDay,
): string | undefined {
  if (nextDue === null) return undefined;
  return `${nextDayLabel(nextDue.day, today)}, ${cardsLabel(nextDue.count)}`;
}

/** Whether Study has nothing to show now: nothing due and no New card. */
export const nothingToStudy = (overview: StudyOverview) => overview.due === 0 && overview.new === 0;
