import type { GradeResponse } from "@banki/shared";
import { MessageCircleQuestion, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardText } from "@/components/cards/card-text";
import { LABEL } from "@/components/study/answer";
import { Composer, ComposerHint, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { type ChatMessage, requestedState, useChat } from "@/components/study/chat-proto";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant j, "Ask at the spot": a question is about a
// spot, so it is asked there. Under your answer, each point the Grader made
// (each mistake, each part missing from yours) is a row with its note and
// "Ask about this", and a last row takes anything else about the Card. Asking
// opens the input right under that row, and its questions and replies stay
// there, as a thread under the point, like comments in a document's margin.
// It is still one chat to the Grader: each question carries its point, and
// the replies see every thread. Nothing floats, and the screen keeps BAN-40's
// layout: the threads only push the Back down.

// Only `chat-empty` opens with the input focused; a tap on Ask focuses it too.
const FOCUS_STATE = requestedState() === "chat-empty";

type Point = { key: string; kind: "mistake" | "missing" | "card"; label: string; text: string };

/** The Grader's points, in the order the eye meets them: mistakes in yours, then what yours misses. */
function pointsOf(result: GradeResponse, back: string): Point[] {
  return [
    ...result.mistakes.map((m, n) => ({
      key: `mistake-${n}`,
      kind: "mistake" as const,
      label: `Mistake ${n + 1}`,
      text: m.note,
    })),
    ...result.missing.map((m, n) => ({
      key: `missing-${n}`,
      kind: "missing" as const,
      label: "Missing from yours",
      text: back.slice(m.from, m.to),
    })),
  ];
}

/** Under your answer: the points, each with its own thread, and one for the rest. */
export function AskPoints({ result, back }: { result: GradeResponse; back: string }) {
  const [chat, , live] = useChat();
  if (!live) return null;
  const points = pointsOf(result, back);
  const card: Point = {
    key: "card",
    kind: "card",
    label: "Anything else",
    text: "Ask about this card as a whole.",
  };
  return (
    <section aria-label="Ask about the grade" className="flex flex-col gap-2">
      <h2 className={cn(LABEL, "flex items-center gap-2")}>
        <MessageCircleQuestion aria-hidden className="size-3.5 text-primary" />
        Ask the Grader
      </h2>
      <ol className="flex flex-col overflow-hidden rounded-xl border bg-card">
        {[...points, card].map((point, i) => (
          <PointRow
            key={point.key}
            point={point}
            first={i === 0}
            messages={chat.messages.filter((m) => m.about === point.key)}
          />
        ))}
      </ol>
      <p className="px-1 text-xs text-muted-foreground">
        One chat with the Grader, under the point each question is about. It never changes the
        suggestion.
      </p>
    </section>
  );
}

function PointRow({
  point,
  first,
  messages,
}: {
  point: Point;
  first: boolean;
  messages: ChatMessage[];
}) {
  const [chat, actions] = useChat();
  const asking = chat.asking === point.key;
  const [tapped, setTapped] = useState(false);
  const input = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (asking && tapped) input.current?.scrollIntoView({ block: "nearest" });
  }, [asking, tapped]);
  const count = messages.filter((m) => m.role === "user").length;
  return (
    <li className={cn("flex flex-col", !first && "border-t")}>
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            point.kind === "mistake" && "bg-destructive",
            point.kind === "missing" && "border border-dashed border-primary bg-primary/20",
            point.kind === "card" && "border border-muted-foreground/50",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "text-xs font-semibold",
              point.kind === "mistake" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {point.label}
          </span>
          <CardText
            text={point.text}
            className={cn(
              "text-sm leading-relaxed",
              point.kind === "card" && "text-muted-foreground",
            )}
          />
        </div>
        {!asking && (
          <Button
            variant="ghost"
            className="-mr-2 h-11 shrink-0 gap-1.5 rounded-full px-3 text-sm text-primary hover:text-primary lg:h-8"
            onClick={() => {
              setTapped(true);
              actions.open(point.key);
            }}
          >
            {count > 0 ? (
              `Reply · ${count}`
            ) : (
              <span>
                Ask<span className="max-sm:hidden"> about this</span>
              </span>
            )}
          </Button>
        )}
      </div>
      {(messages.length > 0 || asking) && (
        <div className="ml-3 flex flex-col gap-4 border-l-2 border-primary/25 pr-3 pb-4 pl-3 sm:ml-[1.3rem] sm:pr-4 sm:pl-5">
          {messages.map((message) => (
            <Message key={message.id} message={message} actions={actions} />
          ))}
          {asking && (
            <>
              <LongChatAdvice chat={chat} />
              <div ref={input} className="flex scroll-mb-40 flex-col gap-1.5">
                <div className="flex items-end gap-1">
                  <Composer
                    chat={chat}
                    actions={actions}
                    autoFocus={FOCUS_STATE || tapped}
                    placeholder={point.kind === "card" ? "Ask about this card…" : "Your question…"}
                    className="flex-1 bg-background"
                  />
                  <Button
                    variant="ghost"
                    className="size-11 shrink-0 rounded-full text-muted-foreground lg:size-9"
                    onClick={actions.close}
                    aria-label="Close the question"
                    title="Close"
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </div>
                <ComposerHint className="px-1" />
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
