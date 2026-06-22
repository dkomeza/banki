"use client";

const examples = [
  { label: "Inline", code: "\\(x + y\\)", template: "\\({selection}{cursor}\\)" },
  { label: "Display", code: "\\[x + y\\]", template: "\\[{selection}{cursor}\\]" },
  { label: "Fraction", code: "\\frac{a}{b}", template: "\\frac{{selection}{cursor}}{}" },
  { label: "Root", code: "\\sqrt{x}", template: "\\sqrt{{selection}{cursor}}" },
  { label: "Power", code: "x^{n}", template: "{selection}^{{cursor}}" },
  { label: "Subscript", code: "x_{i}", template: "{selection}_{{cursor}}" },
  { label: "Sum", code: "\\sum_{i=1}^{n}", template: "\\sum_{{selection}{cursor}}^{}" },
  { label: "Integral", code: "\\int_{a}^{b}", template: "\\int_{{selection}{cursor}}^{}" },
  { label: "Greek", code: "\\alpha \\beta \\pi \\theta", template: "\\alpha{selection}{cursor}" },
  { label: "Matrix", code: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", template: "\\begin{bmatrix} {selection}{cursor} &  \\\\  &  \\end{bmatrix}" },
];

export function MathCheatsheet({ onInsert }: { onInsert: (template: string) => void }) {
  return (
    <details className="math-cheatsheet">
      <summary>Math cheatsheet <span>LaTeX</span></summary>
      <div className="math-cheatsheet-body">
        <p>Wrap notation in <code>\(...\)</code> for inline math or <code>\[...\]</code> for its own line. Select text first to wrap it.</p>
        <div className="math-cheatsheet-grid">
          {examples.map((example) => (
            <button key={example.label} type="button" onClick={() => onInsert(example.template)} title={`Insert ${example.label.toLowerCase()}`}>
              <span>{example.label}</span><code>{example.code}</code>
            </button>
          ))}
        </div>
        <p className="math-cheatsheet-note">Useful operators: <code>\times</code> <code>\div</code> <code>\pm</code> <code>\le</code> <code>\ge</code> <code>\ne</code> <code>\approx</code> <code>\infty</code></p>
      </div>
    </details>
  );
}
