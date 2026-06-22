import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";

const input = z.object({
  deckId: z.string().min(1),
  deadlineDate: z.iso.date(),
  dailyMinutes: z.number().int().min(5).max(720),
});

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a future deadline and 5–720 minutes per day." }, { status: 400 });
  if (parsed.data.deadlineDate < new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "The deadline cannot be in the past." }, { status: 400 });
  const now = Date.now();
  const existing = db.select().from(plans).where(and(eq(plans.deckId, parsed.data.deckId), eq(plans.active, true))).get();
  if (existing) {
    db.update(plans).set({ deadlineDate: parsed.data.deadlineDate, dailyMinutes: parsed.data.dailyMinutes, updatedAt: now }).where(eq(plans.id, existing.id)).run();
    return NextResponse.json({ ...existing, ...parsed.data, updatedAt: now });
  }
  const plan = { id: crypto.randomUUID(), ...parsed.data, active: true, createdAt: now, updatedAt: now };
  db.insert(plans).values(plan).run();
  return NextResponse.json(plan, { status: 201 });
}
