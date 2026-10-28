import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Grid2x2X,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Variant e, "Icon bar": the table's ⋯ menu is one bar of icons with no
// words that takes the toolbar pill's place on the side's top edge while it
// is open, its groups (row, column, align, table) split by hairlines. On desktop each
// icon names itself in a tooltip; on a phone the bar docks at the bottom.

const svg = (icon: LucideIcon) =>
  renderToStaticMarkup(createElement(icon, { "aria-hidden": true, size: 18, strokeWidth: 2 }));

// Lucide has no "delete row" or "delete column": a row or column bar with a cross beside it.
const own = (body: string) =>
  `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  rowAbove: svg(BetweenHorizontalStart),
  rowBelow: svg(BetweenHorizontalEnd),
  colLeft: svg(BetweenVerticalStart),
  colRight: svg(BetweenVerticalEnd),
  up: svg(ArrowUp),
  down: svg(ArrowDown),
  left: svg(ArrowLeft),
  right: svg(ArrowRight),
  alignLeft: svg(AlignLeft),
  alignCenter: svg(AlignCenter),
  alignRight: svg(AlignRight),
  deleteRow: own('<rect x="3" y="3" width="18" height="7" rx="1"/><path d="m9 14 6 6"/><path d="m15 14-6 6"/>'),
  deleteColumn: own('<rect x="3" y="3" width="7" height="18" rx="1"/><path d="m14 9 6 6"/><path d="m20 9-6 6"/>'),
  deleteTable: svg(Grid2x2X),
};

export type MenuItem = {
  label: string;
  icon: keyof typeof ICONS;
  run: (r: number, c: number) => void;
  disabled?: (r: number, c: number) => boolean;
};

export type MenuGroup = { name: string; items: MenuItem[] };

/** Builds the menu: a horizontal `role="menu"` bar whose arrow keys walk it. */
export function renderMenu(
  groups: MenuGroup[],
  { r, c }: { r: number; c: number },
  on: { run: (item: MenuItem) => void; close: (refocus: boolean) => void },
) {
  const menu = document.createElement("div");
  menu.className = "cm-lp-table-menu cm-lp-icon-bar";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Table options");
  menu.setAttribute("aria-orientation", "horizontal");
  const buttons: HTMLButtonElement[] = [];
  for (const group of groups) {
    const part = document.createElement("div");
    part.setAttribute("role", "group");
    part.setAttribute("aria-label", group.name);
    part.className = "cm-lp-icon-bar-group";
    part.dataset.group = group.name.toLowerCase();
    for (const item of group.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", item.label);
      button.dataset.tip = item.label;
      button.className = "cm-lp-icon-bar-item";
      if (item.label.startsWith("Delete")) button.classList.add("cm-lp-danger");
      button.innerHTML = ICONS[item.icon];
      const disabled = item.disabled?.(r, c) ?? false;
      if (disabled) button.setAttribute("aria-disabled", "true");
      button.tabIndex = -1;
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        if (!disabled) on.run(item);
      });
      buttons.push(button);
      part.append(button);
    }
    menu.append(part);
  }
  menu.addEventListener("keydown", (event) => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? buttons[0] : buttons.at(-1))?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      on.close(true);
    } else if (event.key === "Tab") on.close(false);
  });
  return { menu, buttons };
}
