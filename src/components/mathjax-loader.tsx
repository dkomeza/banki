"use client";

import { useEffect } from "react";

export function MathJaxLoader() {
  useEffect(() => {
    const globalWindow = window as Window & { MathJax?: Record<string, unknown> };
    if (window.MathJax?.typesetPromise) {
      window.dispatchEvent(new Event("banki:mathjax-ready"));
      return;
    }
    globalWindow.MathJax = {
      tex: {
        inlineMath: [["\\(", "\\)"]],
        displayMath: [["\\[", "\\]"]],
        packages: { "[+]": ["mhchem"] },
        processEscapes: true,
      },
      loader: { load: ["[tex]/mhchem"] },
      options: { enableMenu: false },
      startup: { typeset: false },
    };
    const script = document.createElement("script");
    script.src = "/mathjax/tex-mml-chtml.js";
    script.async = true;
    script.dataset.bankiMathjax = "true";
    script.onload = () => window.dispatchEvent(new Event("banki:mathjax-ready"));
    script.onerror = () => window.dispatchEvent(new Event("banki:mathjax-error"));
    document.head.appendChild(script);
  }, []);
  return null;
}
