import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cards, settings } from "@/lib/db/schema";
import { gradeAnswer, resolveGradingConfig } from "@/lib/answer-grader";

const input = z.object({
  cardId: z.string().min(1),
  answer: z.string().trim().min(1, "Write an answer first.").max(8_000, "Answer is too long."),
});

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid answer." }, { status: 400 });
  const card = db.select({ frontHtml: cards.frontHtml, backHtml: cards.backHtml }).from(cards).where(eq(cards.id, parsed.data.cardId)).get();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const config = db.select().from(settings).where(eq(settings.id, 1)).get();
  try {
    return NextResponse.json(await gradeAnswer({ promptHtml: card.frontHtml, expectedAnswerHtml: card.backHtml, learnerAnswer: parsed.data.answer, config: resolveGradingConfig(config) }));
  } catch (error) {
    console.error("Answer grading failed", error);
    const message = error instanceof Error ? error.message : "The answer could not be graded.";
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 502 });
  }
}
