import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { decks } from "@/lib/db/schema";
import { CardEditor } from "@/components/card-editor";

export const dynamic = "force-dynamic";

export default async function NewCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const deck = db.select().from(decks).where(eq(decks.id, id)).get(); if (!deck) notFound();
  return <main className="page narrow"><Link className="back-link" href={`/decks/${id}`}>← {deck.name}</Link><div className="page-title"><p className="eyebrow">Card editor</p><h1>Write one precise memory.</h1><p>Use <code>$...$</code> for inline math and <code>$$...$$</code> for display equations.</p></div><CardEditor deckId={id} /></main>;
}
