export type MathJaxRuntime = {
  startup?: { promise?: PromiseLike<unknown>; typeset?: boolean };
  typesetPromise?: (nodes?: HTMLElement[]) => Promise<unknown>;
};

export async function waitForMathJaxStartup(mathJax: MathJaxRuntime | undefined) {
  await mathJax?.startup?.promise;
  if (!mathJax?.typesetPromise) throw new Error("MathJax finished loading without a typesetting API.");
}
