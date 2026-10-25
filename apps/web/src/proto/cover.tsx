// PROTOTYPE (BAN-11): Variant f's deck cover, the deck's monogram on ruled
// paper, so each deck has a face you can find again at a glance.
import { cn } from "@/lib/utils";

/** "Calculus 2" is "C2", "Japanese kanji (JLPT N4)" is "JK". */
export function monogram(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words
    .slice(0, 2)
    .map((w) => (/^\p{N}+$/u.test(w) ? w : w[0]?.toLocaleUpperCase()))
    .join("");
}

// Four shades of the same paper, picked by name, so neighbouring covers differ
// without spending the accent.
const SHADES = [
  "bg-[oklch(0.93_0.02_75)] dark:bg-[oklch(0.3_0.015_60)]",
  "bg-[oklch(0.9_0.025_65)] dark:bg-[oklch(0.33_0.02_55)]",
  "bg-[oklch(0.94_0.012_95)] dark:bg-[oklch(0.28_0.012_70)]",
  "bg-[oklch(0.88_0.02_80)] dark:bg-[oklch(0.35_0.015_65)]",
];

function shade(name: string): string {
  let h = 0;
  for (const c of name.toLocaleLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SHADES[h % SHADES.length] ?? SHADES[0]!;
}

export function Cover({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex items-end overflow-hidden text-foreground/85",
        // Ruled lines, like the face of an index card.
        "bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(1.5rem-1px),color-mix(in_oklch,var(--foreground)_8%,transparent)_calc(1.5rem-1px),color-mix(in_oklch,var(--foreground)_8%,transparent)_1.5rem)]",
        shade(name),
        className,
      )}
    >
      <span className="absolute inset-y-0 left-5 w-px bg-primary/35" />
      <span className="relative pb-[0.12em] pl-8 font-semibold leading-none tracking-[-0.05em]">
        {monogram(name)}
      </span>
    </span>
  );
}
