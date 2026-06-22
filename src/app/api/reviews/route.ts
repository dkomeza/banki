import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db";
import { cards, reviews, settings } from "@/lib/db/schema";
import { applyRating, isGrade, serializeFsrsCard } from "@/lib/scheduler";

const input = z.object({
  cardId: z.string().min(1), rating: z.number().int().min(1).max(4),
  shownAt: z.number().int().positive(), answeredAt: z.number().int().positive(), planId: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success || !isGrade(parsed.data.rating)) return NextResponse.json({ error: "Invalid review." }, { status: 400 });
  const card = db.select().from(cards).where(eq(cards.id, parsed.data.cardId)).get();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const config = db.select().from(settings).where(eq(settings.id, 1)).get();
  const weights = config?.fsrsWeights ? JSON.parse(config.fsrsWeights) as number[] : null;
  const result = applyRating(card, parsed.data.rating, new Date(parsed.data.answeredAt), weights, config?.desiredRetention ?? 0.9);
  const serialized = serializeFsrsCard(result.card);
  const transaction = sqlite.transaction(() => {
    db.update(cards).set(serialized).where(eq(cards.id, card.id)).run();
    db.insert(reviews).values({
      id: crypto.randomUUID(), cardId: card.id, planId: parsed.data.planId ?? null,
      rating: parsed.data.rating, previousState: card.state, shownAt: parsed.data.shownAt,
      answeredAt: parsed.data.answeredAt, durationMs: Math.min(300_000, Math.max(0, parsed.data.answeredAt - parsed.data.shownAt)),
      stability: result.card.stability, difficulty: result.card.difficulty, scheduledDays: result.card.scheduled_days,
    }).run();
  });
  transaction();
  return NextResponse.json({ card: serialized, log: result.log });
}
