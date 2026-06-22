import { notFound } from "next/navigation";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, decks, plans, settings } from "@/lib/db/schema";
import { StudySession } from "@/components/study-session";
import { rankCards } from "@/lib/planner";
import { zonedDateEnd } from "@/lib/time";
import { resolveGradingConfig } from "@/lib/answer-grader";

export const dynamic = "force-dynamic";

export default async function StudyPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params; const deck = db.select().from(decks).where(eq(decks.id, deckId)).get(); if (!deck) notFound();
  const plan = db.select().from(plans).where(eq(plans.deckId, deckId)).get(); const config = db.select().from(settings).where(eq(settings.id, 1)).get();
  let queue = db.select().from(cards).where(eq(cards.deckId, deckId)).orderBy(asc(cards.due)).all();
  if (plan) {
    const ranked = rankCards(queue, new Date(), zonedDateEnd(plan.deadlineDate, config?.timezone ?? "Europe/Warsaw"), 12, 35, config?.fsrsWeights ? JSON.parse(config.fsrsWeights) : null, config?.desiredRetention ?? 0.9);
    const capacity = Math.max(1, Math.floor((plan.dailyMinutes * 60) / 20)); queue = ranked.slice(0, capacity).map((item) => item.card);
  } else {
    // Server-rendered queue selection intentionally uses the request time.
    // eslint-disable-next-line react-hooks/purity
    const due = db.select().from(cards).where(and(eq(cards.deckId, deckId), lte(cards.due, Date.now()))).orderBy(asc(cards.due)).limit(80).all(); queue = due.length ? due : queue.filter((card) => card.reps === 0).slice(0, 20);
  }
  const grading = resolveGradingConfig(config);
  return <main className="study-page"><StudySession initialCards={queue.map(({ id, frontHtml, backHtml, reps, due }) => ({ id, frontHtml, backHtml, reps, due }))} planId={plan?.id} gradingEnabled={grading.enabled && Boolean(grading.apiKey)} /></main>;
}
