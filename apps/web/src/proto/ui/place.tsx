// PROTOTYPE (BAN-10), Variant f: one place, Home (the root) or a folder's
// page. Normal is Variant a: kraft folders and paper stacks in one grid.
// Compact turns both into rows, folders then decks, so a long list fits.
import { useNavigate } from "@tanstack/react-router";
import { CornerDownRight, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DeckDialog } from "@/components/decks/deck-dialog";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { useDeckSort } from "@/lib/deck-sort";
import type { DeckSort } from "@/lib/decks";
import { cn } from "@/lib/utils";
import {
  type Clash,
  type Folder,
  contentsOf,
  createDeck,
  createFolder,
  folderClashFixture,
  protoDeck,
  sortItems,
  useLibrary,
} from "../folders";
import { useActions } from "./actions";
import { useFolderStyle } from "../style";
import { NameDialog } from "./dialogs";
import { DeckRow, FolderRow } from "./rows";
import { Breadcrumb, DeckTile, FolderTile, folderActions } from "./tiles";

const SEED_ROOT_DECK = "5eed0000-0000-4000-8000-000000000004";
const LANGUAGES = "5eed0000-0000-4000-8000-0000000000f1";

export function PlaceView({ folder, state }: { folder: Folder | null; state: string | undefined }) {
  const lib = useLibrary();
  const navigate = useNavigate();
  const [sort, setSort] = useDeckSort();
  const compact = useFolderStyle() === "compact";
  const place = folder?.id ?? null;
  const empty = state === "empty";
  const contents = empty ? { folders: [], decks: [] } : contentsOf(lib, place);
  const subfolders = sortItems(contents.folders, sort);
  const decks = sortItems(contents.decks, sort);
  const [newFolder, setNewFolder] = useState(state === "new-folder");
  const [newDeck, setNewDeck] = useState(false);
  const clash: Clash | undefined =
    state === "clash" && folder ? folderClashFixture(folder) : undefined;
  const actions = useActions({
    renaming: state === "rename" && folder ? folder : undefined,
    moving:
      state === "move" && folder
        ? { item: { kind: "folder", id: folder.id }, name: folder.name }
        : undefined,
    clash,
    deleting: state === "delete" && folder ? folder : undefined,
  });
  const drag = state === "drag" && folder === null;
  const nothing = subfolders.length === 0 && decks.length === 0;

  return (
    <Page width="cards">
      <div className="flex flex-col gap-8 lg:gap-10">
        <header className="flex flex-col gap-5">
          {folder && <Breadcrumb at={folder.id} onMove={actions.drop} />}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <h1 className="min-w-0 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
              {folder?.name ?? "Decks"}
            </h1>
            {folder && (
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
                  onClick={() => actions.move({ kind: "folder", id: folder.id }, folder.name)}
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
          {!nothing && (
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

        {nothing ? (
          <Empty
            inFolder={folder !== null}
            onFolder={() => setNewFolder(true)}
            onDeck={() => setNewDeck(true)}
          />
        ) : (
          <>
            {subfolders.length > 0 && (
              <Group title="Folders" rows={compact}>
                {subfolders.map((f) => (
                  <li key={f.id} className="flex">
                    {compact ? (
                      <FolderRow
                        folder={f}
                        onMove={actions.drop}
                        forceOver={drag && f.id === LANGUAGES}
                        ghost={
                          drag && f.id === LANGUAGES
                            ? lib.decks.find((d) => d.id === SEED_ROOT_DECK)?.name
                            : undefined
                        }
                        actions={folderActions(f, {
                          rename: actions.rename,
                          move: actions.move,
                          remove: actions.removeFolder,
                        })}
                      />
                    ) : (
                      <FolderTile
                        folder={f}
                        onMove={actions.drop}
                        forceOver={drag && f.id === LANGUAGES}
                        ghost={
                          drag && f.id === LANGUAGES
                            ? lib.decks.find((d) => d.id === SEED_ROOT_DECK)?.name
                            : undefined
                        }
                        actions={folderActions(f, {
                          rename: actions.rename,
                          move: actions.move,
                          remove: actions.removeFolder,
                        })}
                      />
                    )}
                  </li>
                ))}
              </Group>
            )}
            {decks.length > 0 && (
              <Group title="Decks" rows={compact}>
                {decks.map((d) => (
                  <li key={d.id} className="flex">
                    {compact ? (
                      <DeckRow
                        deck={d}
                        lifted={drag && d.id === SEED_ROOT_DECK}
                        actions={[
                          {
                            label: "Move…",
                            icon: <CornerDownRight aria-hidden />,
                            onClick: () => actions.move({ kind: "deck", id: d.id }, d.name),
                          },
                          {
                            label: "Delete",
                            icon: <Trash2 aria-hidden />,
                            danger: true,
                            onClick: () => actions.removeDeck(d.id, d.name),
                          },
                        ]}
                      />
                    ) : (
                      <DeckTile
                        deck={d}
                        lifted={drag && d.id === SEED_ROOT_DECK}
                        actions={[
                          {
                            label: "Move…",
                            icon: <CornerDownRight aria-hidden />,
                            onClick: () => actions.move({ kind: "deck", id: d.id }, d.name),
                          },
                          {
                            label: "Delete",
                            icon: <Trash2 aria-hidden />,
                            danger: true,
                            onClick: () => actions.removeDeck(d.id, d.name),
                          },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </Group>
            )}
          </>
        )}
      </div>

      <NameDialog
        open={newFolder}
        onOpenChange={setNewFolder}
        title="New folder"
        submitLabel="Create folder"
        initial=""
        onSubmit={(name) => {
          const outcome = createFolder(name, place);
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
          const outcome = createDeck(form.name, form.description, place);
          if (!outcome.ok) return { ok: false, field: "name", message: outcome.error };
          setNewDeck(false);
          await navigate({ to: "/decks/$deckId", params: { deckId: outcome.id } });
          return { ok: true, deck: protoDeck(outcome.id, form) };
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
            ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
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
