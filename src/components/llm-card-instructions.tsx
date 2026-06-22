"use client";

import { useState } from "react";

const prompt = `Generate a Banki study-card import as one valid JSON object.

Return only JSON. Do not use a Markdown code fence or add commentary.

Use this exact structure:
{
  "version": 1,
  "deck": {
    "name": "Deck name",
    "description": "Optional description"
  },
  "cards": [
    {
      "front": "One focused recall prompt",
      "back": "A concise, self-contained answer",
      "tags": ["optional", "short-tags"]
    }
  ]
}

Rules:
- Use exactly the top-level keys version, deck, and cards.
- Set version to the number 1.
- deck.name is required; deck.description is optional.
- Every card requires non-empty front and back strings. tags is optional.
- Do not add fields not shown above.
- Use double quotes, no trailing commas, and valid JSON escaping.
- For inline LaTeX use \\(...\\); for display LaTeX use \\[...\\]. Escape every LaTeX backslash as \\\\ in the JSON file.
- Safe basic HTML is allowed, but prefer plain text when formatting adds no value.
- Make every card self-contained and test one recall target.
- Keep answers concise and avoid duplicate or near-duplicate cards.
- Limits: 1-10,000 cards, 40 tags per card, 50 characters per tag.

Save the result as a UTF-8 file ending in .banki.json.`;

export function LlmCardInstructions() {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return <section className="llm-card-instructions panel" aria-labelledby="card-prompt-title">
    <div className="instruction-copy">
      <p className="eyebrow">Card generation</p>
      <h2 id="card-prompt-title">Prompt an LLM, import the result.</h2>
      <p>Copy these instructions into any LLM, add your source material and learning goals, then import the generated <code>.banki.json</code> file from the dashboard.</p>
      <button className="button secondary" onClick={() => void copyPrompt()}>{copied ? "Instructions copied" : "Copy LLM instructions"}</button>
      <span className="instruction-status" role="status" aria-live="polite">{copied ? "Ready to paste into an LLM." : "Version 1 · JSON · up to 10,000 cards"}</span>
    </div>
    <div className="prompt-sheet">
      <div className="prompt-sheet-header"><span>banki-card-prompt.txt</span><span>UTF-8</span></div>
      <pre tabIndex={0}>{prompt}</pre>
    </div>
  </section>;
}
