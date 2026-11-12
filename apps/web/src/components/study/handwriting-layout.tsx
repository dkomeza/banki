import { AArrowDown, AArrowUp } from "lucide-react";
import { useRef, useState } from "react";
import { FoldedNote, NOTE_HEADER, Note } from "@/components/study/handwriting-note";
import {
  clamp,
  type Handwriting,
  InkCanvas,
  ToolBar,
  useDrag,
  useInk,
  useNoteFrame,
  useSize,
} from "@/components/study/handwriting-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-45), Variant e, "Corners": Variant c's full-screen grid
// canvas, with the Front as a note that lives in one of the canvas's four
// corners. Its header drags it, and let go it glides to the nearest corner, so
// it never ends up half over the middle of the writing. A− and A+ in its
// header step its size from 75% to 200%: the type, Formulas and Image grow
// together, and where the note can't get wider, its text wraps. It stays in
// its corner, at its size, from Card to Card. A wheel or a finger over it
// scrolls the Front, never the canvas.

const STEPS = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2] as const;
const ONE = STEPS.indexOf(1);
const MARGIN = 12;
/** The tool bar's column at the right edge, which the right corners keep clear of. */
const TOOLS = 60;

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Frame = { corner: Corner; step: number; folded: boolean };

export function HandwritingView({ hw }: { hw: Handwriting }) {
  const ink = useInk(hw.state === "ink-written");
  const [areaRef, area] = useSize<HTMLDivElement>();
  const [noteRef, note] = useSize<HTMLDivElement>();
  const [frame, setFrame] = useNoteFrame<Frame>("e", {
    corner: "top-left",
    step: ONE,
    folded: false,
  });
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const last = useRef({ dx: 0, dy: 0 });

  const wide = area.w >= 1000;
  const room = area.w - 2 * MARGIN - TOOLS;
  const base = wide ? 416 : Math.max(240, room);
  const scale = STEPS[clamp(frame.step, 0, STEPS.length - 1)] ?? 1;
  const width = Math.min(base * scale, room);
  const maxHeight = Math.max(
    96,
    Math.min(area.h * 0.45 * Math.max(1, scale), area.h - 2 * MARGIN - NOTE_HEADER),
  );

  const spot = (corner: Corner, w: number, h: number) => ({
    x: corner.endsWith("left") ? MARGIN : area.w - MARGIN - TOOLS - w,
    y: corner.startsWith("top") ? MARGIN : area.h - MARGIN - h,
  });
  const at = spot(frame.corner, width, note.h);

  const move = useDrag(
    (dx, dy) => {
      last.current = { dx, dy };
      setOffset({ dx, dy });
    },
    () => {
      // The corner nearest the note's middle where it was let go.
      const midX = at.x + last.current.dx + width / 2;
      const midY = at.y + last.current.dy + note.h / 2;
      const corner: Corner = `${midY < area.h / 2 ? "top" : "bottom"}-${midX < (area.w - TOOLS) / 2 ? "left" : "right"}`;
      setFrame((f) => ({ ...f, corner }));
      setOffset(null);
    },
    () => {
      last.current = { dx: 0, dy: 0 };
      setOffset({ dx: 0, dy: 0 });
    },
  );
  const step = (by: number) =>
    setFrame((f) => ({ ...f, step: clamp(f.step + by, 0, STEPS.length - 1) }));

  return (
    <InkCanvas
      ink={ink}
      paper="grid"
      sample={hw.state === "ink-written"}
      className="flex-1 bg-card"
    >
      <div ref={areaRef} className="pointer-events-none absolute inset-0">
        {area.w > 0 &&
          (frame.folded ? (
            <FoldedNote
              front={hw.front}
              onOpen={() => setFrame((f) => ({ ...f, folded: false }))}
              style={frame.corner.startsWith("top") ? { top: MARGIN } : { bottom: MARGIN }}
              className={frame.corner.endsWith("left") ? "left-3" : "right-[4.5rem]"}
            />
          ) : (
            <div
              ref={noteRef}
              style={{
                width,
                left: at.x + (offset?.dx ?? 0),
                top: at.y + (offset?.dy ?? 0),
                // Hidden until it's measured, so it doesn't flash at the top.
                visibility: note.h === 0 && !frame.corner.startsWith("top") ? "hidden" : undefined,
              }}
              className={cn(
                "absolute",
                offset === null &&
                  "transition-[left,top] duration-200 ease-out motion-reduce:transition-none",
              )}
            >
              <Note
                front={hw.front}
                scale={scale}
                width={width}
                maxHeight={maxHeight}
                move={move}
                lifted={offset !== null}
                onScaleWheel={(event) => step(event.deltaY < 0 ? 1 : -1)}
                tools={
                  <div className="flex items-center">
                    <button
                      type="button"
                      aria-label="Smaller"
                      disabled={frame.step <= 0}
                      onClick={() => step(-1)}
                      className={SIZE}
                    >
                      <AArrowDown aria-hidden className="size-[1.15rem]" />
                    </button>
                    <span className="w-9 text-center text-xs font-medium text-muted-foreground tabular-nums">
                      {Math.round(scale * 100)}%
                    </span>
                    <button
                      type="button"
                      aria-label="Larger"
                      disabled={frame.step >= STEPS.length - 1}
                      onClick={() => step(1)}
                      className={SIZE}
                    >
                      <AArrowUp aria-hidden className="size-[1.15rem]" />
                    </button>
                  </div>
                }
                onFold={() => setFrame((f) => ({ ...f, folded: true }))}
                className="!relative"
              />
            </div>
          ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center lg:right-4">
        <ToolBar
          ink={ink}
          vertical
          className="pointer-events-auto rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur"
        />
      </div>
    </InkCanvas>
  );
}

const SIZE =
  "flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 lg:size-8";
