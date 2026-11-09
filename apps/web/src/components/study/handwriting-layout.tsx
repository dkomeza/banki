import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
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

// PROTOTYPE (BAN-45), Variant b, "Sheet": the typed screen's layout, with a
// ruled sheet for a pen. At every width the Front sits above, in the column
// the typed Front has (up to 48 rem from 1024 px), and the sheet takes the
// rest of the screen under it. A Front taller than about a quarter of the
// screen folds to that height with a fade, and "Show all" on the fade opens it
// whole over the top of the sheet (it scrolls there if it is longer still);
// "Show less" or writing on the sheet folds it again. The tool bar is a strip
// between the Front and the sheet, "Your answer" on its left from 640 px, as
// the typed answer's label; on a phone the tools spread across the strip.

export function HandwritingView({ hw }: { hw: Handwriting }) {
  const ink = useInk(hw.state === "ink-written");
  const [open, setOpen] = useState(false);
  const [foldRef, fold] = useOverflows<HTMLDivElement>();
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pt-4 sm:px-8 lg:pt-8">
      <section aria-label="Front" className="relative z-20 shrink-0">
        <div
          ref={foldRef}
          className={cn("overflow-hidden", open ? "invisible max-h-[24svh]" : "max-h-[24svh]")}
        >
          <FrontText text={hw.front} />
        </div>
        {fold.overflows && !open && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-end bg-gradient-to-t from-background via-background/80 to-transparent">
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setOpen(true)}
              className="pointer-events-auto flex h-11 items-center gap-1 rounded-full border bg-background pr-3 pl-2 text-sm font-medium text-primary shadow-sm outline-none hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring lg:h-9"
            >
              <ChevronDown aria-hidden className="size-4" />
              Show all
            </button>
          </div>
        )}
        {open && (
          <div className="absolute inset-x-0 top-0 max-h-[calc(100svh-15rem)] overflow-y-auto overscroll-contain rounded-b-2xl border-b bg-background pb-4 shadow-[0_18px_30px_-18px_rgb(0_0_0/0.35)]">
            <FrontText text={hw.front} />
            <button
              type="button"
              aria-expanded
              onClick={() => setOpen(false)}
              className="sticky bottom-0 mt-3 flex h-11 items-center gap-1 rounded-full bg-background pr-3 pl-2 text-sm font-medium text-primary outline-none hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring lg:h-9"
            >
              <ChevronUp aria-hidden className="size-4" />
              Show less
            </button>
          </div>
        )}
      </section>
      <div className="flex shrink-0 items-center gap-2 border-b py-2">
        <span className={cn(LABEL, "hidden pl-1 sm:inline")}>Your answer</span>
        <ToolBar ink={ink} className="w-full justify-between sm:ml-auto sm:w-auto sm:justify-end" />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- folds the Front as the pen lands; the sheet itself is the canvas */}
      <div className="flex min-h-0 flex-1 flex-col" onPointerDownCapture={() => setOpen(false)}>
        <InkCanvas
          ink={ink}
          paper="ruled"
          sample={hw.state === "ink-written"}
          className="-mx-4 flex-1 sm:mx-0"
        />
      </div>
    </div>
  );
}

function FrontText({ text }: { text: string }) {
  return (
    <CardText
      text={text}
      className="text-[1.6rem] leading-tight font-medium tracking-[-0.015em] lg:text-[2.1rem] [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_img]:max-h-64 [&_img]:rounded-md"
    />
  );
}
