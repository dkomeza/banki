// PROTOTYPE (BAN-12), Variant e, "Contours": the deck page's Cards are a dense
// grid of small tiles, two across even on a phone and four on a desktop. Each
// tile's top 70% is a contour map, rings of ink around two peaks with one ring
// in the accent, seeded by the Card's ID; its bottom 30% is solid muted paper.
// The Front sits on a frosted band across the map's lower part; the Back sits on
// the solid part. Both have a fixed height, and text that runs past it goes
// under an inset shadow.
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

/** A closed, wobbly ring of radius `r` around (cx, cy). */
function ring(cx: number, cy: number, r: number, wobble: number[]): string {
  const points = Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    const k =
      1 +
      (wobble[0] ?? 0) * Math.sin(3 * t + (wobble[1] ?? 0)) +
      (wobble[2] ?? 0) * Math.sin(5 * t + (wobble[3] ?? 0));
    return `${(cx + Math.cos(t) * r * k).toFixed(2)} ${(cy + Math.sin(t) * r * k * 0.8).toFixed(2)}`;
  });
  return `M ${points.join(" L ")} Z`;
}

/** Rings of ink around two peaks, one ring in the accent, on muted paper. */
function Contours({ id }: { id: string }) {
  const random = seeded(id);
  const peaks = [0, 1].map(() => ({
    x: 10 + random() * 80,
    y: 8 + random() * 45,
    rings: 4 + Math.floor(random() * 4),
    wobble: [random() * 0.14, random() * 6, random() * 0.08, random() * 6],
  }));
  const accentPeak = Math.floor(random() * 2);
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 70"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full"
      style={{ background: ink(3, "var(--muted)") }}
    >
      {peaks.map((peak, p) =>
        Array.from({ length: peak.rings }, (_, i) => {
          const isAccent = p === accentPeak && i === peak.rings - 2;
          return (
            <path
              key={`${p}-${i}`}
              d={ring(peak.x, peak.y, 5 + i * 6.5, peak.wobble)}
              fill="none"
              vectorEffect="non-scaling-stroke"
              style={{
                stroke: isAccent ? accent(80) : ink(22, "var(--muted)"),
                strokeWidth: isAccent ? 2 : 1,
              }}
            />
          );
        }),
      )}
    </svg>
  );
}

// Text that runs past its fixed height fades out under an inset shadow, drawn
// over the text, so the cut-off is soft rather than sharp.
const OVER_CARD =
  "after:pointer-events-none after:absolute after:inset-0 after:bg-linear-to-b after:from-transparent after:from-50% after:shadow-[inset_0_-18px_14px_-12px_color-mix(in_oklch,var(--foreground)_30%,transparent)] after:to-card";
const OVER_MUTED =
  "after:pointer-events-none after:absolute after:inset-0 after:bg-linear-to-b after:from-transparent after:from-50% after:shadow-[inset_0_-18px_14px_-12px_color-mix(in_oklch,var(--foreground)_30%,transparent)] after:to-muted";

export function CardTile({ card }: { card: Card }) {
  const [front, frontOver] = useOverflowing<HTMLParagraphElement>();
  const [back, backOver] = useOverflowing<HTMLParagraphElement>();
  return (
    <li className="group/tile relative">
      <Link
        to="/cards/$cardId"
        params={{ cardId: card.id }}
        aria-label={`Edit card: ${card.front}`}
        className="flex h-56 flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground no-underline shadow-xs transition-[border-color,box-shadow] outline-none hover:border-foreground/25 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none lg:h-64"
      >
        <div className="relative h-[70%] shrink-0">
          <Contours id={card.id} />
          <p
            ref={front}
            className={cn(
              "absolute inset-x-0 bottom-0 h-[40%] overflow-hidden border-t border-foreground/10 bg-card/75 px-3 pt-1.5 text-sm leading-snug font-semibold whitespace-pre-wrap backdrop-blur-sm [overflow-wrap:anywhere] lg:px-3.5",
              frontOver && OVER_CARD,
            )}
          >
            {card.front}
          </p>
        </div>
        <p
          ref={back}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden border-t bg-muted px-3 pt-2 pb-2.5 text-[0.8125rem] leading-snug whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere] lg:px-3.5",
            backOver && OVER_MUTED,
          )}
        >
          {card.back}
        </p>
      </Link>
      <TileMenu
        label="Card actions"
        className="absolute top-1 right-1 bg-card/80 backdrop-blur-sm"
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
