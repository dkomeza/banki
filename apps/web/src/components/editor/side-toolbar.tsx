import type { EditorView } from "@codemirror/view";
import { Fragment, type RefObject } from "react";
import { MOD, runTool, TOOLS } from "./toolbar";

// Variant c, "Floating": the toolbar floats as a small pill on the top edge
// of the side being written, at its right, out of the text's way. On a phone
// it docks above the keyboard as one ink bar.

export function SideToolbar({
  view,
  label,
}: {
  view: RefObject<EditorView | null>;
  label: string;
}) {
  return (
    <div role="toolbar" aria-label={`${label} formatting`} className="side-toolbar">
      {TOOLS.map((tool, i) => {
        const Icon = tool.icon;
        const first = i > 0 && TOOLS[i - 1]?.group !== tool.group;
        return (
          <Fragment key={tool.key}>
            {first && <span aria-hidden className="side-toolbar-sep" />}
            <button
              type="button"
              aria-label={tool.label}
              title={tool.shortcut ? `${tool.label} (${MOD}${tool.shortcut})` : tool.label}
              className="side-toolbar-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runTool(view.current, tool.key)}
            >
              <Icon aria-hidden className="size-4" strokeWidth={2.1} />
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
