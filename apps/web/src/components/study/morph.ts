import { flushSync } from "react-dom";

// Opening and closing the study screen's editor ("Morph"): each is a View
// Transition, so what the change moves (the Card's Front, rule and Back; the
// panel; the dock) travels between the two screens. index.css gives each its
// way in and out by its `view-transition-name`.

/** The longest the new frame waits for the editor to mount. */
const SETTLE_MS = 1000;

/** Whether the editor, if it is on the page, has mounted its sides yet (they mount a beat late). */
const editorSettled = () => {
  const editor = document.querySelector("[data-study-editor]");
  return editor === null || editor.querySelector(".cm-content") !== null;
};

/**
 * Runs `update` as a View Transition, its new frame taken once the editor
 * has mounted, or after a second at most; at once where the browser has no
 * View Transitions, or the User asks for reduced motion.
 */
export function morph(update: () => void) {
  if (
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  document.startViewTransition(async () => {
    flushSync(update);
    const until = performance.now() + SETTLE_MS;
    while (!editorSettled() && performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  });
}
