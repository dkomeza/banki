"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    MathJax?: {
      typesetClear?: (nodes: HTMLElement[]) => void;
      typesetPromise?: (nodes: HTMLElement[]) => Promise<void>;
    };
  }
}

export function MathRenderer({ html, className = "" }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!ref.current || !window.MathJax?.typesetPromise) return;
      try {
        window.MathJax.typesetClear?.([ref.current]);
        await window.MathJax.typesetPromise([ref.current]);
        if (!cancelled) setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void render();
    window.addEventListener("banki:mathjax-ready", render);
    return () => { cancelled = true; window.removeEventListener("banki:mathjax-ready", render); };
  }, [html]);

  return (
    <div className={className}>
      <div ref={ref} className="card-content" dangerouslySetInnerHTML={{ __html: html }} />
      {error && <p className="math-warning" role="status">This equation could not be typeset. Its original source remains visible.</p>}
    </div>
  );
}
