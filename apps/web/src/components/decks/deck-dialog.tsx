import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { FormError } from "@/components/auth-card";
import { FIELD, Field, OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type DeckOutcome, deckDescriptionProblem, deckNameProblem } from "@/lib/decks";
import { cn } from "@/lib/utils";

export type DeckForm = { name: string; description: string };

/**
 * The create and edit form for a Deck, in a dialog: a sheet from the bottom on
 * phones. `onSubmit` sends the form; a refusal shows under its field, or under
 * the form, keeping what was typed. A success is the caller's to act on.
 */
export function DeckDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  submittingLabel,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  submittingLabel: string;
  initial: DeckForm;
  onSubmit: (form: DeckForm) => Promise<DeckOutcome>;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // A save under way goes through either way, so the form waits for it.
        if (!submitting) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-5 overflow-y-auto rounded-t-[1.5rem] border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl transition-[opacity,translate] data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:pb-6">
          {/* Mounted only while open, so each opening starts from `initial`. */}
          {open && (
            <Body
              title={title}
              submitLabel={submitting ? submittingLabel : submitLabel}
              submitting={submitting}
              initial={initial}
              onSubmit={async (form) => {
                setSubmitting(true);
                try {
                  return await onSubmit(form);
                } finally {
                  setSubmitting(false);
                }
              }}
              onClose={() => onOpenChange(false)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Refusal = Extract<DeckOutcome, { ok: false }>;

function Body({
  title,
  submitLabel,
  submitting,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial: DeckForm;
  onSubmit: (form: DeckForm) => Promise<DeckOutcome>;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [refusal, setRefusal] = useState<Refusal>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    // Checked here rather than cut short by maxLength, which would count the
    // spaces trimming drops.
    const nameProblem = deckNameProblem(name);
    if (nameProblem !== undefined) {
      setRefusal({ ok: false, field: "name", message: nameProblem });
      return;
    }
    const descriptionProblem = deckDescriptionProblem(description);
    if (descriptionProblem !== undefined) {
      setRefusal({ ok: false, field: "form", message: descriptionProblem });
      return;
    }
    const outcome = await onSubmit({ name, description });
    if (!outcome.ok) setRefusal(outcome);
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <Dialog.Title className="text-2xl font-semibold tracking-tight">{title}</Dialog.Title>
        <Dialog.Close
          render={<Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 rounded-full" />}
          aria-label="Close"
          disabled={submitting}
        >
          <X aria-hidden />
        </Dialog.Close>
      </div>
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          value={name}
          required
          autoFocus
          autoComplete="off"
          readOnly={submitting}
          error={refusal?.field === "name" ? refusal.message : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (refusal?.field === "name") setRefusal(undefined);
          }}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={descriptionId} className="text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id={descriptionId}
            rows={4}
            value={description}
            readOnly={submitting}
            onChange={(event) => setDescription(event.target.value)}
            className={cn(
              FIELD,
              "h-auto min-h-24 resize-y border border-input py-3 leading-relaxed outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:h-auto",
            )}
          />
        </div>
      </div>
      {refusal?.field === "form" && <FormError>{refusal.message}</FormError>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className={OUTLINE_PILL}
          disabled={submitting}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button type="submit" className={PILL} disabled={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
