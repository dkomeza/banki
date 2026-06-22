import Link from "next/link";
import { count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, decks, plans, reviews } from "@/lib/db/schema";
import { ImportPanel } from "@/components/import-panel";
import { CreateDeck } from "@/components/create-deck";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const deckRows = db.select({ id: decks.id, name: decks.name, description: decks.description, cardCount: count(cards.id), activePlan: plans.id, deadline: plans.deadlineDate, minutes: plans.dailyMinutes })
    .from(decks).leftJoin(cards, eq(cards.deckId, decks.id)).leftJoin(plans, sql`${plans.deckId} = ${decks.id} AND ${plans.active} = 1`).groupBy(decks.id).all();
  const totalReviews = db.select({ value: count() }).from(reviews).get()?.value ?? 0;
  const dueNow = db.select({ value: count() }).from(cards).where(sql`${cards.due} <= ${Date.now()}`).get()?.value ?? 0;
  return <main className="page"><section className="dashboard-hero"><div><p className="eyebrow">Today’s memory position</p><h1>Put the next minute<br />where it remembers most.</h1><p className="hero-copy">Banki measures what is fading, what can wait, and what deserves attention before your deadline.</p><div className="hero-actions">{deckRows[0] && <Link className="button" href={`/study/${deckRows[0].id}`}>Study now</Link>}<CreateDeck /></div></div><aside className="instrument-readout"><span className="readout-label">Live queue</span><strong>{dueNow.toString().padStart(2, "0")}</strong><span>cards due</span><div className="readout-rule" /><span>{totalReviews} reviews recorded</span></aside></section>
    <section className="section-heading"><div><p className="eyebrow">Material</p><h2>Your decks</h2></div><span>{deckRows.length} active</span></section>
    {deckRows.length ? <div className="deck-grid">{deckRows.map((deck) => <Link className="deck-card" key={deck.id} href={`/decks/${deck.id}`}><div className="deck-card-top"><span className={deck.activePlan ? "status-dot active" : "status-dot"} /><span>{deck.activePlan ? `Due ${deck.deadline}` : "Normal schedule"}</span></div><h3>{deck.name}</h3><p>{deck.description.replace(/<[^>]+>/g, "").slice(0, 130) || "No description"}</p><footer><strong>{deck.cardCount}</strong><span>cards</span>{deck.minutes && <><strong>{deck.minutes}</strong><span>min/day</span></>}</footer></Link>)}</div> : <div className="empty-decks"><div className="empty-orbit"><span>∑</span></div><h2>Start with the material you already have.</h2><p>Import an Anki package or create an empty deck. Imported progress is reset so your schedule begins cleanly.</p></div>}
    <ImportPanel />
  </main>;
}
