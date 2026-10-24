// PROTOTYPE (BAN-11): Variant b's create and edit form, in a dialog.
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Result } from "@/proto/decks";
import { DeckFields } from "@/proto/deck-fields";

export function DeckDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  initialError,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initial: { name: string; description: string };
  initialError?: string;
  onSubmit: (name: string, description: string) => Result;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-5 overflow-y-auto rounded-t-[1.5rem] border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl transition-[opacity,translate] data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:pb-6">
          {open && (
            <Body
              title={title}
              submitLabel={submitLabel}
              initial={initial}
              initialError={initialError}
              onSubmit={onSubmit}
              onClose={() => onOpenChange(false)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({
  title,
  submitLabel,
  initial,
  initialError,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial: { name: string; description: string };
  initialError: string | undefined;
  onSubmit: (name: string, description: string) => Result;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [error, setError] = useState(initialError);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = onSubmit(name, description);
    if (!result.ok) setError(result.error);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <Dialog.Title className="text-2xl font-semibold tracking-tight">{title}</Dialog.Title>
        <Dialog.Close
          render={<Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 rounded-full" />}
          aria-label="Close"
        >
          <X aria-hidden />
        </Dialog.Close>
      </div>
      <DeckFields
        name={name}
        description={description}
        onName={(v) => {
          setName(v);
          setError(undefined);
        }}
        onDescription={setDescription}
        error={error}
        autoFocus
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className={OUTLINE_PILL} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className={PILL}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
