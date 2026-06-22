"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeMathMarkup } from "@/lib/math";

declare global {
  interface Window {
    MathJax?: {
      typesetClear?: (nodes: HTMLElement[]) => void;
      typesetPromise?: (nodes: HTMLElement[]) => Promise<void>;
    };
  }
}

let typesetQueue = Promise.resolve();

export function MathRenderer({ html, className = "" }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const normalizedHtml = useMemo(() => normalizeMathMarkup(html), [html]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const node = ref.current;
      if (!node || !window.MathJax?.typesetPromise) return;
      try {
        typesetQueue = typesetQueue.catch(() => undefined).then(async () => {
          if (cancelled || ref.current !== node || !window.MathJax?.typesetPromise) return;
          window.MathJax.typesetClear?.([node]);
          await window.MathJax.typesetPromise([node]);
        });
        await typesetQueue;
        if (!cancelled) setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    const loadError = () => { if (!cancelled) setError(true); };
    void render();
    window.addEventListener("banki:mathjax-ready", render);
    window.addEventListener("banki:mathjax-error", loadError);
    return () => {
      cancelled = true;
      window.removeEventListener("banki:mathjax-ready", render);
      window.removeEventListener("banki:mathjax-error", loadError);
    };
  }, [normalizedHtml]);

  return (
    <div className={className}>
      <div ref={ref} className="card-content" dangerouslySetInnerHTML={{ __html: normalizedHtml }} />
      {error && <p className="math-warning" role="status">This equation could not be typeset. Its original source remains visible.</p>}
    </div>
  );
}
