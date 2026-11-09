import { CardText } from "@/components/cards/card-text";
import { LABEL } from "@/components/study/answer";
import {
  type Handwriting,
  InkCanvas,
  ToolBar,
  useInk,
  useOverflows,
} from "@/components/study/handwriting-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-45), Variant a, "Desk": the Front beside the canvas. From
// 768 px (a tablet in portrait, and wider) the Front is a column on the left,
// a third of the width up to 26 rem, scrolling in its own pane when it is
// long; the canvas takes the rest, edge to edge down to the dock. Below 768 px
// the Front sits above the canvas instead, in a band of at most a third of the
// screen that scrolls the same way. The tool bar floats at the top of the
// canvas, centred, as a pill. Plain paper with faint ruling.

export function HandwritingView({ hw }: { hw: Handwriting }) {
  const ink = useInk(hw.state === "ink-written");
  const [frontRef, front] = useOverflows<HTMLDivElement>();
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <section
        aria-label="Front"
        className="relative flex max-h-[33%] shrink-0 flex-col border-b md:max-h-none md:w-[clamp(17rem,34%,26rem)] md:border-r md:border-b-0"
      >
        <div
          ref={frontRef}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a pane that scrolls on its own takes the keyboard too
          tabIndex={front.overflows ? 0 : undefined}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-6 md:pt-8 lg:px-8 lg:pt-10"
        >
          <CardText
            text={hw.front}
            className="text-xl leading-snug font-medium tracking-[-0.015em] lg:text-2xl [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_img]:max-h-56 [&_img]:rounded-md"
          />
        </div>
        {front.overflows && !front.atEnd && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-gradient-to-t from-background to-transparent pb-1.5"
          >
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
              Scroll for more
            </span>
          </div>
        )}
      </section>
      <InkCanvas
        ink={ink}
        paper="ruled"
        sample={hw.state === "ink-written"}
        inset={64}
        className="flex-1 bg-card"
      >
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur">
            <span className={cn(LABEL, "hidden pl-3 lg:inline")}>Your answer</span>
            <ToolBar ink={ink} />
          </div>
        </div>
      </InkCanvas>
    </div>
  );
}
