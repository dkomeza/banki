// Variant-only: `?state=<name>` puts sample sides in the form and the cursor
// where the state needs it, so every state of the BAN-19 prototype is a link.

export type ProtoState =
  | "inline-editing"
  | "display-editing"
  | "broken"
  | "table"
  | "table-menu"
  | "toolbar";

/** Where the cursor goes: `¦` in a sample side marks it. */
const CURSOR = "¦";

const TABLE = [
  "| Function    | Derivative     |",
  "| ----------- | -------------- |",
  "| $x^n$       | $n x^{n-1}$    |",
  "| $\\ln x$     | $\\frac{1}{x}$  |",
  "| $e^{ax}$    | $a e^{ax}$     |",
  "| **chain rule** | $f'(g(x))\\,g'(x)$ |",
].join("\n");

const SAMPLES: Record<ProtoState, { front: string; back: string }> = {
  "inline-editing": {
    front: "Derive the Maclaurin series of $\\ln(1+x¦)$.\nFor which $x$ does it converge?",
    back: "Start from the geometric series and integrate term by term from $0$ to $x$.\nIt converges for $-1 < x \\le 1$.",
  },
  "display-editing": {
    front: "Derive the Maclaurin series of $\\ln(1+x)$.",
    back: [
      "Start from the geometric series:",
      "$$",
      "\\frac{1}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n t^n¦",
      "$$",
      "Integrate both sides from $0$ to $x$:",
      "$$\\ln(1+x) = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\cdots$$",
    ].join("\n"),
  },
  broken: {
    front: "The derivative of $\\fracc{1}{x}$",
    back: "$-\\frac{1}{x^2¦$, for $x \\ne 0$\nSo the slope is **always negative**.",
  },
  table: {
    front: "Derivatives to know by heart",
    back: `Each row is one rule; the last one is for compositions.\n${TABLE}\n\nAll hold on the domain of the function.`,
  },
  "table-menu": {
    front: "Derivatives to know by heart",
    back: `Each row is one rule; the last one is for compositions.\n${TABLE}\n\nAll hold on the domain of the function.`,
  },
  toolbar: {
    front: "Integrate $\\int x e^x \\, dx$ by parts.",
    back: [
      "Take $u = x$ and $dv = e^x\\,dx$:",
      "$$\\int x e^x\\,dx = x e^x - \\int e^x\\,dx = (x - 1)e^x + C$$",
      "- *LIATE* picks $u$",
      "- check by differentiating¦",
    ].join("\n"),
  },
};

function read(): ProtoState | null {
  if (typeof window === "undefined") return null;
  const name = new URLSearchParams(window.location.search).get("state");
  return name !== null && name in SAMPLES ? (name as ProtoState) : null;
}

/** The state the page was opened in, read once. */
export const protoState: ProtoState | null = read();

/** Focus a state asks for that only the table grid can take. */
export const protoFocus: {
  table?: { r: number; c: number; offset?: number; menu?: boolean; claimed?: boolean };
} = {};

if (protoState === "table") protoFocus.table = { r: 2, c: 1, offset: 6 };
if (protoState === "table-menu") protoFocus.table = { r: 1, c: 1, menu: true };

/** The sides the state starts with, and which side has the cursor where. */
export function protoSides():
  | { sides: { front: string; back: string }; side?: "front" | "back"; cursor?: number }
  | null {
  if (protoState === null) return null;
  const sample = SAMPLES[protoState];
  let side: "front" | "back" | undefined;
  let cursor: number | undefined;
  const clean = (key: "front" | "back") => {
    const at = sample[key].indexOf(CURSOR);
    if (at === -1) return sample[key];
    side = key;
    cursor = at;
    return sample[key].replace(CURSOR, "");
  };
  return { sides: { front: clean("front"), back: clean("back") }, side, cursor };
}
