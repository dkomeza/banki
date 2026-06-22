"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Report = { deckId: string; importedCards: number; importedMedia: number; skippedCards: number; warnings: string[] };

export function ImportPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setReport(null);
    const body = new FormData(); body.append("file", file);
    const response = await fetch("/api/imports", { method: "POST", body });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Import failed."); return; }
    setReport(data); router.refresh();
  }

  return (
    <section className="import-panel" aria-labelledby="import-title">
      <div>
        <p className="eyebrow">Bring your material</p>
        <h2 id="import-title">Import study cards</h2>
        <p>Use Banki JSON for generated cards or Anki packages for existing decks. Every import starts a fresh FSRS schedule.</p>
      </div>
      <input ref={input} type="file" accept=".apkg,.json,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
      <button className="button secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Importing…" : "Choose import file"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {report && (
        <div className="import-result" role="status">
          <strong>{report.importedCards} cards imported</strong>
          <span>{report.importedMedia} media files · {report.skippedCards} skipped</span>
          {report.warnings.map((warning) => <small key={warning}>{warning}</small>)}
          <a href={`/decks/${report.deckId}`} className="text-link">Open deck →</a>
        </div>
      )}
    </section>
  );
}
