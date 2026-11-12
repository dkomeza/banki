import { randomUUID } from "node:crypto";
import {
  type PlanCheckResponse,
  type PlanResponse,
  addStudyDays,
  deadlineProblem,
  studyDayBounds,
  studyDayOf,
} from "@banki/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, plan } from "../db/schema";
import { ESTIMATE_WINDOW_DAYS } from "../scheduling/estimate";
import { checkPlan } from "../scheduling/plan-check";
import { isLiveDeck } from "./cards";
import {
  MEMORY_COLUMNS,
  deckRetentionOf,
  schedulingSettingsOf,
  timedReviewsSince,
} from "./reviews";

export type PlanRepository = ReturnType<typeof createPlanRepository>;

/** Today's Study day for the User at `now`. */
const todayOf = (db: Queryable, userId: string, now: Date) =>
  studyDayOf(now, schedulingSettingsOf(db, userId).studyDay);

/**
 * The Plans of the User's Decks (CONTEXT.md: Plan; ADR-0031), one per Deck.
 * Every query is scoped by the User (ADR-0001): a deleted Deck, an unknown one
 * and another User's are all "not_found". A Deadline is checked against today
 * by the Timezone and Day start as they are on each call: it must be after
 * today and within 2 years ("invalid_deadline"). `now` is for tests.
 */
export function createPlanRepository(db: Queryable) {
  return {
    /** Creates or replaces the Plan of the User's Deck `deckId`, and answers it. */
    put(
      userId: string,
      deckId: string,
      { deadline, dailyMinutes }: PlanResponse,
      { now = new Date() }: { now?: Date } = {},
    ): PlanResponse | "not_found" | "invalid_deadline" {
      return db.transaction(
        (tx) => {
          if (!isLiveDeck(tx, userId, deckId)) return "not_found";
          if (deadlineProblem(deadline, todayOf(tx, userId, now)) !== undefined) {
            return "invalid_deadline";
          }
          tx.insert(plan)
            .values({
              id: randomUUID(),
              userId,
              deckId,
              deadline,
              dailyMinutes,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: plan.deckId,
              set: { deadline, dailyMinutes, updatedAt: now },
            })
            .run();
          return { deadline, dailyMinutes };
        },
        { behavior: "immediate" },
      );
    },

    /** Removes the Plan of the User's Deck `deckId`, if it has one. */
    remove(userId: string, deckId: string): "removed" | "not_found" {
      return db.transaction(
        (tx) => {
          if (!isLiveDeck(tx, userId, deckId)) return "not_found";
          tx.delete(plan)
            .where(and(eq(plan.userId, userId), eq(plan.deckId, deckId)))
            .run();
          return "removed";
        },
        { behavior: "immediate" },
      );
    },

    /**
     * The feasibility check (`checkPlan`) of a Plan of `dailyMinutes` a day to
     * `deadline` for the User's Deck `deckId`, from its live Cards as they are,
     * its Desired retention, and the User's Reviews over the last 30 Study days.
     * Saves nothing.
     */
    check(
      userId: string,
      deckId: string,
      { deadline, dailyMinutes }: PlanResponse,
      { now = new Date() }: { now?: Date } = {},
    ): PlanCheckResponse | "not_found" | "invalid_deadline" {
      return db.transaction((tx) => {
        if (!isLiveDeck(tx, userId, deckId)) return "not_found";
        const { studyDay, parameters } = schedulingSettingsOf(tx, userId);
        const today = studyDayOf(now, studyDay);
        if (deadlineProblem(deadline, today) !== undefined) return "invalid_deadline";
        const cards = tx
          .select({ id: card.id, createdAt: card.createdAt, ...MEMORY_COLUMNS })
          .from(card)
          .where(and(eq(card.userId, userId), eq(card.deckId, deckId), isNull(card.deletedAt)))
          .all();
        const since = studyDayBounds(addStudyDays(today, -(ESTIMATE_WINDOW_DAYS - 1)), studyDay);
        return checkPlan(
          {
            deckId,
            cards,
            reviews: timedReviewsSince(tx, userId, since.start),
            deadline,
            now,
            desiredRetention: deckRetentionOf(tx, userId, deckId),
            studyDay,
            parameters,
          },
          dailyMinutes,
        );
      });
    },
  };
}
