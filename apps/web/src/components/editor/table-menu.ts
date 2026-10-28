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
  Trash2,
} from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Variant d, "Icon grid": the table's ⋯ menu is a small grid of icons, one
// row per thing it acts on (Row, Column, Align, Table), each named once in
// the margin's small caps. On desktop each icon names itself in a tooltip.

const ICONS = {
  rowAbove: BetweenHorizontalStart,
  rowBelow: BetweenHorizontalEnd,
  colLeft: BetweenVerticalStart,
  colRight: BetweenVerticalEnd,
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
  alignLeft: AlignLeft,
  alignCenter: AlignCenter,
  alignRight: AlignRight,
  deleteRow: Trash2,
  deleteColumn: Trash2,
  deleteTable: Grid2x2X,
} satisfies Record<string, LucideIcon>;

export type MenuItem = {
  label: string;
  icon: keyof typeof ICONS;
  run: (r: number, c: number) => void;
  disabled?: (r: number, c: number) => boolean;
};

export type MenuGroup = { name: string; items: MenuItem[] };

const svg = (icon: LucideIcon) =>
  renderToStaticMarkup(createElement(icon, { "aria-hidden": true, size: 18, strokeWidth: 2 }));

/** Builds the menu: a `role="menu"` grid whose arrow keys move in two dimensions. */
export function renderMenu(
  groups: MenuGroup[],
  { r, c }: { r: number; c: number },
  on: { run: (item: MenuItem) => void; close: (refocus: boolean) => void },
) {
  const menu = document.createElement("div");
  menu.className = "cm-lp-table-menu cm-lp-icon-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Table options");
  const grid: HTMLButtonElement[][] = [];
  for (const group of groups) {
    const row = document.createElement("div");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", group.name);
    row.className = "cm-lp-icon-menu-row";
    if (group.name === "Table") row.classList.add("cm-lp-icon-menu-row-end");
    const name = document.createElement("span");
    name.className = "cm-lp-icon-menu-name";
    name.setAttribute("aria-hidden", "true");
    name.textContent = group.name;
    row.append(name);
    const buttons: HTMLButtonElement[] = [];
    for (const item of group.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", item.label);
      button.dataset.tip = item.label;
      button.className = "cm-lp-icon-menu-item";
      if (item.label.startsWith("Delete")) button.classList.add("cm-lp-danger");
      button.innerHTML = svg(ICONS[item.icon]);
      const disabled = item.disabled?.(r, c) ?? false;
      if (disabled) button.setAttribute("aria-disabled", "true");
      button.tabIndex = -1;
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        if (!disabled) on.run(item);
      });
      buttons.push(button);
      row.append(button);
    }
    grid.push(buttons);
    menu.append(row);
  }
  const flat = grid.flat();
  menu.addEventListener("keydown", (event) => {
    const at = document.activeElement as HTMLButtonElement;
    const gr = grid.findIndex((row) => row.includes(at));
    const gc = gr === -1 ? -1 : grid[gr]!.indexOf(at);
    const focus = (row: number, col: number) => {
      const target = grid[(row + grid.length) % grid.length]!;
      target[Math.min(col, target.length - 1)]?.focus();
    };
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = (flat.indexOf(at) + (event.key === "ArrowRight" ? 1 : -1) + flat.length) % flat.length;
      flat[next]?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focus(gr + (event.key === "ArrowDown" ? 1 : -1), Math.max(gc, 0));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? flat[0] : flat.at(-1))?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      on.close(true);
    } else if (event.key === "Tab") on.close(false);
  });
  return { menu, buttons: flat };
}
