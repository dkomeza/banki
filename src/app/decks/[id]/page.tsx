import Link from "next/link";
import { notFound } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, decks, plans, settings } from "@/lib/db/schema";
import { PlanForm } from "@/components/plan-form";
import { MemoryHorizon } from "@/components/memory-horizon";
import { buildForecast } from "@/lib/planner";
import { zonedDateEnd } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deck = db.select().from(decks).where(eq(decks.id, id)).get();
  if (!deck) notFound();
  const deckCards = db.select().from(cards).where(eq(cards.deckId, id)).all();
  const plan = db.select().from(plans).where(eq(plans.deckId, id)).get();
  const config = db.select().from(settings).where(eq(settings.id, 1)).get();
  const weights = config?.fsrsWeights ? JSON.parse(config.fsrsWeights) : null;
  const forecast = plan ? buildForecast(deckCards, new Date(), zonedDateEnd(plan.deadlineDate, config?.timezone ?? "Europe/Warsaw"), plan.dailyMinutes, 12, 35, weights, config?.desiredRetention ?? 0.9) : null;
  const reviewed = db.select({ value: count() }).from(cards).where(eq(cards.deckId, id)).get()?.value ?? 0;
  // Server-rendered default is intentionally based on the request time.
  // eslint-disable-next-line react-hooks/purity
  const defaultDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  return <main className="page"><div className="deck-title"><div><Link className="back-link" href="/">← All decks</Link><p className="eyebrow">{plan ? "Deadline plan active" : "FSRS schedule"}</p><h1>{deck.name}</h1><p>{deck.description.replace(/<[^>]+>/g, "") || `${reviewed} cards ready to study.`}</p></div><div className="deck-actions"><Link className="button" href={`/study/${id}`}>Study deck</Link><Link className="button secondary" href={`/decks/${id}/cards/new`}>Add card</Link></div></div>
    {forecast && <section className="forecast-panel"><div className="forecast-copy"><p className="eyebrow">Memory horizon</p><h2>{Math.round(forecast.predictedRecall * 100)}% predicted recall</h2><p>{forecast.expectedRemembered.toFixed(1)} of {deckCards.length} cards expected at the deadline. {forecast.daysRemaining} study days remain.</p>{forecast.cardsNotIntroduced > 0 && <p className="forecast-warning">At this budget, {forecast.cardsNotIntroduced} cards may not be introduced.</p>}</div><MemoryHorizon points={forecast.horizon} /></section>}
    <section className="two-column"><div className="panel"><p className="eyebrow">Target</p><h2>{plan ? "Adjust the plan" : "Learn by a deadline"}</h2><p>Banki will spend each available minute on the largest expected recall gain.</p><PlanForm deckId={id} initialDate={plan?.deadlineDate} initialMinutes={plan?.dailyMinutes} defaultDate={defaultDate} /></div><div className="panel card-sample"><p className="eyebrow">Cards</p><h2>{deckCards.length} prompts</h2>{deckCards.slice(0, 3).map((card) => <div className="card-row" key={card.id}><span dangerouslySetInnerHTML={{ __html: card.frontHtml.replace(/<style>[\s\S]*?<\/style>/g, "").slice(0, 100) }} /><small>{card.reps ? `${card.reps} reviews` : "New"}</small></div>)}{!deckCards.length && <p className="muted">Add a card to begin.</p>}<Link className="text-link" href={`/decks/${id}/cards/new`}>Create another card →</Link></div></section>
  </main>;
}
