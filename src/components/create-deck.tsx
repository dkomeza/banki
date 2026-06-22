"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateDeck() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  async function save() {
    const response = await fetch("/api/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description: "" }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error); return; }
    router.push(`/decks/${data.id}`); router.refresh();
  }
  if (!open) return <button className="button ghost" onClick={() => setOpen(true)}>New empty deck</button>;
  return <div className="inline-form"><label>Deck name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void save()} /></label><button className="button" onClick={() => void save()}>Create deck</button>{error && <span className="form-error">{error}</span>}</div>;
}
