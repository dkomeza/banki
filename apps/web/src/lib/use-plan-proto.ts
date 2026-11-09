import { useEffect, useState } from "react";
import {
  type Check,
  type Day,
  NEW_PLAN_MINUTES,
  type Plan,
  check,
  deadlineProblem,
  minutesProblem,
  startOf,
  today,
} from "@/lib/plan-proto";

// PROTOTYPE (BAN-57): the Plan card's state, in memory: the saved Plan, the
// form while it is open, and the check, run on the fields as they change
// (debounced, once both are valid) and on the saved Plan when the card shows.

export type Form = { deadline: Day | undefined; minutes: string };

const DEBOUNCE_MS = 450;

export function usePlanProto(state: string | undefined) {
  const [start] = useState(() => startOf(state));
  const [saved, setSaved] = useState<Plan | null>(start.saved);
  const [form, setForm] = useState<Form | undefined>(start.form);
  const [removing, setRemoving] = useState(start.removing ?? false);
  // A state shows its field errors at once; a fresh form only once touched.
  const [touched, setTouched] = useState(state === "invalid");
  const empty = start.empty ?? false;

  const minutes = form === undefined ? undefined : Number(form.minutes);
  const errors = {
    deadline: form === undefined ? undefined : deadlineProblem(form.deadline),
    minutes: form === undefined || !touched ? undefined : minutesProblem(minutes),
  };
  const draft: Plan | undefined =
    form?.deadline !== undefined &&
    deadlineProblem(form.deadline) === undefined &&
    minutesProblem(minutes) === undefined
      ? { deadline: form.deadline, dailyMinutes: minutes ?? NEW_PLAN_MINUTES }
      : undefined;

  const [draftCheck, setDraftCheck] = useState<{ plan: Plan; result: Check }>();
  const draftKey = draft === undefined ? "" : `${draft.deadline}/${draft.dailyMinutes}`;
  useEffect(() => {
    if (draft === undefined) return undefined;
    // A state opens with its check already in.
    const wait = draftCheck === undefined && state !== undefined ? 0 : DEBOUNCE_MS;
    const timer = setTimeout(
      () => setDraftCheck({ plan: draft, result: empty ? { kind: "none" } : check(draft) }),
      wait,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const current = draft !== undefined && draftCheck !== undefined ? draftCheck : undefined;
  const checking =
    draft !== undefined &&
    (current === undefined ||
      current.plan.deadline !== draft.deadline ||
      current.plan.dailyMinutes !== draft.dailyMinutes);

  const savedCheck: Check | undefined =
    saved === null ? undefined : empty ? { kind: "none" } : check(saved);
  const passed = saved !== null && saved.deadline <= today();

  return {
    saved,
    form,
    errors,
    draft,
    check: current?.result,
    checkedPlan: current?.plan,
    checking,
    savedCheck,
    passed,
    removing,
    open: () => {
      setTouched(false);
      setForm(
        saved === null
          ? { deadline: undefined, minutes: String(NEW_PLAN_MINUTES) }
          : {
              deadline: passed ? undefined : saved.deadline,
              minutes: String(saved.dailyMinutes),
            },
      );
    },
    setDeadline: (deadline: Day) => setForm((f) => (f === undefined ? f : { ...f, deadline })),
    setMinutes: (value: string) => {
      setTouched(true);
      setForm((f) => (f === undefined ? f : { ...f, minutes: value }));
    },
    cancel: () => setForm(undefined),
    save: () => {
      setTouched(true);
      if (draft === undefined) return;
      setSaved(draft);
      setForm(undefined);
    },
    askRemove: setRemoving,
    remove: () => {
      setSaved(null);
      setRemoving(false);
    },
  };
}
