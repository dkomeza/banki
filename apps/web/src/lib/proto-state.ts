import { SEED_IMAGE_REFERENCE } from "./proto-sample";

// Prototype only (BAN-20): the `?state=` a Variant's page was opened with,
// and the sample sides each state is shown on.

export const protoState: string | null =
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state");

const PICTURE = `![](${SEED_IMAGE_REFERENCE})`;
const MISSING = "![](images/00000000-0000-4000-8000-0000000000ff.png)";

const SAMPLES: Record<string, { front: string; back: string }> = {
  picture: {
    front: "Sketch $y = \\ln(1+x)$ near $x = 0$.",
    back: `Near the origin it looks like $y = x$:\n${PICTURE}\nIt is concave everywhere, and goes through $(1, \\ln 2)$.\nIt is defined for $x > -1$.`,
  },
  source: {
    front: "Sketch $y = \\ln(1+x)$ near $x = 0$.",
    back: `Near the origin it looks like $y = x$:\n${PICTURE}\nIt is concave everywhere, and goes through $(1, \\ln 2)$.`,
  },
  uploading: {
    front: "Label the parts of the cell.",
    back: "The nucleus holds the DNA.\nThe mitochondria make ATP.\nThe membrane lets some things through.",
  },
  failed: {
    front: "Sketch $y = \\ln(1+x)$ near $x = 0$.",
    back: `${PICTURE}\nIt passes through the origin with slope $1$.`,
  },
  missing: {
    front: "Sketch $y = \\ln(1+x)$ near $x = 0$.",
    back: `Near the origin it looks like $y = x$:\n${MISSING}\nIt is concave everywhere.`,
  },
  dragging: {
    front: "Sketch $y = \\ln(1+x)$ near $x = 0$.",
    back: "It passes through the origin with slope $1$.\nIt is concave everywhere, and goes through $(1, \\ln 2)$.\nIt is defined for $x > -1$.",
  },
  table: {
    front: "Match each graph to its function.",
    back: `| Function | Graph |\n| --- | --- |\n| $\\ln(1+x)$ | ${PICTURE} |\n| $e^x$ | grows fast |\n\nBoth pass through the origin's neighbourhood.`,
  },
  toolbar: {
    front: "Sketch $y = \\ln(1+x)$ near $x = 0$.",
    back: "It passes through the origin with slope $1$.",
  },
};

/** The sides to show for the state, or `sides` as they are. */
export function protoSides(sides: { front: string; back: string }) {
  return (protoState !== null && SAMPLES[protoState]) || sides;
}
