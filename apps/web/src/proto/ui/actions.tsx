// PROTOTYPE (BAN-10): the dialogs behind every folder and deck action on a
// screen (rename, Move…, the clash popup, delete), held in one place so a
// tile's ⋯ menu and a page's own buttons open the same ones.
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  type Clash,
  type Folder,
  type Item,
  type Place,
  countInside,
  countLabel,
  deleteDeck,
  deleteFolder,
  renameFolder,
  useLibrary,
} from "../folders";
import { useMove } from "../use-move";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { ClashDialog, ConfirmFolderDelete, MovePicker, NameDialog } from "./dialogs";

export function useActions(initial?: {
  renaming?: Folder | undefined;
  moving?: { item: Item; name: string } | undefined;
  clash?: Clash | undefined;
  deleting?: Folder | undefined;
}) {
  const lib = useLibrary();
  const navigate = useNavigate();
  const mover = useMove(initial?.clash);
  const [renaming, setRenaming] = useState<Folder | undefined>(initial?.renaming);
  const [moving, setMoving] = useState<{ item: Item; name: string } | undefined>(initial?.moving);
  const [deleting, setDeleting] = useState<Folder | undefined>(initial?.deleting);
  const [deletingDeck, setDeletingDeck] = useState<{ id: string; name: string }>();

  const drop = (item: Item, place: Place) => {
    mover.request(item, place);
  };

  const dialogs = (
    <>
      <NameDialog
        open={renaming !== undefined}
        onOpenChange={(o) => !o && setRenaming(undefined)}
        title="Rename folder"
        submitLabel="Save"
        initial={renaming?.name ?? ""}
        onSubmit={(name) => {
          const outcome = renameFolder(renaming!.id, name);
          if (outcome.ok) setRenaming(undefined);
          return outcome;
        }}
      />
      {moving && (
        <MovePicker
          open
          onOpenChange={(o) => {
            if (!o) {
              setMoving(undefined);
              mover.clearError();
            }
          }}
          item={moving.item}
          itemName={moving.name}
          error={mover.error}
          onMove={(place) => mover.request(moving.item, place, () => setMoving(undefined))}
        />
      )}
      <ClashDialog
        clash={mover.clash}
        onResolve={(choice) => {
          mover.resolve(choice);
          if (choice !== "cancel") setMoving(undefined);
        }}
      />
      <ConfirmFolderDelete
        open={deleting !== undefined}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        name={deleting?.name ?? ""}
        inside={deleting ? countLabel(countInside(lib, deleting.id)) : ""}
        onConfirm={() => {
          const folder = deleting!;
          setDeleting(undefined);
          void navigate(
            folder.parentId === null
              ? { to: "/" }
              : { to: "/folders/$folderId", params: { folderId: folder.parentId } },
          ).then(() => deleteFolder(folder.id));
        }}
      />
      <ConfirmDelete
        open={deletingDeck !== undefined}
        onOpenChange={(o) => !o && setDeletingDeck(undefined)}
        name={deletingDeck?.name ?? ""}
        onConfirm={async () => {
          deleteDeck(deletingDeck!.id);
          setDeletingDeck(undefined);
          return undefined;
        }}
      />
    </>
  );

  return {
    dialogs,
    drop,
    rename: (f: Folder) => setRenaming(f),
    move: (item: Item, name: string) => setMoving({ item, name }),
    removeFolder: (f: Folder) => setDeleting(f),
    removeDeck: (id: string, name: string) => setDeletingDeck({ id, name }),
  };
}
