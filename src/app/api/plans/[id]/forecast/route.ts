import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db";
import { cards, plans, settings } from "@/lib/db/schema";
import { buildForecast } from "@/lib/planner";
import { zonedDateEnd } from "@/lib/time";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const plan = db.select().from(plans).where(eq(plans.id, id)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  const config = db.select().from(settings).where(eq(settings.id, 1)).get();
  const deckCards = db.select().from(cards).where(eq(cards.deckId, plan.deckId)).all();
  const durations = sqlite.prepare("SELECT state, duration_ms FROM reviews ORDER BY answered_at DESC LIMIT 500").all() as Array<{ state: number; duration_ms: number }>;
  const median = (values: number[], fallback: number) => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] / 1000 : fallback;
  const reviewSeconds = median(durations.filter((item) => item.state !== 0).map((item) => item.duration_ms), 12);
  const newSeconds = median(durations.filter((item) => item.state === 0).map((item) => item.duration_ms), 35);
  const weights = config?.fsrsWeights ? JSON.parse(config.fsrsWeights) as number[] : null;
  const forecast = buildForecast(deckCards, new Date(), zonedDateEnd(plan.deadlineDate, config?.timezone ?? "Europe/Warsaw"), plan.dailyMinutes, reviewSeconds, newSeconds, weights, config?.desiredRetention ?? 0.9);
  return NextResponse.json({ ...forecast, rankedCards: forecast.rankedCards.map((item) => ({ ...item, card: { id: item.card.id, frontHtml: item.card.frontHtml, due: item.card.due } })) });
}
