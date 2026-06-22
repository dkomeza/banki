import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

const input = z.object({
  enabled: z.boolean(),
  provider: z.enum(["openai", "openrouter"]),
  model: z.string().trim().min(1, "Model is required.").max(100),
  apiKey: z.string().trim().max(500).optional(),
});

export async function PUT(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid configuration." }, { status: 400 });
  const current = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!current) return NextResponse.json({ error: "Settings record not found." }, { status: 500 });
  db.update(settings).set({
    gradingEnabled: parsed.data.enabled,
    gradingProvider: parsed.data.provider,
    openaiModel: parsed.data.model,
    ...(parsed.data.apiKey ? parsed.data.provider === "openrouter" ? { openrouterApiKey: parsed.data.apiKey } : { openaiApiKey: parsed.data.apiKey } : {}),
    updatedAt: Date.now(),
  }).where(eq(settings.id, 1)).run();
  const existingKey = parsed.data.provider === "openrouter" ? current.openrouterApiKey : current.openaiApiKey;
  return NextResponse.json({ saved: true, hasStoredKey: Boolean(parsed.data.apiKey || existingKey) });
}

export async function DELETE(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider") === "openrouter" ? "openrouter" : "openai";
  db.update(settings).set({ ...(provider === "openrouter" ? { openrouterApiKey: null } : { openaiApiKey: null }), updatedAt: Date.now() }).where(eq(settings.id, 1)).run();
  return NextResponse.json({ removed: true, usingEnvironmentKey: Boolean(provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY) });
}
