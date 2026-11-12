import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from "react";
import { CardText } from "@/components/cards/card-text";
import { type Drag, useOverflows } from "@/components/study/handwriting-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-45), round 3: the Front as an object on the board, like an
// image on a Miro board. It has no chrome of its own: tapping it selects it,
// which draws the accent frame with a handle at each corner and a small menu
// over it, and a drag anywhere on it moves it. A corner handle scales it, about
// the opposite corner, keeping its shape: what it holds is drawn at `scale`
// (CSS zoom), so the type, the Formulas and the Image grow and shrink together.
// Tapping the paper lets go of it.

export type Corner = "tl" | "tr" | "bl" | "br";
export type Side = "r" | "b";
const CORNERS: readonly Corner[] = ["tl", "tr", "bl", "br"];

const CORNER_AT: Record<Corner, string> = {
  tl: "-top-[22px] -left-[22px] cursor-nwse-resize lg:-top-3 lg:-left-3",
  tr: "-top-[22px] -right-[22px] cursor-nesw-resize lg:-top-3 lg:-right-3",
  bl: "-bottom-[22px] -left-[22px] cursor-nesw-resize lg:-bottom-3 lg:-left-3",
  br: "-right-[22px] -bottom-[22px] cursor-nwse-resize lg:-right-3 lg:-bottom-3",
};
const SIDE_AT: Record<Side, string> = {
  r: "top-1/2 -right-[22px] -translate-y-1/2 cursor-ew-resize lg:-right-3",
  b: "-bottom-[22px] left-1/2 -translate-x-1/2 cursor-ns-resize lg:-bottom-3",
};

export function FrontObject({
  front,
  scale,
  width,
  height,
  selected,
  lifted,
  onSelect,
  move,
  corner,
  side,
  onKey,
  onScaleWheel,
  menu,
  menuBelow = false,
  measureRef,
  base,
  style,
}: {
  front: string;
  /** How large the Front is drawn on screen: 1 is the typed screen's size. */
  scale: number;
  /** Its width on screen, in px. */
  width: number;
  /** How tall its frame is on screen before the Front scrolls inside it, or `null` for all of it. */
  height: number | null;
  selected: boolean;
  /** Being moved or scaled right now. */
  lifted: boolean;
  onSelect: () => void;
  move: Drag;
  corner: (corner: Corner) => Drag;
  /** The side handles' drags, where it has them: the right one sets its width, the bottom one its height. */
  side?: (side: Side) => Drag;
  /** Arrow keys and + / − while it has focus. */
  onKey: (event: KeyboardEvent) => void;
  /** Ctrl+wheel (a trackpad's pinch) over it, where the board doesn't zoom: the canvas stops the page's zoom. */
  onScaleWheel?: (deltaY: number) => void;
  /** The menu over it while it's selected, where it has one. */
  menu?: ReactNode;
  /** No room over it: the menu goes below. */
  menuBelow?: boolean;
  /** An unseen copy of the Front at 100%, for measuring how tall all of it is. */
  measureRef?: Ref<HTMLDivElement>;
  /** How wide its text is at 100%. */
  base: number;
  style?: CSSProperties;
}) {
  const [scrollRef, scroll] = useOverflows<HTMLDivElement>();
  const cut = height !== null && scroll.overflows;
  return (
    <section
      aria-label="Front"
      aria-roledescription="movable note"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it moves and scales from the keyboard too
      tabIndex={0}
      style={{ ...style, width }}
      onFocus={onSelect}
      onKeyDown={onKey}
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) onScaleWheel?.(event.deltaY);
      }}
      className={cn(
        "group/front pointer-events-auto absolute touch-none outline-none select-none",
        lifted ? "cursor-grabbing" : "cursor-grab",
      )}
      {...move}
      onPointerDown={(event) => {
        onSelect();
        const target = event.target;
        if (
          event.pointerType === "touch" &&
          target instanceof Element &&
          target.closest("[data-own-wheel]")
        )
          return;
        move.onPointerDown(event);
      }}
    >
      <div
        className={cn(
          "relative rounded-lg bg-background shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_24px_-12px_rgb(0_0_0/0.25)] ring-1 ring-border transition-shadow motion-reduce:transition-none",
          lifted && "shadow-[0_2px_4px_rgb(0_0_0/0.1),0_20px_44px_-16px_rgb(0_0_0/0.45)]",
          !selected && "group-hover/front:ring-2 group-hover/front:ring-primary/40",
        )}
      >
        <div
          ref={scrollRef}
          data-own-wheel={cut ? "" : undefined}
          style={height === null ? undefined : { maxHeight: height }}
          className={cn(
            "overflow-hidden rounded-lg",
            height !== null && "overflow-y-auto overscroll-contain",
            // A finger scrolls a Front cut short; a pen or a mouse still moves it.
            cut && "touch-pan-y",
          )}
        >
          <div style={{ zoom: scale, width: width / scale }} className="px-5 pt-4 pb-5">
            <CardText text={front} className={FRONT_TEXT} />
          </div>
        </div>
        {cut && !scroll.atEnd && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>
      <div
        ref={measureRef}
        aria-hidden
        style={{ width: base }}
        className="pointer-events-none invisible absolute top-0 left-0 -z-10 px-5 pt-4 pb-5"
      >
        <CardText text={front} className={FRONT_TEXT} />
      </div>
      {!selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-6 left-0 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
        >
          Front
        </span>
      )}
      {selected && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-[3px] rounded-[0.6rem] border-2 border-primary"
          />
          {CORNERS.map((c) => (
            <Handle key={c} drag={corner(c)} className={CORNER_AT[c]} title="Drag to scale" />
          ))}
          {side !== undefined &&
            (["r", "b"] as const).map((s) => (
              <Handle
                key={s}
                drag={side(s)}
                className={SIDE_AT[s]}
                title={s === "r" ? "Drag to change its width" : "Drag to change its height"}
                bar={s}
              />
            ))}
          {menu !== undefined && (
            <div
              className={cn(
                "absolute left-0 flex w-max items-center gap-0.5 rounded-full border bg-background p-1 shadow-md",
                menuBelow
                  ? "top-[calc(100%+1.75rem)]"
                  : "bottom-[calc(100%+1.75rem)] lg:bottom-[calc(100%+1.25rem)]",
              )}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {menu}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const FRONT_TEXT =
  "text-lg leading-snug font-medium tracking-[-0.01em] lg:text-xl [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_img]:pointer-events-none [&_img]:max-h-48 [&_img]:max-w-full [&_img]:rounded-md";

/** A handle on the frame: small to see, 44 px to touch below 1024 px. */
function Handle({
  drag,
  className,
  title,
  bar,
}: {
  drag: Drag;
  className: string;
  title: string;
  bar?: Side;
}) {
  return (
    <span
      {...drag}
      aria-hidden
      title={title}
      className={cn(
        "absolute z-10 flex size-11 touch-none items-center justify-center lg:size-6",
        className,
      )}
    >
      <span
        className={cn(
          "border-2 border-primary bg-background shadow-sm",
          bar === undefined
            ? "size-3.5 rounded-full lg:size-3"
            : bar === "r"
              ? "h-6 w-2 rounded-full lg:h-5 lg:w-1.5"
              : "h-2 w-6 rounded-full lg:h-1.5 lg:w-5",
        )}
      />
    </span>
  );
}

export const MENU_BUTTON =
  "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 lg:h-8 lg:min-w-8 lg:px-2.5";
