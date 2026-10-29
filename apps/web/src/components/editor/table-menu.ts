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
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

// The table's ⋯ menu: a small grid of icons, one row per thing it acts on
// (Row, Column, Align, Table), each named once in the margin's small caps,
// with every delete in red at its row's end. On desktop each icon names
// itself in a tooltip; every item is named for assistive tech.

export const MENU_ICONS = {
  rowAbove: BetweenHorizontalStart,
  rowBelow: BetweenHorizontalEnd,
  rowUp: ArrowUp,
  rowDown: ArrowDown,
  columnLeft: BetweenVerticalStart,
  columnRight: BetweenVerticalEnd,
  columnBack: ArrowLeft,
  columnOn: ArrowRight,
  alignLeft: AlignLeft,
  alignCenter: AlignCenter,
  alignRight: AlignRight,
  delete: Trash2,
  deleteTable: Grid2x2X,
} satisfies Record<string, LucideIcon>;

export type MenuItem = {
  label: string;
  icon: keyof typeof MENU_ICONS;
  /** Deletes something: shown in red. */
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
};

export type MenuGroup = { name: string; items: readonly MenuItem[] };

const svgs = new Map<LucideIcon, string>();

/** An icon's SVG markup, drawn once by React and kept. */
function svgOf(icon: LucideIcon): string {
  const cached = svgs.get(icon);
  if (cached !== undefined) return cached;
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() =>
    root.render(createElement(icon, { "aria-hidden": true, size: 18, strokeWidth: 2 })),
  );
  const svg = host.innerHTML;
  root.unmount();
  svgs.set(icon, svg);
  return svg;
}

let menus = 0;

/**
 * The menu's element, `role="menu"`, with its items in rows. Arrow keys move
 * through the items, left and right along all of them, up and down between
 * rows; Home and End go to the first and last; Enter or Space runs one;
 * Escape closes it, back to its button; Tab closes it and moves on from there.
 */
export function renderMenu(
  groups: readonly MenuGroup[],
  on: { run: (item: MenuItem) => void; close: (refocus: boolean) => void },
): { menu: HTMLElement; items: HTMLButtonElement[] } {
  const menu = document.createElement("div");
  menu.id = `cm-lp-table-menu-${++menus}`;
  menu.className = "cm-lp-table-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Table");
  const rows: HTMLButtonElement[][] = [];
  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "cm-lp-table-menu-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", group.name);
    const name = document.createElement("span");
    name.className = "cm-lp-table-menu-name";
    name.setAttribute("aria-hidden", "true");
    name.textContent = group.name;
    row.append(name);
    const buttons = group.items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.className = "cm-lp-table-menu-item";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", item.label);
      button.dataset.tip = item.label;
      if (item.danger === true) button.classList.add("cm-lp-danger");
      if (item.disabled === true) button.setAttribute("aria-disabled", "true");
      button.innerHTML = svgOf(MENU_ICONS[item.icon]);
      // Keeps the focus where it is until the item runs.
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (item.disabled !== true) on.run(item);
      });
      return button;
    });
    row.append(...buttons);
    rows.push(buttons);
    menu.append(row);
  }
  const items = rows.flat();
  menu.addEventListener("keydown", (event) => {
    const at = document.activeElement;
    const index = items.findIndex((item) => item === at);
    const row = rows.findIndex((buttons) => buttons.some((button) => button === at));
    const column = row === -1 ? 0 : (rows[row]?.findIndex((button) => button === at) ?? 0);
    const focusRow = (r: number) => {
      const buttons = rows[(r + rows.length) % rows.length] ?? [];
      buttons[Math.min(column, buttons.length - 1)]?.focus();
    };
    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        const step = event.key === "ArrowRight" ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
        break;
      }
      case "ArrowDown":
        focusRow(row + 1);
        break;
      case "ArrowUp":
        focusRow(row - 1);
        break;
      case "Home":
        items[0]?.focus();
        break;
      case "End":
        items.at(-1)?.focus();
        break;
      case "Escape":
        on.close(true);
        break;
      case "Tab":
        // Back on its button, from where Tab moves on.
        on.close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
  });
  return { menu, items };
}
