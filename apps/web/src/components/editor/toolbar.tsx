import type { EditorView } from "@codemirror/view";
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
import { formatting } from "./live-preview";

/** The toolbar's buttons, in order, with the group each starts. */
export const TOOLS: readonly {
  key: keyof typeof formatting;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  group: "text" | "list" | "code" | "math" | "table";
}[] = [
  { key: "bold", label: "Bold", icon: Bold, shortcut: "B", group: "text" },
  { key: "italic", label: "Italic", icon: Italic, shortcut: "I", group: "text" },
  { key: "bulleted", label: "Bulleted list", icon: List, group: "list" },
  { key: "numbered", label: "Numbered list", icon: ListOrdered, group: "list" },
  { key: "code", label: "Inline code", icon: Code, shortcut: "E", group: "code" },
  { key: "codeBlock", label: "Code block", icon: SquareCode, group: "code" },
  { key: "formula", label: "Inline formula", icon: Radical, shortcut: "M", group: "math" },
  { key: "displayFormula", label: "Display formula", icon: SquareSigma, group: "math" },
  { key: "table", label: "Table", icon: Table2, group: "table" },
];

export const MOD =
  typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Runs a tool on the side's editor, keeping the focus in it. */
export function runTool(view: EditorView | null, key: keyof typeof formatting) {
  if (!view || view.state.readOnly) return;
  formatting[key](view);
}
