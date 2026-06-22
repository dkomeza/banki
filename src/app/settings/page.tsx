import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviews, settings } from "@/lib/db/schema";
import { OptimizeButton } from "@/components/optimize-button";
import { GradingSettings } from "@/components/grading-settings";
import { LlmCardInstructions } from "@/components/llm-card-instructions";
import { resolveGradingConfig } from "@/lib/answer-grader";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const config = db.select().from(settings).where(eq(settings.id, 1)).get(); const reviewCount = db.select({ value: count() }).from(reviews).get()?.value ?? 0; const grading = resolveGradingConfig(config);
  return <main className="page narrow"><div className="page-title"><p className="eyebrow">Configuration</p><h1>Keep the instrument calibrated.</h1></div><section className="settings-list"><div><span>Study timezone</span><strong>{config?.timezone ?? "Europe/Warsaw"}</strong></div><div><span>Normal desired retention</span><strong>{Math.round((config?.desiredRetention ?? 0.9) * 100)}%</strong></div><div><span>Scheduler parameters</span><strong>{config?.fsrsWeights ? "Personalized" : "FSRS cohort defaults"}</strong></div><div><span>Written-answer grading</span><strong>{grading.enabled && grading.apiKey ? `Enabled · ${grading.provider === "openrouter" ? "OpenRouter" : "OpenAI"} · ${grading.model}` : "Disabled or missing key"}</strong></div><div className="settings-action"><span><strong>Personalize FSRS</strong><small>Fits memory parameters to your local review history.</small></span><OptimizeButton reviewCount={reviewCount} /></div></section><LlmCardInstructions /><GradingSettings initialEnabled={grading.enabled} initialProvider={grading.provider} initialModel={grading.model} storedKeys={{ openai: Boolean(config?.openaiApiKey), openrouter: Boolean(config?.openrouterApiKey) }} environmentKeys={{ openai: Boolean(process.env.OPENAI_API_KEY), openrouter: Boolean(process.env.OPENROUTER_API_KEY) }} /><section className="data-note"><p className="eyebrow">Data boundary</p><h2>Study data stays local by default.</h2><p>SQLite data, imported media, self-ratings, and equation rendering stay in this installation. Keys saved here are stored in the local SQLite database and are never sent to the browser again. When you use written-answer grading, the card prompt, reference answer, and your answer are sent to the selected provider.</p></section></main>;
}
