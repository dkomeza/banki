import type { LucideIcon } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Lucide icons for what the editor draws outside React: its widgets and the
// table's menu. Drawn as static markup, which works wherever a widget is made,
// even while React is committing (a root's flushSync doesn't flush there).

const svgs = new Map<LucideIcon, string>();

/** An icon's SVG markup, drawn once and kept. */
export function svgOf(icon: LucideIcon): string {
  let svg = svgs.get(icon);
  if (svg === undefined) {
    svg = renderToStaticMarkup(
      createElement(icon, { "aria-hidden": true, size: 18, strokeWidth: 2 }),
    );
    svgs.set(icon, svg);
  }
  return svg;
}

/** A span holding an icon, hidden from assistive tech. */
export function iconElement(icon: LucideIcon, className: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = svgOf(icon);
  return el;
}
