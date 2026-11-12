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

// PROTOTYPE (BAN-45), Variant d, "Free note": Variant c's full-screen grid
// canvas, with the Front as a note that goes wherever it's put. Its header
// moves it anywhere over the canvas, and the handle at its bottom-right corner
// scales it, like a picture: the type, Formulas and Image grow and shrink with
// it, from 60% to 200%. Ctrl+wheel (a trackpad's pinch) scales it too. It
// stays where it was left from Card to Card. It folds away to a one-line tab
// where it sits, and a wheel or a finger over it scrolls the Front, never the
// canvas.

type Frame = { x: number; y: number; scale: number | null; folded: boolean };

export function HandwritingView({ hw }: { hw: Handwriting }) {
  const ink = useInk(hw.state === "ink-written");
  const [areaRef, area] = useSize<HTMLDivElement>();
  const [frame, setFrame] = useNoteFrame<Frame>("d", { x: 12, y: 12, scale: null, folded: false });
  const [lifted, setLifted] = useState(false);
  const from = useRef(frame);

  const wide = area.w >= 1000;
  // At 100% the note is Variant c's: 26 rem from 1024 px, across the top
  // below, clear of the tool bar.
  const base = wide ? 416 : Math.max(240, area.w - 24 - 56);
  const scale = clamp(
    frame.scale ?? 1,
    NOTE_SCALE.min,
    Math.min(NOTE_SCALE.max, (area.w - 16) / base),
  );
  const width = base * scale;
  const x = clamp(frame.x, 64 - width, area.w - 64);
  const y = clamp(frame.y, 0, area.h - NOTE_HEADER);
  const maxHeight = Math.max(96, Math.min(area.h * 0.45 * scale, area.h - y - NOTE_HEADER - 12));

  const begin = () => {
    from.current = { ...frame, x, y, scale };
    setLifted(true);
  };
  const end = () => setLifted(false);
  const move = useDrag(
    (dx, dy) => setFrame((f) => ({ ...f, x: from.current.x + dx, y: from.current.y + dy })),
    end,
    begin,
  );
  const resize = useDrag(
    (dx, dy) => {
      const start = from.current.scale ?? 1;
      // Along the diagonal: whichever way the corner went further.
      const grow = Math.abs(dx) >= Math.abs(dy) ? dx : dy * (base / 260);
      setFrame((f) => ({
        ...f,
        scale: clamp((base * start + grow) / base, NOTE_SCALE.min, NOTE_SCALE.max),
      }));
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
    >
      <div ref={areaRef} className="pointer-events-none absolute inset-0">
        {area.w > 0 &&
          (frame.folded ? (
            <FoldedNote
              front={hw.front}
              onOpen={() => setFrame((f) => ({ ...f, folded: false }))}
              style={{ left: Math.max(8, x), top: y }}
            />
          ) : (
            <Note
              front={hw.front}
              scale={scale}
              width={width}
              maxHeight={maxHeight}
              move={move}
              resize={resize}
              lifted={lifted}
              onScaleWheel={(event) =>
                setFrame((f) => ({
                  ...f,
                  scale: clamp(
                    scale * Math.exp(-event.deltaY * 0.01),
                    NOTE_SCALE.min,
                    NOTE_SCALE.max,
                  ),
                }))
              }
              tools={
                scale !== 1 && (
                  <button
                    type="button"
                    title="Back to 100%"
                    onClick={() => setFrame((f) => ({ ...f, scale: 1 }))}
                    className="flex h-11 items-center rounded-full px-2 text-xs font-medium text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:h-8"
                  >
                    {Math.round(scale * 100)}%
                  </button>
                )
              }
              onFold={() => setFrame((f) => ({ ...f, folded: true }))}
              style={{ left: x, top: y }}
            />
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
