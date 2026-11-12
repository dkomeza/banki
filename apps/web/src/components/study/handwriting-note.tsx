import { ChevronDown, ChevronUp, GripHorizontal, MoveDiagonal2 } from "lucide-react";
import type { CSSProperties, ReactNode, WheelEvent as ReactWheelEvent } from "react";
import { CardText } from "@/components/cards/card-text";
import { type Drag, useOverflows } from "@/components/study/handwriting-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-45), round 2: the Front as a note over the canvas, from
// Variant c, that moves and scales. Its header is the grip that moves it, and
// what it holds is drawn at `scale` (CSS zoom), so the type, the Formulas and
// the Image all grow and shrink together. The header and the handles stay at
// their own size, so they keep their touch size at any scale.

export const NOTE_HEADER = 44;

export function Note({
  front,
  scale,
  width,
  maxHeight,
  move,
  resize,
  onScaleWheel,
  tools,
  onFold,
  lifted = false,
  style,
  className,
}: {
  front: string;
  /** How large the Front is drawn: 1 is the typed screen's size. */
  scale: number;
  /** The note's width on screen, in px. */
  width: number;
  /** The tallest its Front gets on screen before it scrolls, in px. */
  maxHeight: number;
  /** The header's drag, which moves it. */
  move: Drag;
  /** The corner handle's drag, which scales it, when it has one. */
  resize?: Drag;
  /** Ctrl+wheel (a trackpad's pinch) over the note. */
  onScaleWheel?: (event: ReactWheelEvent) => void;
  /** More controls in the header, before Fold. */
  tools?: ReactNode;
  onFold: () => void;
  /** Being moved or scaled right now. */
  lifted?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  const [scrollRef, scroll] = useOverflows<HTMLDivElement>();
  return (
    <section
      aria-label="Front"
      style={{ ...style, width }}
      className={cn(
        "pointer-events-auto absolute flex flex-col rounded-2xl border bg-background/95 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] backdrop-blur",
        lifted && "shadow-[0_20px_44px_-16px_rgb(0_0_0/0.45)]",
        className,
      )}
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          onScaleWheel?.(event);
        }
      }}
    >
      <header
        {...move}
        style={{ height: NOTE_HEADER }}
        className={cn(
          "flex shrink-0 touch-none items-center gap-1 rounded-t-2xl pr-1 pl-3 select-none lg:!h-9",
          lifted ? "cursor-grabbing" : "cursor-grab",
          scroll.overflows && "border-b",
        )}
      >
        <GripHorizontal aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="mr-auto text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Front
        </span>
        {tools}
        <button
          type="button"
          aria-expanded
          onClick={onFold}
          className="flex h-11 items-center gap-1 rounded-full pr-3 pl-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:h-8"
        >
          <ChevronUp aria-hidden className="size-4" />
          Fold away
        </button>
      </header>
      <div
        ref={scrollRef}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a note that scrolls on its own takes the keyboard too
        tabIndex={scroll.overflows ? 0 : undefined}
        style={{ maxHeight }}
        className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-b-2xl outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div style={{ zoom: scale, width: width / scale }} className="px-5 pt-1 pb-5">
          <CardText
            text={front}
            className="text-lg leading-snug font-medium tracking-[-0.01em] lg:text-xl [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_img]:max-h-48 [&_img]:rounded-md"
          />
        </div>
      </div>
      {resize !== undefined && (
        <span
          {...resize}
          aria-hidden
          title="Drag to scale"
          className="absolute -right-3 -bottom-3 flex size-11 touch-none cursor-nwse-resize items-center justify-center"
        >
          <span className="flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
            <MoveDiagonal2 className="size-3.5" />
          </span>
        </span>
      )}
    </section>
  );
}

/** The folded note: a one-line tab with the Front's first words, which opens it again. */
export function FoldedNote({
  front,
  onOpen,
  style,
  className,
}: {
  front: string;
  onOpen: () => void;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={onOpen}
      style={style}
      className={cn(
        "pointer-events-auto absolute flex h-11 max-w-[min(26rem,calc(100%-5rem))] items-center gap-2 rounded-full border bg-background/95 pr-3 pl-4 text-sm font-medium shadow-sm backdrop-blur outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring lg:h-9",
        className,
      )}
    >
      <span className="min-w-0 truncate">
        <CardText text={firstLine(front)} className="inline" />
      </span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">Show the Front</span>
    </button>
  );
}

/** The Front's first line, for the folded tab. */
function firstLine(front: string): string {
  return front.split("\n").find((line) => line.trim() !== "") ?? front;
}
