// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { morph } from "./morph";

type Start = (update: () => Promise<void>) => void;

/** Gives the document a `startViewTransition` that keeps each update for the test to run. */
function withViewTransitions() {
  const updates: (() => Promise<void>)[] = [];
  const start = vi.fn<Start>((update) => {
    updates.push(update);
  });
  Object.defineProperty(document, "startViewTransition", { value: start, configurable: true });
  return { start, updates };
}

/** Has the User ask for reduced motion, or not. */
function reducedMotion(reduce: boolean) {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const list = real(query);
    Object.defineProperty(list, "matches", {
      value: reduce && query === "(prefers-reduced-motion: reduce)",
    });
    return list;
  });
}

/** Whether `promise` has settled after a few frames. */
async function settledSoon(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  return settled;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "startViewTransition");
  document.body.innerHTML = "";
});

describe("morph", () => {
  test("without View Transitions, makes the change at once", () => {
    reducedMotion(false);
    const update = vi.fn();

    morph(update);

    expect(update).toHaveBeenCalledTimes(1);
  });

  test("with reduced motion, makes the change at once, with no View Transition", () => {
    reducedMotion(true);
    const { start } = withViewTransitions();
    const update = vi.fn();

    morph(update);

    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  test("otherwise makes the change in a View Transition", async () => {
    reducedMotion(false);
    const { start, updates } = withViewTransitions();
    const update = vi.fn();

    morph(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    await updates[0]?.();
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("takes the new frame once the editor has mounted its sides", async () => {
    reducedMotion(false);
    const { updates } = withViewTransitions();
    const editor = document.createElement("section");
    editor.setAttribute("data-study-editor", "");

    morph(() => document.body.append(editor));
    const frame = updates[0]?.() ?? Promise.reject(new Error("no transition"));

    expect(await settledSoon(frame)).toBe(false);
    const side = document.createElement("div");
    side.className = "cm-content";
    editor.append(side);
    expect(await settledSoon(frame)).toBe(true);
  });

  test("takes the new frame after a second at most, if the editor never mounts its sides", async () => {
    reducedMotion(false);
    const { updates } = withViewTransitions();
    const editor = document.createElement("section");
    editor.setAttribute("data-study-editor", "");

    morph(() => document.body.append(editor));
    const began = performance.now();
    await updates[0]?.();

    expect(performance.now() - began).toBeGreaterThanOrEqual(950);
    expect(performance.now() - began).toBeLessThan(1500);
  });
});
