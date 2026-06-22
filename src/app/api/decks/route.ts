import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { decks } from "@/lib/db/schema";

const input = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).default("") });

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a deck name." }, { status: 400 });
  const now = Date.now();
  const deck = { id: crypto.randomUUID(), ...parsed.data, sourceName: null, createdAt: now, updatedAt: now };
  db.insert(decks).values(deck).run();
  return NextResponse.json(deck, { status: 201 });
}
