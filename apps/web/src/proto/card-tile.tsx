// PROTOTYPE (BAN-12), Variant f, "Blocks": the deck page's Cards are wide
// tiles, two across on a desktop. Each tile's top 70% is a grid of paper blocks
// (quarter circles, half circles, squares, one block in the accent), seeded by
// the Card's ID, quieter towards the bottom; its bottom 30% is solid ink. The
// Front sits large on the blocks' quiet lower rows; the Back sits on the ink in
// paper-coloured text. Both have a fixed height, and text that runs past it
// goes under an inset shadow.
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { TileMenu } from "@/components/tile-menu";
import { cn } from "@/lib/utils";
import type { Card } from "./cards";
import { deleteWithUndo } from "./toaster";

/** Whether the element's content runs past its fixed height, kept up to date. */
export function useOverflowing<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const measure = () => setOverflowing(el !== null && el.scrollHeight > el.clientHeight + 1);
    measure();
    const resized = new ResizeObserver(measure);
    if (el !== null) resized.observe(el);
    return () => resized.disconnect();
  }, []);
  return [ref, overflowing];
}

/** A seeded random number generator, so each Card's graphic is its own and stays put. */
export function seeded(id: string): () => number {
  let a = 0;
  for (const c of id) a = (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ink at `percent` strength mixed into `base`, as a CSS colour that follows the theme. */
export const ink = (percent: number, base = "var(--card)") =>
  `color-mix(in oklch, var(--foreground) ${percent}%, ${base})`;
/** The accent at `percent` strength mixed into `base`. */
export const accent = (percent: number, base = "var(--card)") =>
  `color-mix(in oklch, var(--primary) ${percent}%, ${base})`;

const CELL = 14;
const COLS = 10;
const ROWS = 5;

/** One block of the grid: a quarter circle, half circle, circle or square, or nothing. */
function block(kind: number, x: number, y: number, turn: number, fill: string, key: string) {
  const c = CELL / 2;
  const transform = `rotate(${turn * 90} ${x + c} ${y + c})`;
  if (kind === 0)
    return (
      <path
        key={key}
        d={`M ${x} ${y} h ${CELL} a ${CELL} ${CELL} 0 0 1 ${-CELL} ${CELL} Z`}
        transform={transform}
        style={{ fill }}
      />
    );
  if (kind === 1)
    return (
      <path
        key={key}
        d={`M ${x} ${y + c} a ${c} ${c} 0 0 1 ${CELL} 0 Z`}
        transform={transform}
        style={{ fill }}
      />
    );
  if (kind === 2) return <circle key={key} cx={x + c} cy={y + c} r={c} style={{ fill }} />;
  if (kind === 3) return <rect key={key} x={x} y={y} width={CELL} height={CELL} style={{ fill }} />;
  return null;
}

/** A grid of paper blocks, one in the accent, quieter towards the bottom rows. */
function Blocks({ id }: { id: string }) {
  const random = seeded(id);
  const tones = [ink(8), ink(13), ink(18), ink(5, "var(--muted)")];
  const accentAt = Math.floor(random() * COLS * 2);
  const blocks = Array.from({ length: COLS * ROWS }, (_, i) => {
    const row = Math.floor(i / COLS);
    const kind = Math.floor(random() * 5);
    const turn = Math.floor(random() * 4);
    const tone = tones[Math.floor(random() * tones.length)] ?? ink(8);
    const fill = i === accentAt ? accent(70) : tone;
    const shape = block(
      kind === 4 && i === accentAt ? 2 : kind,
      (i % COLS) * CELL,
      row * CELL,
      turn,
      fill,
      String(i),
    );
    return row >= 3 ? (
      <g key={i} opacity={row === 3 ? 0.45 : 0.25}>
        {shape}
      </g>
    ) : (
      shape
    );
  });
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
      preserveAspectRatio="xMinYMin slice"
      className="absolute inset-0 size-full"
      style={{ background: "var(--card)" }}
    >
      {blocks}
    </svg>
  );
}

// Text that runs past its fixed height fades out under an inset shadow, drawn
// over the text, so the cut-off is soft rather than sharp.
const OVER_CARD =
  "after:pointer-events-none after:absolute after:inset-0 after:bg-linear-to-b after:from-transparent after:from-50% after:shadow-[inset_0_-18px_14px_-12px_color-mix(in_oklch,var(--foreground)_30%,transparent)] after:to-card";
const OVER_INK =
  "after:pointer-events-none after:absolute after:inset-0 after:bg-linear-to-b after:from-transparent after:from-50% after:shadow-[inset_0_-18px_14px_-12px_rgb(0_0_0/0.6)] after:to-foreground";

export function CardTile({ card }: { card: Card }) {
  const [front, frontOver] = useOverflowing<HTMLParagraphElement>();
  const [back, backOver] = useOverflowing<HTMLParagraphElement>();
  return (
    <li className="group/tile relative">
      <Link
        to="/cards/$cardId"
        params={{ cardId: card.id }}
        aria-label={`Edit card: ${card.front}`}
        className="flex h-64 flex-col overflow-hidden rounded-[1.25rem] border bg-card text-card-foreground no-underline shadow-xs transition-[border-color,box-shadow] outline-none hover:border-foreground/25 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none sm:h-72"
      >
        <div className="relative h-[70%] shrink-0">
          <Blocks id={card.id} />
          <p
            ref={front}
            className={cn(
              "absolute inset-x-0 bottom-0 h-[40%] overflow-hidden px-5 pt-1 text-lg leading-snug font-semibold tracking-[-0.015em] whitespace-pre-wrap [overflow-wrap:anywhere] [text-shadow:0_0_6px_var(--card),0_0_2px_var(--card)]",
              frontOver && OVER_CARD,
            )}
          >
            {card.front}
          </p>
        </div>
        <p
          ref={back}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden bg-foreground px-5 pt-3 pb-3 text-sm leading-snug whitespace-pre-wrap text-background/85 [overflow-wrap:anywhere]",
            backOver && OVER_INK,
          )}
        >
          {card.back}
        </p>
      </Link>
      <TileMenu
        label="Card actions"
        className="absolute top-1.5 right-1.5 bg-card/85 backdrop-blur-sm"
        actions={[
          {
            label: "Delete",
            icon: <Trash2 aria-hidden />,
            danger: true,
            onClick: () => deleteWithUndo(card),
          },
        ]}
      />
    </li>
  );
}
