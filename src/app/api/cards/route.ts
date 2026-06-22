import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { sanitizeCardHtml } from "@/lib/anki-template";

const input = z.object({
  deckId: z.string().min(1),
  frontHtml: z.string().trim().min(1).max(100_000),
  backHtml: z.string().trim().min(1).max(100_000),
  tags: z.array(z.string().trim().min(1).max(50)).max(40).default([]),
});

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Front and back are required." }, { status: 400 });
  const now = Date.now();
  const card = {
    id: crypto.randomUUID(), deckId: parsed.data.deckId, sourceGuid: null,
    frontHtml: sanitizeCardHtml(parsed.data.frontHtml), backHtml: sanitizeCardHtml(parsed.data.backHtml),
    tags: JSON.stringify(parsed.data.tags), position: 0, due: now, stability: 0, difficulty: 0,
    scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null,
    createdAt: now, updatedAt: now,
  };
  try { db.insert(cards).values(card).run(); }
  catch { return NextResponse.json({ error: "The selected deck does not exist." }, { status: 404 }); }
  return NextResponse.json(card, { status: 201 });
}
