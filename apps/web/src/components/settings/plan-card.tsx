import { Popover } from "@base-ui/react/popover";
import { CalendarDays, Check as CheckIcon, LoaderCircle, TriangleAlert } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { FIELD, OUTLINE_PILL, PILL, SettingsCard } from "@/components/settings/parts";
import { PlanCalendar } from "@/components/settings/plan-calendar";
import { Countdown, DayStrip } from "@/components/settings/plan-countdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Deck } from "@/lib/decks";
import {
  type Check,
  MAX_MINUTES,
  MIN_MINUTES,
  type Plan,
  checkText,
  daysBetween,
  relativeDays,
  today,
} from "@/lib/plan-proto";
import { usePlanProto } from "@/lib/use-plan-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-57), Variant e: the Countdown throughout. Variant d, a's
// card with b's saved Plan (the Study days left in large type over a strip of
// them ending in the Deadline's flag), and the same Countdown at the top of
// the form, following the Deadline as it is picked, so the form shows the
// Plan it will save. With no Plan, or no Deadline yet, the strip is an outline.

/** "Sat 12 Dec 2026". */
const fieldDate = (day: string) =>
  new Date(`${day}T00:00:00Z`)
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .replace(",", "");

const FORM = "flex flex-col gap-4 rounded-xl bg-muted p-4";

export function PlanCard({ deck, state }: { deck: Deck; state: string | undefined }) {
  const plan = usePlanProto(state);
  const { saved, form } = plan;
  return (
    <SettingsCard id="plan" title="Plan">
      {form !== undefined ? (
        <PlanForm plan={plan} creating={saved === null} />
      ) : saved === null ? (
        <div className="flex flex-col items-start gap-4">
          <div className="self-stretch">
            <DayStrip days={undefined} />
          </div>
          <p className="text-[0.95rem] text-muted-foreground">
            This deck has no Plan. Give it a deadline, such as an exam day, and the minutes a day
            you mean to study it, and Banki checks whether that covers its new cards in time.
          </p>
          <Button size="lg" className={PILL} onClick={plan.open}>
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
      <Countdown plan={saved} passed={plan.passed} />
      <DayStrip days={daysBetween(today(), saved.deadline)} passed={plan.passed} />
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
          <CheckNote
            result={plan.savedCheck}
            plan={saved}
            // On a saved Plan, Use N min opens Edit with the goal set.
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

/** The Countdown the form will save, or an outline until it has a Deadline. */
function FormCountdown({ deadline }: { deadline: string | undefined }) {
  if (deadline === undefined)
    return (
      <div className="flex flex-col gap-2">
        <p className="flex items-baseline gap-2 text-muted-foreground">
          <span className="text-5xl leading-none font-semibold tracking-[-0.04em]">–</span>
          <span className="text-lg">days left</span>
        </p>
        <DayStrip days={undefined} />
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <Countdown plan={{ deadline, dailyMinutes: 0 }} passed={false} />
      <DayStrip days={daysBetween(today(), deadline)} />
    </div>
  );
}

function PlanForm({ plan, creating }: { plan: PlanState; creating: boolean }) {
  const form = plan.form!;
  const minutesId = useId();
  const deadlineLabel = useId();
  const [picking, setPicking] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    plan.save();
  };
  return (
    <form onSubmit={submit} noValidate className={FORM}>
      <FormCountdown deadline={plan.errors.deadline === undefined ? form.deadline : undefined} />
      <div className="grid gap-4">
        <div className="flex flex-col gap-1.5">
          <span id={deadlineLabel} className="text-sm font-medium">
            Deadline
          </span>
          <Popover.Root open={picking} onOpenChange={setPicking}>
            <Popover.Trigger
              aria-labelledby={deadlineLabel}
              aria-invalid={plan.errors.deadline === undefined ? undefined : true}
              className={cn(
                FIELD,
                "flex w-full items-center justify-between gap-2 border border-input text-left outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive",
              )}
            >
              <span
                className={cn("truncate", form.deadline === undefined && "text-muted-foreground")}
              >
                {form.deadline === undefined ? "Pick the day" : fieldDate(form.deadline)}
              </span>
              <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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
                ? "The exam day. You study on the days before it."
                : `${relativeDays(form.deadline)[0]!.toUpperCase()}${relativeDays(form.deadline).slice(1)}. You study on the days before it.`)}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={minutesId} className="text-sm font-medium">
            Daily goal
          </label>
          <div className="relative">
            <Input
              id={minutesId}
              inputMode="numeric"
              value={form.minutes}
              onChange={(event) => plan.setMinutes(event.target.value.replace(/[^0-9]/g, ""))}
              aria-invalid={plan.errors.minutes === undefined ? undefined : true}
              aria-describedby={`${minutesId}-note`}
              className={cn(FIELD, "pr-24 tabular-nums")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-muted-foreground">
              min a day
            </span>
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
            {plan.errors.minutes ?? `From ${MIN_MINUTES} to ${MAX_MINUTES}.`}
          </p>
        </div>
      </div>
      <div aria-live="polite">
        {plan.draft === undefined ? null : plan.checking ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle
              aria-hidden
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Checking the plan…
          </p>
        ) : (
          plan.check !== undefined &&
          plan.checkedPlan !== undefined && (
            <CheckNote
              result={plan.check}
              plan={plan.checkedPlan}
              onUse={(minutes) => plan.setMinutes(String(minutes))}
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

/** The check's outcome: a quiet line when the goal covers the Deck, a callout when it doesn't. */
function CheckNote({
  result,
  plan,
  onUse,
}: {
  result: Check;
  plan: Plan;
  onUse: (minutes: number) => void;
}) {
  if (result.kind === "covers" || result.kind === "none")
    return (
      <p className="flex items-start gap-2 text-[0.95rem]">
        <CheckIcon aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
        {checkText(result, plan)}
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-primary/35 bg-accent p-3.5">
      <p className="flex items-start gap-2.5 text-[0.95rem]">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{checkText(result, plan)}</span>
      </p>
      {result.kind === "warning" && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={cn(OUTLINE_PILL, "ml-6.5")}
          onClick={() => onUse(result.neededMinutes)}
        >
          Use {result.neededMinutes} min
        </Button>
      )}
    </div>
  );
}
