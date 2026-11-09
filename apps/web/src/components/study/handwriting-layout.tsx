import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { CardText } from "@/components/cards/card-text";
import {
  type Handwriting,
  InkCanvas,
  ToolBar,
  useInk,
  useOverflows,
} from "@/components/study/handwriting-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-45), Variant c, "Note": the canvas is the whole screen
// between the top bar and the dock, on grid paper, and the Front is a note
// pinned over its top-left corner (across the top below 1024 px, 26 rem wide
// from there). The note scrolls on its own when the Front is long, up to 45%
// of the screen, and folds away to a one-line tab with its first words, which
// opens it again. The canvas pans under it, so nothing written is ever lost
// behind it. The tool bar is a column floating at the canvas's right edge,
// where the hand that isn't writing reaches it.

export function HandwritingView({ hw }: { hw: Handwriting }) {
  const ink = useInk(hw.state === "ink-written");
  const [folded, setFolded] = useState(false);
  const [noteRef, note] = useOverflows<HTMLDivElement>();
  return (
    <InkCanvas
      ink={ink}
      paper="grid"
      sample={hw.state === "ink-written"}
      className="flex-1 bg-card"
    >
      <section
        aria-label="Front"
        className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start sm:inset-x-4 lg:right-auto lg:left-6 lg:w-[26rem]"
      >
        {folded && (
          <button
            type="button"
            aria-expanded={false}
            onClick={() => setFolded(false)}
            className="pointer-events-auto flex h-11 max-w-[min(100%,calc(100vw-6rem))] items-center gap-2 rounded-full border bg-background/95 pr-3 pl-4 text-sm font-medium shadow-sm backdrop-blur outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring lg:h-9"
          >
            <span className="min-w-0 truncate">
              <CardText text={firstLine(hw.front)} className="inline" />
            </span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="sr-only">Show the Front</span>
          </button>
        )}
        <div
          className={cn(
            "pointer-events-auto relative flex max-h-[45svh] w-full flex-col overflow-hidden rounded-2xl border bg-background/95 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] backdrop-blur max-lg:w-[calc(100%-3.5rem)]",
            folded && "hidden",
          )}
        >
          <div
            ref={noteRef}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a note that scrolls on its own takes the keyboard too
            tabIndex={note.overflows ? 0 : undefined}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <CardText
              text={hw.front}
              className="text-lg leading-snug font-medium tracking-[-0.01em] lg:text-xl [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_img]:max-h-48 [&_img]:rounded-md"
            />
          </div>
          <div
            className={cn(
              "flex shrink-0 justify-end px-1.5 pb-1.5",
              note.overflows && !note.atEnd && "border-t",
            )}
          >
            <button
              type="button"
              aria-expanded
              onClick={() => setFolded(true)}
              className="flex h-11 items-center gap-1 rounded-full pr-3 pl-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:h-8"
            >
              <ChevronUp aria-hidden className="size-4" />
              Fold away
            </button>
          </div>
        </div>
      </section>
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

/** The Front's first line, for the folded tab. */
function firstLine(front: string): string {
  return front.split("\n").find((line) => line.trim() !== "") ?? front;
}
