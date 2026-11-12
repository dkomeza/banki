import { LocateFixed } from "lucide-react";
import { useRef, useState } from "react";
import { FoldedNote, NOTE_HEADER, Note } from "@/components/study/handwriting-note";
import {
  clamp,
  type Handwriting,
  InkCanvas,
  NOTE_SCALE,
  ToolBar,
  useDrag,
  useInk,
  useNoteFrame,
  useSize,
} from "@/components/study/handwriting-proto";

// PROTOTYPE (BAN-45), Variant f, "Sticker": Variant c's full-screen grid
// canvas, with the Front as a note stuck on the paper itself, like a printed
// question at the head of an exam sheet. It pans with the ink, so it stays
// beside what was written about it, and it's dragged by its header to
// anywhere on the paper. The handle at its corner scales it, like a picture,
// from 60% to 200%. Panned out of sight, a "Front" chip at the canvas's
// top-left brings it back into view. A wheel or a finger over it scrolls the
// Front, never the canvas.

type Frame = { x: number; y: number; scale: number | null; folded: boolean };

export function HandwritingView({ hw }: { hw: Handwriting }) {
  const ink = useInk(hw.state === "ink-written");
  const [areaRef, area] = useSize<HTMLDivElement>();
  const [noteRef, note] = useSize<HTMLDivElement>();
  // Per Card: the note is on this Card's paper.
  const [frame, setFrame] = useState<Frame>({ x: 12, y: 12, scale: null, folded: false });
  const [scaleKept, setScaleKept] = useNoteFrame<{ scale: number | null }>("f", { scale: null });
  const [lifted, setLifted] = useState(false);
  const from = useRef(frame);

  const wide = area.w >= 1000;
  const base = wide ? 416 : Math.max(240, area.w - 24 - 56);
  const scale = clamp(
    frame.scale ?? scaleKept.scale ?? 1,
    NOTE_SCALE.min,
    Math.min(NOTE_SCALE.max, (area.w - 16) / base),
  );
  const width = base * scale;
  const maxHeight = Math.max(96, Math.min(area.h * 0.45 * scale, area.h - NOTE_HEADER - 24));

  const begin = () => {
    from.current = { ...frame, scale };
    setLifted(true);
  };
  const end = () => setLifted(false);
  const move = useDrag(
    (dx, dy) =>
      setFrame((f) => ({
        ...f,
        x: Math.max(0, from.current.x + dx),
        y: Math.max(0, from.current.y + dy),
      })),
    end,
    begin,
  );
  const scaleTo = (next: number) => {
    const s = clamp(next, NOTE_SCALE.min, NOTE_SCALE.max);
    setFrame((f) => ({ ...f, scale: s }));
    setScaleKept({ scale: s });
  };
  const resize = useDrag(
    (dx, dy) => {
      const grow = Math.abs(dx) >= Math.abs(dy) ? dx : dy * (base / 260);
      scaleTo((base * (from.current.scale ?? 1) + grow) / base);
    },
    end,
    begin,
  );

  return (
    <InkCanvas
      ink={ink}
      paper="grid"
      sample={hw.state === "ink-written"}
      className="flex-1 bg-card"
      renderOnPaper={(pan) => {
        const left = frame.x - pan.x;
        const top = frame.y - pan.y;
        const h = frame.folded ? 44 : note.h;
        const away =
          area.w > 0 &&
          (left + (frame.folded ? 200 : width) < 24 ||
            top + h < 24 ||
            left > area.w - 24 ||
            top > area.h - 24);
        return (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {area.w > 0 &&
              (frame.folded ? (
                <FoldedNote
                  front={hw.front}
                  onOpen={() => setFrame((f) => ({ ...f, folded: false }))}
                  style={{ left, top }}
                />
              ) : (
                <div ref={noteRef} className="absolute" style={{ left, top, width }}>
                  <Note
                    front={hw.front}
                    scale={scale}
                    width={width}
                    maxHeight={maxHeight}
                    move={move}
                    resize={resize}
                    lifted={lifted}
                    onScaleWheel={(event) => scaleTo(scale * Math.exp(-event.deltaY * 0.01))}
                    tools={
                      scale !== 1 && (
                        <button
                          type="button"
                          title="Back to 100%"
                          onClick={() => scaleTo(1)}
                          className="flex h-11 items-center rounded-full px-2 text-xs font-medium text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:h-8"
                        >
                          {Math.round(scale * 100)}%
                        </button>
                      )
                    }
                    onFold={() => setFrame((f) => ({ ...f, folded: true }))}
                    className="!relative"
                  />
                </div>
              ))}
            {away && (
              <button
                type="button"
                onClick={() => setFrame((f) => ({ ...f, x: pan.x + 12, y: pan.y + 12 }))}
                className="pointer-events-auto absolute top-3 left-3 flex h-11 items-center gap-2 rounded-full border bg-background/95 pr-4 pl-3 text-sm font-medium shadow-sm backdrop-blur outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring lg:h-9"
              >
                <LocateFixed aria-hidden className="size-4 text-primary" />
                Bring the Front here
              </button>
            )}
          </div>
        );
      }}
    >
      <div ref={areaRef} className="pointer-events-none absolute inset-0" />
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
