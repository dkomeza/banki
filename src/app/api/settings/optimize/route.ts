import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { computeParameters, FSRSBindingItem, FSRSBindingReview } from "@open-spaced-repetition/binding";
import { db, sqlite } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function POST() {
  const rows = sqlite.prepare("SELECT card_id, rating, answered_at FROM reviews ORDER BY card_id, answered_at").all() as Array<{ card_id: string; rating: number; answered_at: number }>;
  if (rows.length < 400) return NextResponse.json({ error: `Collect ${400 - rows.length} more reviews before optimizing.` }, { status: 400 });
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) grouped.set(row.card_id, [...(grouped.get(row.card_id) ?? []), row]);
  const items = [...grouped.values()].flatMap((history) => {
    const reviews = history.map((row, index) => new FSRSBindingReview(row.rating, index ? Math.max(0, Math.round((row.answered_at - history[index - 1].answered_at) / 86_400_000)) : 0));
    return reviews.slice(1).map((_, index) => new FSRSBindingItem(reviews.slice(0, index + 2)));
  });
  const parameters = await computeParameters(items, { enableShortTerm: true, numRelearningSteps: 1, timeout: 120 });
  db.update(settings).set({ fsrsWeights: JSON.stringify(parameters), updatedAt: Date.now() }).where(eq(settings.id, 1)).run();
  return NextResponse.json({ parameters, reviews: rows.length });
}
