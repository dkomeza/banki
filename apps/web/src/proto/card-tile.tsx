// PROTOTYPE (BAN-12), Variant d, "Paper cut": each Card in the deck page's grid
// is a tall tile, its top 70% a graphic of paper shapes cut out and laid over
// each other (one of them in the accent), seeded by the Card's ID, and its
// bottom 30% plain card. The Front sits on the graphic's lower part, where it
// fades to the card colour; the Back sits on the plain part. Both have a fixed
// height, and text that runs past it goes under an inset shadow.
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

/** Three to five paper shapes, one of them in the accent, on a paper ground. */
function PaperCut({ id }: { id: string }) {
  const random = seeded(id);
  const pick = <T,>(xs: readonly [T, ...T[]]): T => xs[Math.floor(random() * xs.length)] ?? xs[0];
  const tones: [string, ...string[]] = [ink(6), ink(10), ink(14), ink(4, "var(--muted)")];
  const count = 3 + Math.floor(random() * 3);
  const accentAt = Math.floor(random() * count);
  const shapes = Array.from({ length: count }, (_, i) => {
    const fill = i === accentAt ? accent(55) : pick(tones);
    const x = random() * 100;
    const y = random() * 60;
    const size = 18 + random() * 38;
    const kind = pick(["circle", "slab", "arc"] as const);
    if (kind === "circle") return <circle key={i} cx={x} cy={y} r={size / 2} style={{ fill }} />;
    if (kind === "slab")
      return (
        <rect
          key={i}
          x={x - size / 2}
          y={y - size / 4}
          width={size}
          height={size / 2}
          rx={3}
          transform={`rotate(${random() * 70 - 35} ${x} ${y})`}
          style={{ fill }}
        />
      );
    return (
      <path
        key={i}
        d={`M ${x - size / 2} ${y} a ${size / 2} ${size / 2} 0 0 1 ${size} 0 Z`}
        transform={`rotate(${random() * 360} ${x} ${y})`}
        style={{ fill }}
      />
    );
  });
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 70"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full"
      style={{ background: ink(3, "var(--muted)") }}
    >
      {shapes}
    </svg>
  );
}

// Text that runs past its fixed height fades out under an inset shadow, drawn
// over the text, so the cut-off is soft rather than sharp.
const OVER_CARD =
  "after:pointer-events-none after:absolute after:inset-0 after:bg-linear-to-b after:from-transparent after:from-50% after:shadow-[inset_0_-18px_14px_-12px_color-mix(in_oklch,var(--foreground)_30%,transparent)] after:to-card";

export function CardTile({ card }: { card: Card }) {
  const [front, frontOver] = useOverflowing<HTMLParagraphElement>();
  const [back, backOver] = useOverflowing<HTMLParagraphElement>();
  return (
    <li className="group/tile relative">
      <Link
        to="/cards/$cardId"
        params={{ cardId: card.id }}
        aria-label={`Edit card: ${card.front}`}
        className="flex h-64 flex-col overflow-hidden sm:h-80 rounded-[1.25rem] border bg-card text-card-foreground no-underline shadow-xs transition-[border-color,box-shadow,translate] outline-none hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <div className="relative h-[70%] shrink-0">
          <PaperCut id={card.id} />
          <div className="absolute inset-x-0 bottom-0 h-[42%] bg-linear-to-b from-card/0 via-card/85 to-card" />
          <p
            ref={front}
            className={cn(
              "absolute inset-x-0 bottom-0 h-[38%] overflow-hidden px-4 pt-1 text-[1.05rem] leading-snug font-semibold tracking-[-0.01em] whitespace-pre-wrap [overflow-wrap:anywhere]",
              frontOver && OVER_CARD,
            )}
          >
            {card.front}
          </p>
        </div>
        <p
          ref={back}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden border-t px-4 pt-2.5 pb-3 text-sm leading-snug whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]",
            backOver && OVER_CARD,
          )}
        >
          {card.back}
        </p>
      </Link>
      <TileMenu
        label="Card actions"
        className="absolute top-1.5 right-1.5 bg-card/80 backdrop-blur-sm"
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
