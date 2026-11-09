import { Popover } from "@base-ui/react/popover";
import { CalendarDays, Minus, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { FIELD, OUTLINE_PILL, PILL, SettingsCard } from "@/components/settings/parts";
import { PlanCalendar } from "@/components/settings/plan-calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Deck } from "@/lib/decks";
import {
  type Check,
  MAX_MINUTES,
  MIN_MINUTES,
  type Plan,
  addDays,
  checkText,
  lastDeadline,
  longDate,
  relativeDays,
  shortDate,
  today,
} from "@/lib/plan-proto";
import { usePlanProto } from "@/lib/use-plan-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-57), Variant c: Coverage. The check is what the card is
// built around: a bar of the Deck's new cards, filled with those the goal
// learns by the Deadline, so a shortfall is a gap you can see. The Plan
// itself is one sentence ("40 min a day until 12 Dec"), and the form picks
// the Deadline from a few spans ahead, or any day from a month.

const FORM = "flex flex-col gap-5 rounded-xl bg-muted p-4 sm:p-5";
const SPANS = [
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
];

export function PlanCard({ deck, state }: { deck: Deck; state: string | undefined }) {
  const plan = usePlanProto(state);
  const { saved, form } = plan;
  return (
    <SettingsCard id="plan" title="Plan">
      {form !== undefined ? (
        <PlanForm plan={plan} creating={saved === null} />
      ) : saved === null ? (
        <div className="flex flex-col gap-4">
          <p className="text-[1.05rem] font-medium">No Plan for this deck.</p>
          <p className="-mt-2 text-[0.95rem] text-muted-foreground">
            A Plan is an exam day and the minutes a day you'll study for it. Banki shows how many of
            the deck's new cards that gets learned in time.
          </p>
          <Button size="lg" className={cn(PILL, "self-start")} onClick={plan.open}>
            Create plan
          </Button>
        </div>
      ) : (
        <SavedPlan plan={plan} saved={saved} />
      )}
      <ConfirmDelete
        open={plan.removing}
        onOpenChange={plan.askRemove}
        name={deck.name}
        title="Remove this plan?"
        description={
          <>
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">
              “{deck.name}”
            </span>{" "}
            will have no deadline or daily goal. Its cards and reviews stay as they are.
          </>
        }
        confirmLabel="Remove plan"
        restorable={false}
        onConfirm={async () => {
          plan.remove();
          return undefined;
        }}
      />
    </SettingsCard>
  );
}

type PlanState = ReturnType<typeof usePlanProto>;

function SavedPlan({ plan, saved }: { plan: PlanState; saved: Plan }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-semibold tracking-tight text-balance">
          {saved.dailyMinutes} min a day{" "}
          <span className="text-muted-foreground">until {shortDate(saved.deadline)}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {plan.passed
            ? "Its deadline has passed."
            : `The deadline is ${relativeDays(saved.deadline)}; you study on the days before it.`}
        </p>
      </div>
      {!plan.passed && plan.savedCheck !== undefined && (
        <Coverage
          result={plan.savedCheck}
          plan={saved}
          onUse={(minutes) => {
            plan.open();
            plan.setMinutes(String(minutes));
          }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="lg" className={OUTLINE_PILL} onClick={plan.open}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className={cn(PILL, "text-destructive hover:text-destructive")}
          onClick={() => plan.askRemove(true)}
        >
          Remove plan
        </Button>
      </div>
    </div>
  );
}

function PlanForm({ plan, creating }: { plan: PlanState; creating: boolean }) {
  const form = plan.form!;
  const deadlineLabel = useId();
  const minutesId = useId();
  const [picking, setPicking] = useState(false);
  const now = today();
  const spanDay = (days: number) => addDays(now, days);
  const fromSpan = SPANS.some((span) => spanDay(span.days) === form.deadline);
  const minutes = Number(form.minutes);
  const nudge = (by: number) =>
    plan.setMinutes(
      String(
        Math.min(
          MAX_MINUTES,
          Math.max(MIN_MINUTES, (Number.isFinite(minutes) ? minutes : 30) + by),
        ),
      ),
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    plan.save();
  };
  const chip =
    "h-11 rounded-full border px-4 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid lg:h-9";
  const on = "border-primary bg-primary text-primary-foreground";
  const off = "border-border bg-card hover:bg-background";

  return (
    <form onSubmit={submit} noValidate className={FORM}>
      <div role="group" aria-labelledby={deadlineLabel} className="flex flex-col gap-2">
        <span id={deadlineLabel} className="text-sm font-medium">
          Deadline
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SPANS.map((span) => (
            <button
              key={span.days}
              type="button"
              aria-pressed={spanDay(span.days) === form.deadline}
              onClick={() => plan.setDeadline(spanDay(span.days))}
              className={cn(chip, spanDay(span.days) === form.deadline ? on : off)}
            >
              In {span.label}
            </button>
          ))}
          <Popover.Root open={picking} onOpenChange={setPicking}>
            <Popover.Trigger
              className={cn(
                chip,
                "inline-flex items-center gap-2",
                form.deadline !== undefined && !fromSpan ? on : off,
                plan.errors.deadline !== undefined && "border-destructive",
              )}
            >
              <CalendarDays aria-hidden className="size-4" />
              {form.deadline !== undefined && !fromSpan ? shortDate(form.deadline) : "A day…"}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={6} align="start" className="z-50">
                <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border bg-popover p-3 text-popover-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
                  <PlanCalendar
                    value={form.deadline}
                    onPick={(day) => {
                      plan.setDeadline(day);
                      setPicking(false);
                    }}
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <p
          className={cn(
            "text-sm",
            plan.errors.deadline === undefined
              ? "text-muted-foreground"
              : "font-medium text-destructive",
          )}
        >
          {plan.errors.deadline ??
            (form.deadline === undefined
              ? `Any day from tomorrow to ${shortDate(lastDeadline(now))} ${lastDeadline(now).slice(0, 4)}.`
              : `${longDate(form.deadline)}, ${relativeDays(form.deadline)}.`)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={minutesId} className="text-sm font-medium">
          Daily goal
        </label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-full lg:size-10"
            aria-label="5 minutes less"
            onClick={() => nudge(-5)}
          >
            <Minus aria-hidden />
          </Button>
          <div className="relative w-32">
            <Input
              id={minutesId}
              inputMode="numeric"
              value={form.minutes}
              onChange={(event) => plan.setMinutes(event.target.value.replace(/[^0-9]/g, ""))}
              aria-invalid={plan.errors.minutes === undefined ? undefined : true}
              aria-describedby={`${minutesId}-note`}
              className={cn(FIELD, "pr-14 text-center text-lg font-semibold tabular-nums")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">
              min
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-full lg:size-10"
            aria-label="5 minutes more"
            onClick={() => nudge(5)}
          >
            <Plus aria-hidden />
          </Button>
          <span className="text-sm whitespace-nowrap text-muted-foreground">a day</span>
        </div>
        <p
          id={`${minutesId}-note`}
          className={cn(
            "text-sm",
            plan.errors.minutes === undefined
              ? "text-muted-foreground"
              : "font-medium text-destructive",
          )}
        >
          {plan.errors.minutes ?? `${MIN_MINUTES} to ${MAX_MINUTES} minutes.`}
        </p>
      </div>
      <div aria-live="polite">
        {plan.draft === undefined || plan.check === undefined || plan.checkedPlan === undefined ? (
          <Coverage result={undefined} plan={undefined} />
        ) : (
          <Coverage
            result={plan.check}
            plan={plan.checkedPlan}
            checking={plan.checking}
            onUse={(value) => plan.setMinutes(String(value))}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" className={PILL}>
          {creating ? "Create plan" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="lg" className={PILL} onClick={plan.cancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The Deck's new cards as one bar, filled with those learned by the
 * Deadline; the rest hatched. Under it, the check's sentence and, when a
 * higher goal would cover them, Use N min. Without a check yet, an empty bar.
 */
function Coverage({
  result,
  plan,
  checking = false,
  onUse,
}: {
  result: Check | undefined;
  plan: Plan | undefined;
  checking?: boolean;
  onUse?: (minutes: number) => void;
}) {
  const HATCH = "repeating-linear-gradient(135deg, var(--muted) 0 6px, var(--border) 6px 12px)";
  if (result === undefined || plan === undefined)
    return (
      <div className="flex flex-col gap-2">
        <div className="h-4 rounded-full border border-dashed border-input/60" />
        <p className="text-sm text-muted-foreground">
          Pick a deadline to see how much of the deck it covers.
        </p>
      </div>
    );
  const total = result.kind === "none" ? 0 : result.newCards;
  const unlearned = result.kind === "covers" || result.kind === "none" ? 0 : result.unlearned;
  const learned = total - unlearned;
  return (
    <div className={cn("flex flex-col gap-2 transition-opacity", checking && "opacity-50")}>
      <div className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
        <span className="font-medium">
          {total === 0 ? "No new cards" : `${learned} of ${total} new cards`}
        </span>
        {total > 0 && <span className="text-muted-foreground">by {shortDate(plan.deadline)}</span>}
      </div>
      <div
        className="flex h-4 overflow-hidden rounded-full border"
        style={{ backgroundImage: HATCH }}
        aria-hidden
      >
        {total > 0 && (
          <div
            className={cn("h-full", unlearned === 0 ? "bg-primary" : "bg-foreground/75")}
            style={{ width: `${(learned / total) * 100}%` }}
          />
        )}
      </div>
      <p className="text-[0.95rem] text-pretty">{checkText(result, plan)}</p>
      {result.kind === "warning" && onUse !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={cn(OUTLINE_PILL, "self-start")}
          onClick={() => onUse(result.neededMinutes)}
        >
          Use {result.neededMinutes} min
        </Button>
      )}
    </div>
  );
}
