"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GradingSettings({
  initialEnabled, initialProvider, initialModel, storedKeys, environmentKeys,
}: { initialEnabled: boolean; initialProvider: "openai" | "openrouter"; initialModel: string; storedKeys: Record<"openai" | "openrouter", boolean>; environmentKeys: Record<"openai" | "openrouter", boolean> }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function save() {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/settings/grading", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, provider, model, ...(apiKey.trim() ? { apiKey } : {}) }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Configuration could not be saved."); return; }
      setApiKey(""); setMessage("Grading configuration saved."); router.refresh();
    } catch { setError("Configuration could not be saved."); }
    finally { setBusy(false); }
  }

  async function removeKey() {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/settings/grading?provider=${provider}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Saved key could not be removed."); return; }
      setApiKey(""); setMessage(data.usingEnvironmentKey ? "Saved key removed; the environment key is now in use." : "Saved API key removed."); router.refresh();
    } catch { setError("Saved key could not be removed."); }
    finally { setBusy(false); }
  }

  const hasStoredKey = storedKeys[provider];
  const hasEnvironmentKey = environmentKeys[provider];
  const providerName = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const keyStatus = hasStoredKey ? `A saved ${providerName} API key is configured.` : hasEnvironmentKey ? `Using ${provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} from the environment.` : "No API key configured.";
  return <section className="grading-settings panel">
    <div><p className="eyebrow">Written answers</p><h2>LLM grading</h2><p>Send written answers to your selected provider and receive a suggested FSRS rating.</p></div>
    <div className="grading-fields">
      <label className="toggle-field"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Enable written-answer grading</span></label>
      <label>Provider<select value={provider} onChange={(event) => { const next = event.target.value as "openai" | "openrouter"; setProvider(next); setModel(next === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4o-mini"); setApiKey(""); }}><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></label>
      <label>Model<input value={model} maxLength={100} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4o-mini" /></label>
      <label>{providerName} API key<input type="password" value={apiKey} maxLength={500} autoComplete="new-password" onChange={(event) => setApiKey(event.target.value)} placeholder={hasStoredKey || hasEnvironmentKey ? "Leave blank to keep current key" : provider === "openrouter" ? "sk-or-…" : "sk-…"} /><small>{keyStatus}</small></label>
      <div className="grading-actions"><button className="button" disabled={busy || !model.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save grading settings"}</button>{hasStoredKey && <button className="button ghost" disabled={busy} onClick={() => void removeKey()}>Remove saved key</button>}</div>
      {provider === "openrouter" && <p className="provider-note">Use an OpenRouter model slug such as <code>anthropic/claude-sonnet-4.6</code>. The selected model must support structured outputs.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="status-message" role="status">{message}</p>}
    </div>
  </section>;
}
