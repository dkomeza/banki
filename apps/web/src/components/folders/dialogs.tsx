// The dialogs a place opens for its Folders and Decks: naming a Folder, the
// Move… picker and the clash popup. Deleting asks with ConfirmDelete.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Check, CornerDownRight, Folder as FolderIcon, Layers, X } from "lucide-react";
import { type FormEvent, type ReactNode, type Ref, useRef, useState } from "react";
import { FormError } from "@/components/auth-card";
import { Field, OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type Clash,
  type FolderOutcome,
  type Item,
  type Library,
  type Place,
  cantMoveTo,
  folderNameProblem,
  treeRows,
} from "@/lib/folders";
import { cn } from "@/lib/utils";

export const BACKDROP =
  "fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50";
/** A sheet from the bottom on phones, a centred dialog from 640 px, as DeckDialog is. */
export const SHEET =
  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-5 overflow-y-auto rounded-t-[1.5rem] border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl transition-[opacity,translate] data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:pb-6";
const CENTRED =
  "fixed top-1/2 left-1/2 z-50 flex w-[min(32rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none";

export function Head({
  title,
  busy,
  children,
}: {
  title: string;
  busy: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Dialog.Title className="text-2xl font-semibold tracking-tight">{title}</Dialog.Title>
        {children}
      </div>
      <Dialog.Close
        render={<Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 rounded-full" />}
        aria-label="Close"
        disabled={busy}
      >
        <X aria-hidden />
      </Dialog.Close>
    </div>
  );
}

/**
 * Names a new Folder, or renames one: one field, with a taken name refused
 * under it, keeping what was typed. A success is the caller's to act on.
 */
export function NameDialog({
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
  initial: string;
  onSubmit: (name: string) => Promise<FolderOutcome>;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={SHEET}>
          {/* Mounted only while open, so each opening starts from `initial`. */}
          {open && (
            <NameForm
              title={title}
              submitLabel={submitting ? submittingLabel : submitLabel}
              submitting={submitting}
              initial={initial}
              onSubmit={async (name) => {
                setSubmitting(true);
                try {
                  return await onSubmit(name);
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

function NameForm({
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
  initial: string;
  onSubmit: (name: string) => Promise<FolderOutcome>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [refusal, setRefusal] = useState<Extract<FolderOutcome, { ok: false }>>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const problem = folderNameProblem(name);
    if (problem !== undefined) {
      setRefusal({ ok: false, field: "name", message: problem });
      return;
    }
    const outcome = await onSubmit(name);
    if (!outcome.ok) setRefusal(outcome);
  };
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <Head title={title} busy={submitting} />
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

/**
 * The Move… picker: the whole folder tree, "Decks" (the Root) on top. The
 * item's current place, the item itself and anything inside it can't be
 * picked. Picking a place and pressing Move sends the move.
 */
export function MovePicker({
  library,
  moving,
  busy,
  error,
  onMove,
  onClose,
}: {
  library: Library;
  moving: { item: Item; name: string } | undefined;
  busy: boolean;
  error: string | undefined;
  onMove: (place: Place) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={moving !== undefined}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={SHEET}>
          {moving !== undefined && (
            <PickerBody
              library={library}
              item={moving.item}
              name={moving.name}
              busy={busy}
              error={error}
              onMove={onMove}
              onClose={onClose}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PickerBody({
  library,
  item,
  name,
  busy,
  error,
  onMove,
  onClose,
}: {
  library: Library;
  item: Item;
  name: string;
  busy: boolean;
  error: string | undefined;
  onMove: (place: Place) => void;
  onClose: () => void;
}) {
  const rows = treeRows(library.folders);
  const [picked, setPicked] = useState<Place | undefined>();
  const pickedName = rows.find((row) => row.place === picked)?.name;
  return (
    <div className="flex flex-col gap-5">
      <Head title={item.kind === "deck" ? "Move deck" : "Move folder"} busy={busy}>
        <Dialog.Description className="line-clamp-2 text-[0.95rem] text-muted-foreground [overflow-wrap:anywhere]">
          Where should “{name}” go?
        </Dialog.Description>
      </Head>
      <ul
        role="listbox"
        aria-label="Folders"
        className="-mx-2 flex max-h-[min(24rem,50svh)] flex-col gap-0.5 overflow-y-auto rounded-xl border bg-background p-1.5 dark:bg-input/10"
      >
        {rows.map((row) => {
          const why = cantMoveTo(library, item, row.place);
          const selected = picked === row.place;
          return (
            <li key={row.place ?? "root"}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={why !== undefined}
                disabled={why !== undefined || busy}
                onClick={() => setPicked(row.place)}
                style={{ paddingLeft: `${0.75 + row.depth * 1.25}rem` }}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg pr-3 text-left text-[0.95rem] outline-none hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent aria-selected:bg-accent aria-selected:font-medium lg:min-h-9"
              >
                {row.place === null ? (
                  <Layers aria-hidden className="size-4 shrink-0" />
                ) : (
                  <FolderIcon aria-hidden className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {why === "current" && (
                  <span className="shrink-0 text-xs text-muted-foreground">Here now</span>
                )}
                {why === "self" && (
                  <span className="shrink-0 text-xs text-muted-foreground">This folder</span>
                )}
                {selected && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
              </button>
            </li>
          );
        })}
      </ul>
      {error !== undefined && <FormError>{error}</FormError>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className={OUTLINE_PILL}
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className={cn(PILL, "min-w-0")}
          disabled={picked === undefined || busy}
          onClick={() => picked !== undefined && onMove(picked)}
        >
          <CornerDownRight aria-hidden />
          <span className="truncate">
            {busy ? "Moving…" : pickedName === undefined ? "Move" : `Move to ${pickedName}`}
          </span>
        </Button>
      </div>
    </div>
  );
}

/** A clash as the popup shows it: the move, and what's in the way. */
export type ClashPrompt = {
  kind: Item["kind"];
  itemName: string;
  destinationName: string;
  clash: Clash;
  /** What the clashing Folder holds, in words ("3 decks"), or "". */
  inside: string;
  keepBothName: string;
};

/**
 * The clash popup, Explorer-style: something of the same kind and name is at
 * the destination already. Each choice is a row saying what it does, Keep
 * both first: it loses nothing, so it has the focus, and Enter never deletes.
 */
export function ClashDialog({
  prompt,
  busy,
  onResolve,
}: {
  prompt: ClashPrompt | undefined;
  busy: boolean;
  onResolve: (choice: "replace" | "keepBoth" | "cancel") => void;
}) {
  const keepBoth = useRef<HTMLButtonElement>(null);
  const kind = prompt?.kind ?? "deck";
  return (
    <AlertDialog.Root
      open={prompt !== undefined}
      onOpenChange={(open) => {
        if (!open && !busy) onResolve("cancel");
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Popup initialFocus={keepBoth} className={CENTRED}>
          {prompt !== undefined && (
            <>
              <AlertDialog.Title className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                “{prompt.destinationName}” already has a {kind} named “{prompt.clash.name}”
              </AlertDialog.Title>
              <AlertDialog.Description className="text-[0.95rem] text-muted-foreground [overflow-wrap:anywhere]">
                Two {kind}s beside each other can't share a name. What should happen to “
                {prompt.itemName}”?
              </AlertDialog.Description>
              <div className="flex flex-col gap-2">
                <Choice
                  ref={keepBoth}
                  title="Keep both"
                  detail={`Moves this one in as “${prompt.keepBothName}”.`}
                  disabled={busy}
                  onClick={() => onResolve("keepBoth")}
                />
                {prompt.clash.replaceAllowed && (
                  <Choice
                    title={`Replace the ${kind} there`}
                    detail={
                      prompt.inside === ""
                        ? `Deletes the other “${prompt.clash.name}”.`
                        : `Deletes the other “${prompt.clash.name}” and the ${prompt.inside} in it.`
                    }
                    danger
                    disabled={busy}
                    onClick={() => onResolve("replace")}
                  />
                )}
              </div>
              {!prompt.clash.replaceAllowed && (
                <p className="text-sm text-muted-foreground">
                  Replace isn't offered: the other folder holds this one.
                </p>
              )}
              <div className="flex justify-end">
                <AlertDialog.Close
                  render={<Button variant="outline" className={OUTLINE_PILL} disabled={busy} />}
                >
                  Cancel
                </AlertDialog.Close>
              </div>
            </>
          )}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function Choice({
  ref,
  title,
  detail,
  danger = false,
  disabled,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  title: string;
  detail: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-14 w-full flex-col gap-0.5 rounded-xl border px-4 py-3 text-left outline-none transition-colors hover:border-primary/60 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid disabled:opacity-60 motion-reduce:transition-none"
    >
      <span className={cn("font-medium", danger && "text-destructive")}>{title}</span>
      <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>
    </button>
  );
}

/** Says a move went wrong, when no picker is open to say it in (a drop). */
export function MoveFailed({
  message,
  onClose,
}: {
  message: string | undefined;
  onClose: () => void;
}) {
  return (
    <AlertDialog.Root open={message !== undefined} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Popup className={cn(CENTRED, "w-[min(28rem,calc(100vw-2.5rem))]")}>
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            Couldn't move it
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
            {message}
          </AlertDialog.Description>
          <div className="flex justify-end">
            <AlertDialog.Close render={<Button className={PILL} />}>OK</AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
