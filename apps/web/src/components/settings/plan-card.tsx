import { Popover } from "@base-ui/react/popover";
import type { StudyDay } from "@banki/shared";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CalendarDays, Check as CheckIcon, LoaderCircle, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { FormError } from "@/components/auth-card";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { FIELD, OUTLINE_PILL, PILL, SettingsCard } from "@/components/settings/parts";
import { PlanCalendar } from "@/components/settings/plan-calendar";
import { Countdown, DayStrip } from "@/components/settings/plan-countdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Deck } from "@/lib/decks";
import {
  NEW_PLAN_MINUTES,
  type Plan,
  type PlanCheck,
  checkText,
  daysBetween,
  deadlineError,
  fieldDate,
  outcomeOf,
  parseMinutes,
  planCheckQueryOptions,
  relativeDays,
  removePlan,
  savePlan,
} from "@/lib/plans";
import { settingsQueryOptions } from "@/lib/settings";
import { todayOf } from "@/lib/study-overview";
import { cn } from "@/lib/utils";

// The Plan card on Deck settings (docs/design.md: a setting made of several
// values that only mean something together is a form). Without a Plan, it
// offers one; Create and Edit open a form in place, which checks the Plan
// live as its fields change; a saved Plan is the Study days left over a strip
// of them ending in the Deadline's flag, checked again each time it shows.

/** How long the fields rest before the check runs. */
export const CHECK_DEBOUNCE_MS = 450;

/** The form's fields as typed: the Deadline picked, if any, and the minutes. */
type Draft = { deadline: StudyDay | undefined; minutes: string };

const FORM = "flex flex-col gap-4 rounded-xl bg-muted p-4";

export function PlanCard({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const { settings } = useSuspenseQuery(settingsQueryOptions()).data;
  const today = todayOf(settings);
  const saved = deck.plan;
  const [draft, setDraft] = useState<Draft>();
  const [removing, setRemoving] = useState(false);

  const open = (minutes?: number) =>
    setDraft(
      saved === null
        ? { deadline: undefined, minutes: String(minutes ?? NEW_PLAN_MINUTES) }
        : { deadline: saved.deadline, minutes: String(minutes ?? saved.dailyMinutes) },
    );

  return (
    <SettingsCard id="plan" title="Plan">
      {draft !== undefined ? (
        <PlanForm
          deckId={deck.id}
          creating={saved === null}
          initial={draft}
          today={today}
          onDone={() => setDraft(undefined)}
        />
      ) : saved === null ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-[0.95rem] text-muted-foreground">
            This deck has no Plan. Give it a deadline, such as an exam day, and the minutes a day
            you mean to study it, and Banki checks whether that covers its new cards in time.
          </p>
          <Button size="lg" className={PILL} onClick={() => open()}>
            Create plan
          </Button>
        </div>
      ) : (
        <SavedPlan
          deckId={deck.id}
          plan={saved}
          today={today}
          onEdit={open}
          onRemove={() => setRemoving(true)}
        />
      )}
      <ConfirmDelete
        open={removing}
        onOpenChange={setRemoving}
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
          const outcome = await removePlan(queryClient, deck.id);
          if (!outcome.ok) return outcome.message;
          setRemoving(false);
          return undefined;
        }}
      />
    </SettingsCard>
  );
}

/** A saved Plan: the countdown to its Deadline, its goal, its check, and Edit and Remove plan. */
function SavedPlan({
  deckId,
  plan,
  today,
  onEdit,
  onRemove,
}: {
  deckId: string;
  plan: Plan;
  today: StudyDay;
  onEdit: (minutes?: number) => void;
  onRemove: () => void;
}) {
  const passed = plan.deadline <= today;
  // Checked afresh each time the card shows, as the Deck's Cards change.
  const check = useQuery({
    ...planCheckQueryOptions(deckId, plan),
    enabled: !passed,
    refetchOnMount: "always",
  });
  return (
    <div className="flex flex-col gap-4">
      <Countdown plan={plan} today={today} />
      <DayStrip days={daysBetween(today, plan.deadline)} />
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{passed ? "" : "Today"}</span>
        <span>
          <span className="font-medium text-foreground">{plan.dailyMinutes} min</span> a day
        </span>
      </div>
      {passed ? (
        <p className="rounded-xl bg-muted p-3.5 text-[0.95rem]">
          Its deadline has passed. Edit it for the next exam, or remove it.
        </p>
      ) : (
        <div aria-live="polite">
          <CheckState
            query={check}
            plan={plan}
            // On a saved Plan, Use N min opens Edit with the goal set.
            onUse={(minutes) => onEdit(minutes)}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="lg" className={OUTLINE_PILL} onClick={() => onEdit()}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className={cn(PILL, "text-destructive hover:text-destructive")}
          onClick={onRemove}
        >
          Remove plan
        </Button>
      </div>
    </div>
  );
}

/** `value`, once it has stayed the same for `ms`. */
function useSettled<T>(value: T, key: string, ms: number): T {
  const [settled, setSettled] = useState({ value, key });
  useEffect(() => {
    if (settled.key === key) return undefined;
    const timer = setTimeout(() => setSettled({ value, key }), ms);
    return () => clearTimeout(timer);
  }, [key, ms, settled.key, value]);
  return settled.key === key ? value : settled.value;
}

/** The Create or Edit form, in place in the card, with the check live below its fields. */
function PlanForm({
  deckId,
  creating,
  initial,
  today,
  onDone,
}: {
  deckId: string;
  creating: boolean;
  initial: Draft;
  today: StudyDay;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [deadline, setDeadline] = useState(initial.deadline);
  const [minutesText, setMinutesText] = useState(initial.minutes);
  // The minutes say what is wrong once they are typed in, or on a save.
  const [touched, setTouched] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const minutesId = useId();
  const deadlineLabel = useId();
  const deadlineNote = useId();

  const minutes = parseMinutes(minutesText);
  const deadlineProblem =
    deadline === undefined
      ? touched
        ? "Pick the day."
        : undefined
      : deadlineError(deadline, today);
  const minutesProblem = touched && "error" in minutes ? minutes.error : undefined;
  const plan: Plan | undefined =
    deadline !== undefined && deadlineError(deadline, today) === undefined && "minutes" in minutes
      ? { deadline, dailyMinutes: minutes.minutes }
      : undefined;
  const planKey = plan === undefined ? "" : `${plan.deadline}/${plan.dailyMinutes}`;
  const settled = useSettled(plan, planKey, CHECK_DEBOUNCE_MS);
  const settledKey = settled === undefined ? "" : `${settled.deadline}/${settled.dailyMinutes}`;
  const check = useQuery({
    ...planCheckQueryOptions(deckId, settled ?? { deadline: "", dailyMinutes: 0 }),
    enabled: settled !== undefined && settledKey === planKey,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (plan === undefined || saving) return;
    setSaving(true);
    setError(undefined);
    const outcome = await savePlan(queryClient, deckId, plan);
    setSaving(false);
    if (outcome.ok) onDone();
    else setError(outcome.message);
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className={FORM}>
      <div className="flex flex-col gap-1.5">
        <span id={deadlineLabel} className="text-sm font-medium">
          Deadline
        </span>
        <Popover.Root open={picking} onOpenChange={setPicking}>
          <Popover.Trigger
            aria-labelledby={deadlineLabel}
            aria-describedby={deadlineNote}
            aria-invalid={deadlineProblem === undefined ? undefined : true}
            className={cn(
              FIELD,
              "flex w-full items-center justify-between gap-2 border border-input text-left outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive",
            )}
          >
            <span className={cn("truncate", deadline === undefined && "text-muted-foreground")}>
              {deadline === undefined ? "Pick the day" : fieldDate(deadline)}
            </span>
            <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={6} align="start" className="z-50">
              <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border bg-popover p-3 text-popover-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
                <PlanCalendar
                  value={deadline}
                  today={today}
                  onPick={(day) => {
                    setDeadline(day);
                    setPicking(false);
                  }}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <p
          id={deadlineNote}
          className={cn(
            "text-sm",
            deadlineProblem === undefined
              ? "text-muted-foreground"
              : "font-medium text-destructive",
          )}
        >
          {deadlineProblem ??
            (deadline === undefined
              ? "The exam day. You study on the days before it."
              : `${relativeDays(deadline, today)}. You study on the days before it.`)}
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
            value={minutesText}
            onChange={(event) => {
              setTouched(true);
              setMinutesText(event.target.value.replace(/[^0-9]/g, ""));
            }}
            aria-invalid={minutesProblem === undefined ? undefined : true}
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
            minutesProblem === undefined ? "text-muted-foreground" : "font-medium text-destructive",
          )}
        >
          {minutesProblem ?? "From 5 to 600."}
        </p>
      </div>
      <div aria-live="polite">
        {plan !== undefined &&
          (settledKey !== planKey ? (
            <Checking />
          ) : (
            <CheckState
              query={check}
              plan={plan}
              onUse={(use) => {
                setTouched(true);
                setMinutesText(String(use));
              }}
            />
          ))}
      </div>
      {error !== undefined && <FormError>{error}</FormError>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" className={PILL} disabled={saving}>
          {saving ? "Saving…" : creating ? "Create plan" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="lg" className={PILL} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Checking() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
      Checking the plan…
    </p>
  );
}

/** A check as it stands: running, failed, or its outcome. */
function CheckState({
  query,
  plan,
  onUse,
}: {
  query: { data: PlanCheck | null | undefined; isError: boolean };
  plan: Plan;
  onUse: (minutes: number) => void;
}) {
  if (query.data === undefined) {
    return query.isError ? (
      <p className="text-sm text-muted-foreground">Banki couldn't check the plan just now.</p>
    ) : (
      <Checking />
    );
  }
  if (query.data === null) return null;
  return <CheckNote check={query.data} plan={plan} onUse={onUse} />;
}

/** The check's outcome: a quiet line when the goal covers the Deck, a callout when it doesn't. */
function CheckNote({
  check,
  plan,
  onUse,
}: {
  check: PlanCheck;
  plan: Plan;
  onUse: (minutes: number) => void;
}) {
  const outcome = outcomeOf(check);
  if (outcome === "covers" || outcome === "none")
    return (
      <p className="flex items-start gap-2 text-[0.95rem]">
        <CheckIcon aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
        {checkText(check, plan)}
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-primary/35 bg-accent p-3.5">
      <p className="flex items-start gap-2.5 text-[0.95rem]">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{checkText(check, plan)}</span>
      </p>
      {check.neededMinutes !== null && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={cn(OUTLINE_PILL, "ml-6.5")}
          onClick={() => onUse(check.neededMinutes ?? 0)}
        >
          Use {check.neededMinutes} min
        </Button>
      )}
    </div>
  );
}
