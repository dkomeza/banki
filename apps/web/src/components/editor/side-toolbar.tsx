import type { EditorView } from "@codemirror/view";
import { Fragment, type RefObject } from "react";
import { MOD, runTool, TOOLS } from "./toolbar";

// Variant a, "Ruled": the toolbar is a quiet row of ink icons on the line
// under the side being written, there only while it has the focus. On a
// phone it docks above the keyboard instead, a bar of 44 px buttons.

export function SideToolbar({
  view,
  label,
}: {
  view: RefObject<EditorView | null>;
  label: string;
}) {
  return (
    <div role="toolbar" aria-label={`${label} formatting`} className="side-toolbar">
      <div className="side-toolbar-inner">
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
                <Icon aria-hidden className="size-[1.05rem]" strokeWidth={2} />
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
