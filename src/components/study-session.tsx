"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MathRenderer } from "@/components/math-renderer";

type StudyCard = { id: string; frontHtml: string; backHtml: string; reps: number; due: number };
type StudyMode = "classic" | "written";
type GradeResult = { rating: 1 | 2 | 3 | 4; feedback: string };
const ratings = [
  { value: 1, label: "Again", key: "1", hint: "Forgot" },
  { value: 2, label: "Hard", key: "2", hint: "Barely recalled" },
  { value: 3, label: "Good", key: "3", hint: "Recalled" },
  { value: 4, label: "Easy", key: "4", hint: "Immediate" },
];

export function StudySession({ initialCards, planId, gradingEnabled }: { initialCards: StudyCard[]; planId?: string; gradingEnabled: boolean }) {
  const [cards, setCards] = useState(initialCards);
  const [revealed, setRevealed] = useState(false);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<StudyMode>("classic");
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const router = useRouter();
  const card = cards[0];

  async function rate(rating: number) {
    if (!card || busy) return;
    setBusy(true); setError("");
    const response = await fetch("/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId: card.id, rating, shownAt, answeredAt: Date.now(), planId: planId ?? null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error); setBusy(false); return; }
    setCards((current) => current.slice(1)); setRevealed(false); setAnswer(""); setGrade(null); setShownAt(Date.now()); setBusy(false); router.refresh();
  }

  async function submitAnswer() {
    if (!card || grading || !answer.trim()) return;
    setGrading(true); setError("");
    try {
      const response = await fetch("/api/grade-answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId: card.id, answer }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "The answer could not be graded."); return; }
      setGrade(data); setRevealed(true);
    } catch {
      setError("The grading service could not be reached.");
    } finally { setGrading(false); }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (mode === "classic" && !revealed && (event.code === "Space" || event.code === "Enter")) { event.preventDefault(); setRevealed(true); return; }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) void rate(Number(event.key));
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  });

  const progress = useMemo(() => initialCards.length ? ((initialCards.length - cards.length) / initialCards.length) * 100 : 100, [cards.length, initialCards.length]);
  if (!card) return <section className="session-complete"><span className="completion-mark">✓</span><p className="eyebrow">Session complete</p><h1>You spent today’s attention where it matters.</h1><p>The forecast will update with your new memory states.</p><Link className="button" href="/">Return to dashboard</Link></section>;

  return (
    <div className="study-shell">
      <header className="study-meta"><span>{cards.length} cards in this session</span><span>{planId ? "Deadline mode" : "FSRS due queue"}</span></header>
      <div className="study-mode" aria-label="Study mode">
        <button className={mode === "classic" ? "active" : ""} onClick={() => { setMode("classic"); setAnswer(""); setGrade(null); setRevealed(false); setError(""); }}>Self-rate</button>
        <button disabled={!gradingEnabled} title={gradingEnabled ? undefined : "Set OPENAI_API_KEY to enable LLM grading"} className={mode === "written" ? "active" : ""} onClick={() => { setMode("written"); setGrade(null); setRevealed(false); setError(""); }}>Write &amp; grade</button>
      </div>
      <div className="session-progress"><i style={{ width: `${progress}%` }} /></div>
      <main className="study-card" aria-live="polite">
        <p className="card-side-label">{revealed ? "Answer" : "Prompt"}</p>
        <MathRenderer key={`${card.id}-${revealed}`} html={revealed ? card.backHtml : card.frontHtml} />
      </main>
      {error && <p className="form-error centered" role="alert">{error}</p>}
      {mode === "written" && !revealed ? (
        <form className="written-answer" onSubmit={(event) => { event.preventDefault(); void submitAnswer(); }}>
          <label htmlFor="study-answer">Your answer</label>
          <textarea id="study-answer" rows={4} maxLength={8000} autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Explain the answer in your own words…" />
          <button className="reveal-button" disabled={grading || !answer.trim()} type="submit">{grading ? "Grading…" : "Grade answer"}</button>
        </form>
      ) : !revealed ? <button className="reveal-button" onClick={() => setRevealed(true)}>Show answer <kbd>Space</kbd></button> : (
        <>
        {grade && <section className={`grade-feedback grade-${grade.rating}`} aria-live="polite"><strong>Suggested: {ratings[grade.rating - 1].label}</strong><p>{grade.feedback}</p><small>Confirm or choose a different rating.</small></section>}
        <div className="rating-grid">
          {ratings.map((rating) => <button disabled={busy} className={`rating rating-${rating.value}${grade?.rating === rating.value ? " suggested" : ""}`} key={rating.value} onClick={() => void rate(rating.value)}><span>{rating.label}</span><small>{rating.hint}</small><kbd>{rating.key}</kbd></button>)}
        </div>
        </>
      )}
    </div>
  );
}
