"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MathRenderer } from "@/components/math-renderer";

export function CardEditor({ deckId }: { deckId: string }) {
  const [front, setFront] = useState("What is \\(e^{i\\pi} + 1\\)?");
  const [back, setBack] = useState("\\[e^{i\\pi} + 1 = 0\\]");
  const [tags, setTags] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  const [error, setError] = useState("");
  const router = useRouter();
  async function save() {
    const response = await fetch("/api/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deckId, frontHtml: front, backHtml: back, tags: tags.split(/[, ]+/).filter(Boolean) }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error); return; }
    router.push(`/decks/${deckId}`); router.refresh();
  }
  return <div className="editor-grid"><section className="editor-fields"><label>Front<textarea rows={8} value={front} onChange={(e) => setFront(e.target.value)} /></label><label>Back<textarea rows={8} value={back} onChange={(e) => setBack(e.target.value)} /></label><label>Tags<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="calculus exam-1" /></label>{error && <p className="form-error">{error}</p>}<button className="button" onClick={() => void save()}>Save card</button></section><section className="editor-preview"><div className="preview-switch"><button className={side === "front" ? "active" : ""} onClick={() => setSide("front")}>Front</button><button className={side === "back" ? "active" : ""} onClick={() => setSide("back")}>Back</button></div><MathRenderer html={side === "front" ? front : back} /></section></div>;
}
