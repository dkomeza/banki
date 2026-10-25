// PROTOTYPE (BAN-10): the dialogs the folder screens open: name a folder,
// create or edit a deck, delete a folder, the Move… picker and the clash popup.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Check, CornerDownRight, Folder as FolderIcon, Layers, X } from "lucide-react";
import { type FormEvent, type ReactNode, type Ref, useRef, useState } from "react";
import { FormError } from "@/components/auth-card";
import { Field, OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type Clash,
  type Item,
  type Place,
  type Result,
  cantMoveTo,
  treeRows,
  useLibrary,
} from "../folders";

export const BACKDROP =
  "fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50";
/** A sheet from the bottom on phones, a centred dialog from 640 px. */
export const SHEET =
  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-5 overflow-y-auto rounded-t-[1.5rem] border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl transition-[opacity,translate] data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:pb-6";
export const CENTRED =
  "fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none";

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <Dialog.Title className="text-2xl font-semibold tracking-tight">{title}</Dialog.Title>
        {children}
      </div>
      <Dialog.Close
        render={<Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 rounded-full" />}
        aria-label="Close"
      >
        <X aria-hidden />
      </Dialog.Close>
    </div>
  );
}

/** Names a new folder, or renames one: one field, a taken name refused under it. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initial: string;
  onSubmit: (name: string) => Result;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={SHEET}>
          {open && (
            <NameForm
              title={title}
              submitLabel={submitLabel}
              initial={initial}
              onSubmit={onSubmit}
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
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial: string;
  onSubmit: (name: string) => Result;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const outcome = onSubmit(name);
    if (!outcome.ok) setError(outcome.error);
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <Head title={title} />
      <Field
        label="Name"
        value={name}
        required
        autoFocus
        autoComplete="off"
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          setError(undefined);
        }}
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

/** Asks before a folder is deleted, naming it and what goes with it. */
export function ConfirmFolderDelete({
  open,
  onOpenChange,
  name,
  inside,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  inside: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Popup className={CENTRED}>
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            Delete this folder?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">“{name}”</span>
            {inside === "" ? (
              " will be deleted. It's empty."
            ) : (
              <>
                {" "}
                and the <span className="font-medium text-foreground">{inside}</span> in it will be
                deleted.
              </>
            )}
          </AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button variant="outline" className={OUTLINE_PILL} />}>
              Cancel
            </AlertDialog.Close>
            <Button
              className={cn(PILL, "bg-destructive text-primary-foreground hover:bg-destructive/85")}
              onClick={onConfirm}
            >
              Delete folder
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * The Move… picker: the whole folder tree, "Decks" on top, every level shown.
 * The item's current place, the item itself and anything inside it can't be
 * picked. Picking a place and pressing Move sends the move.
 */
export function MovePicker({
  open,
  onOpenChange,
  item,
  itemName,
  onMove,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Item;
  itemName: string;
  onMove: (place: Place) => void;
  error?: string | undefined;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={SHEET}>
          {open && (
            <PickerBody
              item={item}
              itemName={itemName}
              onMove={onMove}
              onClose={() => onOpenChange(false)}
              error={error}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PickerBody({
  item,
  itemName,
  onMove,
  onClose,
  error,
}: {
  item: Item;
  itemName: string;
  onMove: (place: Place) => void;
  onClose: () => void;
  error?: string | undefined;
}) {
  const lib = useLibrary();
  const rows = treeRows(lib);
  const [picked, setPicked] = useState<Place | undefined>();
  return (
    <div className="flex flex-col gap-5">
      <Head title={`Move ${item.kind === "deck" ? "deck" : "folder"}`}>
        <Dialog.Description className="line-clamp-2 text-[0.95rem] text-muted-foreground [overflow-wrap:anywhere]">
          Where should “{itemName}” go?
        </Dialog.Description>
      </Head>
      <ul
        role="listbox"
        aria-label="Folders"
        className="-mx-2 flex max-h-[min(24rem,50svh)] flex-col gap-0.5 overflow-y-auto rounded-xl border bg-background p-1.5 dark:bg-input/10"
      >
        {rows.map((row) => {
          const why = cantMoveTo(lib, item, row.place);
          const selected = picked === row.place;
          return (
            <li key={row.place ?? "root"}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={why !== undefined}
                disabled={why !== undefined}
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
        <Button type="button" variant="outline" className={OUTLINE_PILL} onClick={onClose}>
          Cancel
        </Button>
        <Button
          className={PILL}
          disabled={picked === undefined}
          onClick={() => picked !== undefined && onMove(picked)}
        >
          <CornerDownRight aria-hidden />
          {picked === undefined ? "Move" : `Move to ${rows.find((r) => r.place === picked)?.name}`}
        </Button>
      </div>
    </div>
  );
}

/**
 * The clash popup, Explorer-style: something of the same kind and name is at
 * the destination already. Each choice is a row saying what it does.
 */
export function ClashDialog({
  clash,
  onResolve,
}: {
  clash: Clash | undefined;
  onResolve: (choice: "replace" | "keepBoth" | "cancel") => void;
}) {
  const kind = clash?.item.kind ?? "deck";
  // Keep both, the choice that loses nothing, has the focus first.
  const keepBoth = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={clash !== undefined} onOpenChange={(o) => !o && onResolve("cancel")}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Popup
          initialFocus={keepBoth}
          className={cn(CENTRED, "w-[min(32rem,calc(100vw-2.5rem))]")}
        >
          {clash && (
            <>
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">
                “{clash.destinationName}” already has a {kind} named “{clash.existing.name}”
              </AlertDialog.Title>
              <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
                Two {kind}s beside each other can't share a name. What should happen to “
                {clash.itemName}”?
              </AlertDialog.Description>
              <div className="flex flex-col gap-2">
                <Choice
                  ref={keepBoth}
                  title="Keep both"
                  detail={`Moves this one in as “${clash.keepBothName}”.`}
                  onClick={() => onResolve("keepBoth")}
                />
                {clash.replaceAllowed && (
                  <Choice
                    title={`Replace the ${kind} there`}
                    detail={
                      kind === "folder" && clash.existing.inside !== ""
                        ? `Deletes the other “${clash.existing.name}” and the ${clash.existing.inside} in it.`
                        : `Deletes the other “${clash.existing.name}”.`
                    }
                    danger
                    onClick={() => onResolve("replace")}
                  />
                )}
              </div>
              {!clash.replaceAllowed && (
                <p className="text-sm text-muted-foreground">
                  Replace isn't offered: the other folder holds this one.
                </p>
              )}
              <div className="flex justify-end">
                <AlertDialog.Close render={<Button variant="outline" className={OUTLINE_PILL} />}>
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
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  title: string;
  detail: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full flex-col gap-0.5 rounded-xl border px-4 py-3 text-left outline-none transition-colors hover:border-primary/60 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none"
    >
      <span className={cn("font-medium", danger && "text-destructive")}>{title}</span>
      <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>
    </button>
  );
}
