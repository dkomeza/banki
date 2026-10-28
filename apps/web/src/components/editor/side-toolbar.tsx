import type { EditorView } from "@codemirror/view";
import type { RefObject } from "react";
import { MOD, runTool, TOOLS } from "./toolbar";

// Variant b, "Ink strip": each side carries its toolbar on top of its first
// ruled line, always there, faded until the side has the focus: groups of
// buttons in muted pills. On a phone it sticks to the top of the screen
// while the side is being written, so the keyboard never covers it.

const GROUPS = ["text", "list", "code", "math", "table"] as const;

export function SideToolbar({
  view,
  label,
}: {
  view: RefObject<EditorView | null>;
  label: string;
}) {
  return (
    <div role="toolbar" aria-label={`${label} formatting`} className="side-toolbar">
      {GROUPS.map((group) => (
        <div key={group} className="side-toolbar-group">
          {TOOLS.filter((tool) => tool.group === group).map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.key}
                type="button"
                aria-label={tool.label}
                title={tool.shortcut ? `${tool.label} (${MOD}${tool.shortcut})` : tool.label}
                className="side-toolbar-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runTool(view.current, tool.key)}
              >
                <Icon aria-hidden className="size-4" strokeWidth={2.1} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
