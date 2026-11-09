import { Flag, LoaderCircle, TriangleAlert } from "lucide-react";
import { type FormEvent, useId } from "react";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { OUTLINE_PILL, PILL, SettingsCard } from "@/components/settings/parts";
import { PlanCalendar } from "@/components/settings/plan-calendar";
import { Stepper } from "@/components/settings/stepper";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import {
  type Check,
  MAX_MINUTES,
  MIN_MINUTES,
  type Plan,
  checkText,
  daysBetween,
  longDate,
  shortDate,
  today,
} from "@/lib/plan-proto";
import { usePlanProto } from "@/lib/use-plan-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-57), Variant b: Countdown. The Plan is a count of the Study
// days left, with a strip of them, one segment a day, ending in the Deadline's
// flag. The form keeps a month open in the card, with the days you'd study on
// shaded up to the picked one, and sets the goal with a stepper and a few
// common amounts. The check reads under the strip as one sentence.

const FORM = "flex flex-col gap-5 rounded-xl bg-muted p-4 sm:p-5";
const RANGE = { min: MIN_MINUTES, max: MAX_MINUTES, step: 5 };
const QUICK = [15, 30, 45, 60, 90];

export function PlanCard({ deck, state }: { deck: Deck; state: string | undefined }) {
  const plan = usePlanProto(state);
  const { saved, form } = plan;
  return (
    <SettingsCard id="plan" title="Plan">
      {form !== undefined ? (
        <PlanForm plan={plan} creating={saved === null} />
      ) : saved === null ? (
        <div className="flex flex-col gap-4">
          <DayStrip days={undefined} />
          <p className="text-[0.95rem] text-muted-foreground">
            No Plan yet. Pick the day of the exam and the minutes a day you'll give this deck, and
            Banki checks whether that's enough for its new cards.
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

/** The count of Study days left, in large type, and what it counts to. */
function Countdown({ saved, passed }: { saved: Plan; passed: boolean }) {
  const days = daysBetween(today(), saved.deadline);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <p className="flex items-baseline gap-2">
        <span className="text-5xl leading-none font-semibold tracking-[-0.04em] tabular-nums">
          {passed ? "0" : days}
        </span>
        <span className="text-lg text-muted-foreground">
          {passed ? "days left" : days === 1 ? "day left" : "days left"}
        </span>
      </p>
      <p className="text-[0.95rem]">
        <span className="text-muted-foreground">to </span>
        <span className="font-medium">{longDate(saved.deadline)}</span>
      </p>
    </div>
  );
}

/**
 * The Study days up to the Deadline, today first, one segment each, and the
 * Deadline's flag at the end. More than 70 days run together into one bar.
 */
function DayStrip({ days, passed = false }: { days: number | undefined; passed?: boolean }) {
  if (days === undefined || passed)
    return (
      <div className="flex items-center gap-2" aria-hidden>
        <div
          className={cn(
            "h-3 flex-1 rounded-full border border-dashed",
            passed && "border-solid bg-muted",
          )}
        />
        <Flag className="size-4 text-muted-foreground" />
      </div>
    );
  const many = days > 70;
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className={cn("flex h-3 flex-1", many ? "gap-0" : "gap-[2px]")}>
        {many ? (
          <div className="flex-1 rounded-full bg-primary/25">
            <div className="h-full w-1 rounded-full bg-primary" />
          </div>
        ) : (
          Array.from({ length: days }, (_, index) => (
            <div
              key={index}
              className={cn(
                "flex-1 first:rounded-l-full last:rounded-r-full",
                index === 0 ? "bg-primary" : "bg-primary/25",
              )}
            />
          ))
        )}
      </div>
      <Flag className="size-4 text-primary" />
    </div>
  );
}

function SavedPlan({ plan, saved }: { plan: PlanState; saved: Plan }) {
  const days = daysBetween(today(), saved.deadline);
  return (
    <div className="flex flex-col gap-4">
      <Countdown saved={saved} passed={plan.passed} />
      <DayStrip days={days} passed={plan.passed} />
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{plan.passed ? "" : "Today"}</span>
        <span>
          <span className="font-medium text-foreground">{saved.dailyMinutes} min</span> a day
        </span>
      </div>
      {plan.passed ? (
        <p className="rounded-xl bg-muted p-3.5 text-[0.95rem]">
          Its deadline has passed. Edit it for the next exam, or remove it.
        </p>
      ) : (
        plan.savedCheck !== undefined && (
          <Verdict
            result={plan.savedCheck}
            plan={saved}
            onUse={(minutes) => {
              plan.open();
              plan.setMinutes(String(minutes));
            }}
          />
        )
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
  const goalLabel = useId();
  const goalNote = useId();
  const minutes = Number(form.minutes);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    plan.save();
  };
  return (
    <form onSubmit={submit} noValidate className={FORM}>
      <fieldset className="flex flex-col gap-2">
        <legend id={deadlineLabel} className="mb-1 text-sm font-medium">
          Deadline
        </legend>
        <p className="text-[1.05rem] font-medium">
          {form.deadline === undefined ? (
            <span className="text-muted-foreground">Pick the exam day</span>
          ) : (
            longDate(form.deadline)
          )}
        </p>
        <PlanCalendar
          value={form.deadline}
          onPick={plan.setDeadline}
          span
          className="rounded-xl border bg-card p-2 sm:p-3"
        />
        {plan.errors.deadline !== undefined && (
          <p className="text-sm font-medium text-destructive">{plan.errors.deadline}</p>
        )}
      </fieldset>
      <div className="flex flex-col gap-2">
        <span id={goalLabel} className="text-sm font-medium">
          Daily goal, in minutes
        </span>
        <Stepper
          value={Number.isFinite(minutes) ? minutes : MIN_MINUTES}
          range={RANGE}
          onStep={(value) => plan.setMinutes(String(value))}
          name={{ fewer: "5 minutes less", more: "5 minutes more" }}
          labelledBy={goalLabel}
          describedBy={goalNote}
        />
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((quick) => (
            <button
              key={quick}
              type="button"
              aria-pressed={quick === minutes}
              onClick={() => plan.setMinutes(String(quick))}
              className={cn(
                "h-11 min-w-14 rounded-full border px-3 text-sm tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid lg:h-8",
                quick === minutes
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-background",
              )}
            >
              {quick} min
            </button>
          ))}
        </div>
        <p
          id={goalNote}
          className={cn(
            "text-sm",
            plan.errors.minutes === undefined
              ? "text-muted-foreground"
              : "font-medium text-destructive",
          )}
        >
          {plan.errors.minutes ?? "A goal, not a limit: nothing stops a session at it."}
        </p>
      </div>
      <div aria-live="polite">
        {plan.draft === undefined ? null : plan.checking ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle
              aria-hidden
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Checking…
          </p>
        ) : (
          plan.check !== undefined &&
          plan.checkedPlan !== undefined && (
            <Verdict
              result={plan.check}
              plan={plan.checkedPlan}
              onUse={(value) => plan.setMinutes(String(value))}
            />
          )
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
 * The check as one sentence: ink when the goal covers the Deck, with a bar of
 * the new cards it learns in time when it doesn't, and Use N min beside it.
 */
function Verdict({
  result,
  plan,
  onUse,
}: {
  result: Check;
  plan: Plan;
  onUse: (minutes: number) => void;
}) {
  if (result.kind === "covers" || result.kind === "none")
    return <p className="text-[0.95rem]">{checkText(result, plan)}</p>;
  const learned = result.newCards - result.unlearned;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2.5 text-[0.95rem]">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{checkText(result, plan)}</span>
      </p>
      <div className="flex flex-col gap-1" aria-hidden>
        <div className="flex h-2 overflow-hidden rounded-full bg-border">
          <div
            className="bg-foreground/70"
            style={{ width: `${(learned / result.newCards) * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {learned} learned by {shortDate(plan.deadline)}
          </span>
          <span>~{result.unlearned} not</span>
        </div>
      </div>
      {result.kind === "warning" && (
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
