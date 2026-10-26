// One place: Home (the Root) or a Folder's page. Under the title (and, on a
// Folder's page, the breadcrumb and the Folder's own Rename, Move… and Delete),
// a toolbar holds the sort, New folder and New deck; then the place's Folders,
// as kraft folders (Normal) or rows (Compact, the Folder style on Settings),
// and its Decks as paper stacks.
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, CornerDownRight, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DeckDialog } from "@/components/decks/deck-dialog";
import { DeckTile } from "@/components/decks/deck-tile";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { useDeckSort } from "@/lib/deck-sort";
import { type DeckSort, createDeck, sortItems } from "@/lib/decks";
import { type Folder, ROOT_NAME, contentsOf, createFolder } from "@/lib/folders";
import { useFolderStyle } from "@/lib/folder-style";
import { cn } from "@/lib/utils";
import { Breadcrumb } from "./breadcrumb";
import { NameDialog } from "./dialogs";
import { FolderRow, FolderTile } from "./folder-tile";
import { usePlaceActions } from "./place-actions";
import { useLibrary } from "./use-library";

export function PlaceView({ folder }: { folder: Folder | null }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const library = useLibrary();
  const [sort, setSort] = useDeckSort();
  const [style] = useFolderStyle();
  const place = folder?.id ?? null;
  const contents = contentsOf(library, place);
  const folders = sortItems(contents.folders, sort);
  const decks = sortItems(contents.decks, sort);
  const [newFolder, setNewFolder] = useState(false);
  const [newDeck, setNewDeck] = useState(false);
  const actions = usePlaceActions(library);
  const empty = folders.length === 0 && decks.length === 0;

  return (
    <Page width="cards">
      <div className="flex flex-col gap-8 lg:gap-10">
        <header className="flex flex-col gap-5">
          {folder !== null && <Breadcrumb library={library} at={folder.id} onMove={actions.drop} />}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <h1 className="min-w-0 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
              {folder?.name ?? ROOT_NAME}
            </h1>
            {folder !== null && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11")}
                  onClick={() => actions.rename(folder)}
                >
                  <Pencil aria-hidden />
                  Rename
                </Button>
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11")}
                  onClick={() => actions.move({ kind: "folder", id: folder.id })}
                >
                  <CornerDownRight aria-hidden />
                  Move…
                </Button>
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11 text-destructive hover:text-destructive")}
                  onClick={() => actions.removeFolder(folder)}
                >
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              </div>
            )}
          </div>
          {!empty && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
              <SortSwitch value={sort} onChange={setSort} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11")}
                  onClick={() => setNewFolder(true)}
                >
                  <FolderPlus aria-hidden />
                  New folder
                </Button>
                <Button className={cn(PILL, "h-11")} onClick={() => setNewDeck(true)}>
                  <Plus aria-hidden />
                  New deck
                </Button>
              </div>
            </div>
          )}
        </header>

        {empty ? (
          <Empty
            inFolder={folder !== null}
            onFolder={() => setNewFolder(true)}
            onDeck={() => setNewDeck(true)}
          />
        ) : (
          <>
            {folders.length > 0 && (
              <Group title="Folders" rows={style === "compact"}>
                {folders.map((f) => {
                  const Tile = style === "compact" ? FolderRow : FolderTile;
                  return (
                    <li key={f.id} className="flex">
                      <Tile
                        folder={f}
                        library={library}
                        onMove={actions.drop}
                        actions={[
                          {
                            label: "Rename",
                            icon: <Pencil aria-hidden />,
                            onClick: () => actions.rename(f),
                          },
                          {
                            label: "Move…",
                            icon: <CornerDownRight aria-hidden />,
                            onClick: () => actions.move({ kind: "folder", id: f.id }),
                          },
                          {
                            label: "Delete",
                            icon: <Trash2 aria-hidden />,
                            danger: true,
                            onClick: () => actions.removeFolder(f),
                          },
                        ]}
                      />
                    </li>
                  );
                })}
              </Group>
            )}
            {decks.length > 0 && (
              <Group title="Decks">
                {decks.map((d) => (
                  <li key={d.id} className="flex">
                    <DeckTile
                      deck={d}
                      actions={[
                        {
                          label: "Move…",
                          icon: <CornerDownRight aria-hidden />,
                          onClick: () => actions.move({ kind: "deck", id: d.id }),
                        },
                        {
                          label: "Delete",
                          icon: <Trash2 aria-hidden />,
                          danger: true,
                          onClick: () => actions.removeDeck(d),
                        },
                      ]}
                    />
                  </li>
                ))}
              </Group>
            )}
          </>
        )}
        {folder === null && <RecentlyDeletedLink />}
      </div>

      <NameDialog
        open={newFolder}
        onOpenChange={setNewFolder}
        title="New folder"
        submitLabel="Create folder"
        submittingLabel="Creating…"
        initial=""
        onSubmit={async (name) => {
          const outcome = await createFolder(queryClient, { name, parentId: place });
          if (outcome.ok) setNewFolder(false);
          return outcome;
        }}
      />
      <DeckDialog
        open={newDeck}
        onOpenChange={setNewDeck}
        title="New deck"
        submitLabel="Create deck"
        submittingLabel="Creating…"
        initial={{ name: "", description: "" }}
        onSubmit={async (form) => {
          const outcome = await createDeck(queryClient, { ...form, folderId: place });
          if (outcome.ok) {
            setNewDeck(false);
            await navigate({ to: "/decks/$deckId", params: { deckId: outcome.deck.id } });
          }
          return outcome;
        }}
      />
      {actions.dialogs}
    </Page>
  );
}

function Group({
  title,
  rows = false,
  children,
}: {
  title: string;
  rows?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      <ul
        className={
          rows
            ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
            : "grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-6 sm:gap-y-9 lg:grid-cols-3"
        }
      >
        {children}
      </ul>
    </section>
  );
}

const SORTS: { value: DeckSort; label: string }[] = [
  { value: "alphabetical", label: "A–Z" },
  { value: "newest", label: "Newest" },
];

/** Alphabetical or Newest: two choices, so both stay in view. */
function SortSwitch({ value, onChange }: { value: DeckSort; onChange: (s: DeckSort) => void }) {
  return (
    <div role="radiogroup" aria-label="Sort" className="flex rounded-full border bg-card p-1">
      {SORTS.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={value === s.value}
          aria-label={s.value === "alphabetical" ? "Alphabetical" : "Newest"}
          onClick={() => onChange(s.value)}
          className="h-11 min-w-20 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-checked:bg-foreground aria-checked:text-background motion-reduce:transition-none lg:h-8"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function Empty({
  inFolder,
  onFolder,
  onDeck,
}: {
  inFolder: boolean;
  onFolder: () => void;
  onDeck: () => void;
}) {
  return (
    <section
      aria-labelledby="place-empty"
      className="flex flex-col items-center gap-6 rounded-[1.25rem] border-2 border-dashed border-input/60 px-6 py-12 text-center sm:py-16"
    >
      <div aria-hidden className="relative flex h-24 w-32 flex-col">
        <span className="h-4 w-14 rounded-t-lg border border-b-0 border-dashed border-input" />
        <span className="-mt-px flex flex-1 items-center justify-center rounded-tr-xl rounded-b-xl border border-dashed border-input bg-card">
          <Plus className="size-6 text-muted-foreground" />
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <h2 id="place-empty" className="text-2xl font-semibold tracking-tight">
          {inFolder ? "This folder is empty" : "No decks yet"}
        </h2>
        <p className="max-w-sm text-balance text-muted-foreground">
          {inFolder
            ? "Make a deck here, or a folder to sort decks into further."
            : "A deck holds the cards for one thing you're learning. Folders keep decks in order."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" className={cn(OUTLINE_PILL, "h-11")} onClick={onFolder}>
          <FolderPlus aria-hidden />
          New folder
        </Button>
        <Button className={cn(PILL, "h-11")} onClick={onDeck}>
          <Plus aria-hidden />
          New deck
        </Button>
      </div>
    </section>
  );
}

/**
 * Prototype only (BAN-13, Variant b): Recently deleted is reached from the
 * foot of Home, a quiet row under the Decks, with how many Deletions wait.
 */
function RecentlyDeletedLink() {
  return (
    <Link
      to="/deleted"
      className="group flex items-center gap-3 self-start rounded-full border border-dashed px-4 py-2.5 text-sm text-muted-foreground no-underline transition-colors outline-none hover:border-solid hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none"
    >
      <Trash2 aria-hidden className="size-4" />
      <span>
        <span className="font-medium text-foreground">Recently deleted</span> · 9 waiting
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}
