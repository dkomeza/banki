"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlanForm({ deckId, initialDate, initialMinutes, defaultDate }: { deckId: string; initialDate?: string; initialMinutes?: number; defaultDate: string }) {
  const [deadlineDate, setDate] = useState(initialDate ?? defaultDate);
  const [dailyMinutes, setMinutes] = useState(initialMinutes ?? 30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function save() {
    setBusy(true); setError("");
    const response = await fetch("/api/plans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deckId, deadlineDate, dailyMinutes }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error); return; }
    router.refresh();
  }
  return <div className="plan-form"><label>Deadline<input type="date" value={deadlineDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></label><label>Minutes each day<input type="number" min="5" max="720" value={dailyMinutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label><button className="button" disabled={busy} onClick={() => void save()}>{busy ? "Planning…" : initialDate ? "Update plan" : "Create plan"}</button>{error && <span className="form-error">{error}</span>}</div>;
}
