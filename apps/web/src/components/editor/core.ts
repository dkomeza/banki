import { type AutoClose, DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { type Extension, Facet, type StateField } from "@codemirror/state";
import { type DecorationSet, EditorView, type KeyBinding, tooltips } from "@codemirror/view";
import { FORMATTING } from "./formatting";
import { cardLanguage, trackFocus } from "./language";
import { latexCompletion } from "./latex-complete";
import { clickToEditFormula, inlinePopover } from "./popover";

// What every live-preview editor has, a side's and each of its table's cells:
// the Card's language, the reveal rule, the inline Formula's popover, LaTeX
// autocomplete, the formatting shortcuts, and the editor's settings for the
// grid to read.

/** The auto-close choice the editor follows. */
export const autoCloseChoice = Facet.define<AutoClose, AutoClose>({
  combine: (choices) => choices[0] ?? DEFAULT_AUTO_CLOSE,
});

/** What Ctrl/Cmd+Enter does: submits whatever the editor is in. */
export const submitAction = Facet.define<() => void, () => void>({
  combine: (actions) => actions[0] ?? (() => {}),
});

/** Ctrl/Cmd+B, I, E and M: bold, italic, inline code and an inline Formula. */
export const formattingKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: FORMATTING.bold },
  { key: "Mod-i", run: FORMATTING.italic },
  { key: "Mod-e", run: FORMATTING.code },
  { key: "Mod-m", run: FORMATTING.formula },
];

/** The live preview, drawn by `decorations` (livePreviewDecorations). */
export function previewCore(decorations: StateField<DecorationSet>): Extension {
  return [
    cardLanguage,
    trackFocus,
    decorations,
    inlinePopover,
    clickToEditFormula,
    latexCompletion(),
    // On the page, so a popover isn't cut off by a scrolling table or card.
    tooltips({ position: "absolute", parent: document.body }),
    EditorView.contentAttributes.of({ spellcheck: "true" }),
  ];
}
