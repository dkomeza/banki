import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cards, settings } from "@/lib/db/schema";
import { resolveGradingConfig, streamGradeAnswer } from "@/lib/answer-grader";

const input = z.object({
  cardId: z.string().min(1),
  answer: z.string().trim().min(1, "Write an answer first.").max(8_000, "Answer is too long."),
});

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid answer." }, { status: 400 });
  const card = db.select({ frontHtml: cards.frontHtml, backHtml: cards.backHtml }).from(cards).where(eq(cards.id, parsed.data.cardId)).get();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const config = resolveGradingConfig(db.select().from(settings).where(eq(settings.id, 1)).get());
  if (!config.enabled || !config.apiKey) return NextResponse.json({ error: "LLM grading is not configured. Add an API key in Settings." }, { status: 503 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        for await (const event of streamGradeAnswer({ promptHtml: card.frontHtml, expectedAnswerHtml: card.backHtml, learnerAnswer: parsed.data.answer, config, signal: request.signal })) {
          send(event.type, event);
        }
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("Answer grading failed", error);
          send("error", { type: "error", error: error instanceof Error ? error.message : "The answer could not be graded." });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
