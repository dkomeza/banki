// Prototype only (BAN-21): the `?state=` a Variant's page was opened with,
// and the sample sides each state is shown on.

export const protoState: string | null =
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state");

const QUOTIENT = {
  front: "Differentiate $\\dfrac{f(x)}{g(x)}$ by the quotient rule.",
  back: "Bottom times the derivative of the top, minus top times the derivative of the bottom, over the bottom squared:\n$$\n\\frac{f'(x)\\,g(x) - f(x)\\,g'(x)}{g(x)^2}\n$$",
};

const SAMPLES: Record<string, { front: string; back: string }> = {
  completing: {
    front: "Differentiate $h(x) = \\fr$ by the quotient rule.",
    back: QUOTIENT.back,
  },
  "completing-cell": {
    front: "Fill in the derivatives.",
    back: "| $f(x)$ | $f'(x)$ |\n| --- | --- |\n| $x^n$ | $n x^{n-1}$ |\n| $\\ln x$ | $\\fr$ |\n| $e^{x}$ | $e^{x}$ |",
  },
  slots: {
    front: "Differentiate $h(x) = \\fr$ by the quotient rule.",
    back: QUOTIENT.back,
  },
  cheatsheet: QUOTIENT,
  "cheatsheet-search": QUOTIENT,
  "cheatsheet-empty": QUOTIENT,
};

/** The cheatsheet's query each cheatsheet state opens it with. */
export const PROTO_QUERIES: Record<string, string> = {
  cheatsheet: "",
  "cheatsheet-search": "integral",
  "cheatsheet-empty": "qwerty",
};

/** The sides to show for the state, or `sides` as they are. */
export function protoSides(sides: { front: string; back: string }) {
  return (protoState !== null && SAMPLES[protoState]) || sides;
}
