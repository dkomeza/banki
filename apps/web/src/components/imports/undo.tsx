import { Link } from "@tanstack/react-router";
import { LoaderCircle, Undo2 } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type UndoFacts, cardCount, undoQuestion, whenLabel } from "./prototype";

// Variant c: Undo is a row at the top of the report, a value with its
// action beside it ("5 cards still here · Undo import"), and its
// confirmation opens in place, inside the row, on the muted background, as
// design.md's rows open their forms. Undone, the row says so and points to
// Recently deleted.

export function UndoRow({
  facts,
  asking,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  facts: UndoFacts;
  asking: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (facts.undoneAt !== null) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border bg-muted/60 p-4 sm:flex-row sm:items-center sm:p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <Undo2 aria-hidden className="size-4" />
        </span>
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Undone {whenLabel(facts.undoneAt)}.</span>{" "}
          <span className="text-muted-foreground">
            Its {cardCount(facts.live)} wait in Recently deleted for 30 days.
          </span>
        </p>
        <Button
          variant="outline"
          className={cn(OUTLINE_PILL, "h-11 w-fit text-foreground no-underline lg:h-10")}
          render={<Link to="/deleted" />}
          nativeButton={false}
        >
          Recently deleted
        </Button>
      </div>
    );
  }
  if (facts.live === 0) return null;
  const { question, lines } = undoQuestion(facts);
  return (
    <div className="flex flex-col rounded-2xl border bg-card shadow-xs">
      <div className="flex min-h-14 items-center gap-3 px-4 py-2 sm:px-5">
        <p className="min-w-0 flex-1">
          <span className="font-medium tabular-nums">{cardCount(facts.live)}</span>{" "}
          <span className="text-muted-foreground">from this import still here</span>
        </p>
        {!asking && (
          <Button variant="ghost" className={cn(PILL, "h-11 shrink-0 px-3 lg:h-9")} onClick={onAsk}>
            <Undo2 aria-hidden />
            Undo import
          </Button>
        )}
      </div>
      {asking && (
        <div
          role="group"
          aria-labelledby="undo-question"
          className="flex flex-col gap-3 rounded-b-2xl border-t bg-muted/60 px-4 py-4 sm:px-5"
        >
          <p id="undo-question" className="font-semibold">
            Undo this import?
          </p>
          <p className="text-[0.95rem] text-muted-foreground">{question}</p>
          {lines.length > 0 && (
            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[0.95rem] text-muted-foreground">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                PILL,
                "h-11 bg-destructive text-primary-foreground hover:bg-destructive/85 lg:h-10",
              )}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy && (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              )}
              {busy ? "Undoing…" : "Undo import"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
