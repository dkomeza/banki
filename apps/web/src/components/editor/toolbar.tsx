import {
  Bold,
  Code,
  Italic,
  List,
  ListOrdered,
  type LucideIcon,
  Radical,
  SquareCode,
  SquareSigma,
  Table2,
} from "lucide-react";
import { Fragment, type KeyboardEvent, useRef } from "react";
import type { Format } from "./formatting";

// The formatting toolbar: a pill on the top edge of the editor being written
// (on a phone, an ink bar docked above the keyboard). One Tab stop; the arrow
// keys move along it.

const TOOLS: readonly {
  format: Format;
  label: string;
  icon: LucideIcon;
  /** The letter of its Ctrl/Cmd shortcut. */
  key?: string;
  group: "text" | "list" | "code" | "math" | "table";
}[] = [
  { format: "bold", label: "Bold", icon: Bold, key: "B", group: "text" },
  { format: "italic", label: "Italic", icon: Italic, key: "I", group: "text" },
  { format: "bulletedList", label: "Bulleted list", icon: List, group: "list" },
  { format: "numberedList", label: "Numbered list", icon: ListOrdered, group: "list" },
  { format: "code", label: "Inline code", icon: Code, key: "E", group: "code" },
  { format: "codeBlock", label: "Code block", icon: SquareCode, group: "code" },
  { format: "formula", label: "Inline formula", icon: Radical, key: "M", group: "math" },
  { format: "displayFormula", label: "Display formula", icon: SquareSigma, group: "math" },
  { format: "table", label: "Table", icon: Table2, group: "table" },
];

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function EditorToolbar({
  label,
  disabled,
  onFormat,
}: {
  /** Names the toolbar, such as "Front formatting". */
  label: string;
  disabled: boolean;
  onFormat: (format: Format) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const buttons = () => [...(bar.current?.querySelectorAll("button") ?? [])];
  const onKeyDown = (event: KeyboardEvent) => {
    const all = buttons();
    const at = all.findIndex((button) => button === document.activeElement);
    let next: number;
    if (event.key === "ArrowRight") next = (at + 1) % all.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + all.length) % all.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    else return;
    event.preventDefault();
    for (const [i, button] of all.entries()) button.tabIndex = i === next ? 0 : -1;
    all[next]?.focus();
  };
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className="editor-toolbar"
      onKeyDown={onKeyDown}
    >
      {TOOLS.map((tool, i) => {
        const Icon = tool.icon;
        const startsGroup = i > 0 && TOOLS[i - 1]?.group !== tool.group;
        return (
          <Fragment key={tool.format}>
            {startsGroup && <span aria-hidden className="editor-toolbar-separator" />}
            <button
              type="button"
              tabIndex={i === 0 ? 0 : -1}
              aria-label={tool.label}
              aria-keyshortcuts={
                tool.key === undefined ? undefined : `Control+${tool.key} Meta+${tool.key}`
              }
              title={tool.key === undefined ? tool.label : `${tool.label} (${MOD}${tool.key})`}
              disabled={disabled}
              className="editor-toolbar-button"
              // Keeps the focus, and the cursor, in the editor.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFormat(tool.format)}
            >
              <Icon aria-hidden className="size-4" strokeWidth={2.1} />
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
