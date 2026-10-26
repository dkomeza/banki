import type { OnClash } from "@banki/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { type Deck, deleteDeck, forgetDeck } from "@/lib/decks";
import {
  type Folder,
  type Item,
  type Library,
  type Place,
  countInside,
  countLabel,
  deleteFolder,
  keepBothName,
  moveItem,
  placeName,
  refreshLibrary,
  renameFolder,
} from "@/lib/folders";
import { type ClashPrompt, ClashDialog, MoveFailed, MovePicker, NameDialog } from "./dialogs";

/** Where a place's page is: Home for the Root, else the Folder's page. */
export const placeRoute = (place: Place) =>
  place === null
    ? ({ to: "/" } as const)
    : ({ to: "/folders/$folderId", params: { folderId: place } } as const);

/**
 * Everything a screen can do to its Folders and Decks besides creating them:
 * rename, Move… (and moving by a drop), the clash popup, and delete. A tile's
 * ⋯ menu and a page's own buttons open the same dialogs, which `dialogs` holds.
 */
export function usePlaceActions(library: Library) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState<Folder>();
  const [moving, setMoving] = useState<{ item: Item; name: string }>();
  const [clash, setClash] = useState<{ item: Item; destination: Place; prompt: ClashPrompt }>();
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string>();
  const [dropError, setDropError] = useState<string>();
  const [deletingFolder, setDeletingFolder] = useState<Folder>();
  const [deletingDeck, setDeletingDeck] = useState<Deck>();

  const nameOf = (item: Item) =>
    (item.kind === "deck" ? library.decks : library.folders).find((x) => x.id === item.id)?.name ??
    "";

  /** Sends a move; a clash opens the popup, which sends it again with the User's choice. */
  const send = async (item: Item, destination: Place, onClash?: OnClash) => {
    const fromPicker = moving !== undefined;
    setBusy(true);
    const outcome = await moveItem(queryClient, item, destination, onClash);
    setBusy(false);
    if (outcome.ok) {
      setClash(undefined);
      setMoving(undefined);
      setPickerError(undefined);
      return;
    }
    if ("clash" in outcome) {
      const itemName = nameOf(item);
      setClash({
        item,
        destination,
        prompt: {
          kind: item.kind,
          itemName,
          destinationName: placeName(library.folders, destination),
          clash: outcome.clash,
          inside: item.kind === "folder" ? countLabel(countInside(library, outcome.clash.id)) : "",
          keepBothName: keepBothName(library, item.kind, destination, itemName),
        },
      });
      return;
    }
    setClash(undefined);
    if (fromPicker) setPickerError(outcome.message);
    else setDropError(outcome.message);
  };

  const deletingCount = deletingFolder && countLabel(countInside(library, deletingFolder.id));

  const dialogs = (
    <>
      <NameDialog
        open={renaming !== undefined}
        onOpenChange={(open) => !open && setRenaming(undefined)}
        title="Rename folder"
        submitLabel="Save"
        submittingLabel="Saving…"
        initial={renaming?.name ?? ""}
        onSubmit={async (name) => {
          const outcome = await renameFolder(queryClient, renaming?.id ?? "", name);
          if (outcome.ok) setRenaming(undefined);
          return outcome;
        }}
      />
      <MovePicker
        library={library}
        moving={moving}
        busy={busy}
        error={pickerError}
        onMove={(place) => moving !== undefined && void send(moving.item, place)}
        onClose={() => {
          setMoving(undefined);
          setPickerError(undefined);
        }}
      />
      <ClashDialog
        prompt={clash?.prompt}
        busy={busy}
        onResolve={(choice) => {
          if (clash === undefined) return;
          if (choice === "cancel") setClash(undefined);
          else void send(clash.item, clash.destination, choice);
        }}
      />
      <MoveFailed message={dropError} onClose={() => setDropError(undefined)} />
      <ConfirmDelete
        open={deletingFolder !== undefined}
        onOpenChange={(open) => !open && setDeletingFolder(undefined)}
        name={deletingFolder?.name ?? ""}
        title="Delete this folder?"
        confirmLabel="Delete folder"
        description={
          <>
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">
              “{deletingFolder?.name}”
            </span>
            {deletingCount ? (
              <>
                {" "}
                and the <span className="font-medium text-foreground">{deletingCount}</span> in it
                will be deleted.
              </>
            ) : (
              " will be deleted. It's empty."
            )}
          </>
        }
        onConfirm={async () => {
          const folder = deletingFolder;
          if (folder === undefined) return undefined;
          const outcome = await deleteFolder(folder.id);
          if (!outcome.ok) return outcome.message;
          setDeletingFolder(undefined);
          // Its parent first, so its own page doesn't turn into "Folder not found".
          await navigate(placeRoute(folder.parentId));
          await refreshLibrary(queryClient);
          return undefined;
        }}
      />
      <ConfirmDelete
        open={deletingDeck !== undefined}
        onOpenChange={(open) => !open && setDeletingDeck(undefined)}
        name={deletingDeck?.name ?? ""}
        onConfirm={async () => {
          const deck = deletingDeck;
          if (deck === undefined) return undefined;
          const outcome = await deleteDeck(queryClient, deck.id);
          if (!outcome.ok) return outcome.message;
          setDeletingDeck(undefined);
          forgetDeck(queryClient, deck.id);
          return undefined;
        }}
      />
    </>
  );

  return {
    dialogs,
    /** Moves what was dropped on a place there. */
    drop: (item: Item, place: Place) => void send(item, place),
    rename: (folder: Folder) => setRenaming(folder),
    move: (item: Item) => setMoving({ item, name: nameOf(item) }),
    removeFolder: (folder: Folder) => setDeletingFolder(folder),
    removeDeck: (deck: Deck) => setDeletingDeck(deck),
  };
}
