"use client";

import { useState } from "react";

export function OptimizeButton({ reviewCount }: { reviewCount: number }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function optimize() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/settings/optimize", { method: "POST" });
    const data = await response.json(); setBusy(false);
    setMessage(response.ok ? `Scheduler optimized from ${data.reviews} reviews.` : data.error);
  }
  return <div><button className="button secondary" disabled={busy || reviewCount < 400} onClick={() => void optimize()}>{busy ? "Optimizing…" : "Optimize FSRS"}</button>{reviewCount < 400 && <p className="muted">Available after {400 - reviewCount} more reviews.</p>}{message && <p className="status-message">{message}</p>}</div>;
}
