// PROTOTYPE (BAN-10), Variant a: a folder is a kraft folder with a tab, the
// tops of its decks' cards sticking out of it, so it reads as a thing that
// holds decks rather than as one more stack. Decks keep BAN-11's paper stacks.
// Each tile has a ⋯ menu, and drags with a mouse or trackpad.
import { Menu } from "@base-ui/react/menu";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CornerDownRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Cover, Stack, monogram } from "@/components/decks/cover";
import { Button } from "@/components/ui/button";
import { createdLabel } from "@/lib/decks";
import { cn } from "@/lib/utils";
import {
  type Deck,
  type Folder,
  type Item,
  type Place,
  contentsOf,
  countInside,
  countLabel,
  pathTo,
  sortItems,
  useFinePointer,
  useLibrary,
} from "../folders";
import { dragSource, useDropTarget } from "../use-move";

export type MenuAction = { label: string; icon: ReactNode; danger?: boolean; onClick: () => void };

export function TileMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className="rounded-full bg-card/85 text-muted-foreground shadow-xs backdrop-blur hover:text-foreground lg:opacity-0 lg:group-hover/tile:opacity-100 lg:focus-visible:opacity-100 lg:aria-expanded:opacity-100"
          />
        }
      >
        <Ellipsis aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className="min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {actions.map((a) => (
              <Menu.Item
                key={a.label}
                onClick={a.onClick}
                className={cn(
                  "flex h-11 cursor-default items-center gap-2.5 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-muted lg:h-9 [&_svg]:size-4",
                  a.danger && "text-destructive",
                )}
              >
                {a.icon}
                {a.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const TAB = "bg-[oklch(0.86_0.045_75)] dark:bg-[oklch(0.36_0.035_65)]";
const BODY = "bg-[oklch(0.9_0.04_78)] dark:bg-[oklch(0.33_0.03_65)]";

export function FolderTile({
  folder,
  onMove,
  actions,
  forceOver = false,
  ghost,
}: {
  folder: Folder;
  onMove: (item: Item, place: Place) => void;
  actions: MenuAction[];
  forceOver?: boolean;
  ghost?: string | undefined;
}) {
  const lib = useLibrary();
  const fine = useFinePointer();
  const drop = useDropTarget(folder.id, onMove);
  const over = drop.over || forceOver;
  const inside = contentsOf(lib, folder.id);
  // Subfolders peek out as smaller kraft folders, decks as index cards.
  const peek = [
    ...sortItems(inside.folders, "alphabetical").map((f) => ({ ...f, folder: true })),
    ...sortItems(inside.decks, "alphabetical").map((d) => ({ ...d, folder: false })),
  ].slice(0, 3);
  const count = countLabel(countInside(lib, folder.id));
  return (
    <div className="group/tile relative flex w-full" {...drop.props}>
      <Link
        to="/folders/$folderId"
        params={{ folderId: folder.id }}
        {...dragSource({ kind: "folder", id: folder.id }, fine)}
        className="group flex w-full flex-col gap-4 rounded-2xl text-foreground no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <span
          className={cn(
            "relative isolate flex aspect-[4/3] w-full flex-col transition-transform motion-reduce:transition-none lg:aspect-[16/10]",
            over && "scale-[1.03]",
          )}
        >
          {/* The tab, then the back of the folder. */}
          <span
            aria-hidden
            className={cn(
              "h-[14%] w-[42%] rounded-t-xl border border-b-0 border-black/10 dark:border-white/10",
              TAB,
            )}
          />
          <span
            aria-hidden
            className={cn(
              "relative -mt-px flex-1 rounded-tr-2xl rounded-b-2xl border border-black/10 dark:border-white/10",
              TAB,
            )}
          >
            {/* The decks' cards sticking out of the folder's mouth. */}
            <span className="absolute inset-x-[8%] top-[9%] bottom-0 flex items-start justify-center gap-[5%]">
              {peek.map((d, i) => (
                <span
                  key={d.id}
                  style={{ rotate: `${(i - (peek.length - 1) / 2) * 4}deg` }}
                  className={cn(
                    "flex h-[70%] w-[30%] items-start justify-start truncate rounded-md border px-2 pt-1.5 text-xs font-semibold tracking-tight text-foreground/70 shadow-xs transition-transform group-hover:-translate-y-1 motion-reduce:transition-none sm:text-sm",
                    d.folder
                      ? cn(TAB, "rounded-tl-none border-black/15 dark:border-white/15")
                      : "bg-card",
                  )}
                >
                  {d.folder ? d.name : monogram(d.name)}
                </span>
              ))}
            </span>
            {/* The front of the folder, lower than the back. */}
            <span
              className={cn(
                "absolute inset-x-0 bottom-0 flex h-[62%] items-end rounded-2xl border border-black/10 p-3 shadow-[0_-1px_0_oklch(1_0_0/0.35)_inset] transition-colors motion-reduce:transition-none sm:p-4 dark:border-white/10",
                BODY,
                over &&
                  "border-primary bg-[color-mix(in_oklch,var(--primary)_18%,oklch(0.9_0.04_78))] dark:bg-[color-mix(in_oklch,var(--primary)_22%,oklch(0.33_0.03_65))]",
              )}
            >
              <span className="text-xs font-medium text-foreground/70 tabular-nums sm:text-sm">
                {over ? "Drop to move here" : count === "" ? "Empty" : count}
              </span>
            </span>
          </span>
          {ghost !== undefined && <DragGhost name={ghost} />}
        </span>
        <span className="flex flex-col gap-1 px-0.5 pt-1">
          <span className="line-clamp-2 leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] group-hover:underline group-hover:underline-offset-4 sm:text-[1.05rem]">
            {folder.name}
          </span>
          <span className="text-sm text-muted-foreground">Folder</span>
        </span>
      </Link>
      <div className="absolute top-[11%] right-2 sm:right-3">
        <TileMenu label={`More for ${folder.name}`} actions={actions} />
      </div>
    </div>
  );
}

/** The deck being dragged, as the pointer carries it over a folder (the `drag` state). */
function DragGhost({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-[38%] left-[34%] z-10 flex w-[58%] rotate-[-4deg] flex-col overflow-hidden rounded-xl border-2 border-primary bg-card shadow-2xl"
    >
      <Cover name={name} className="aspect-[16/9] w-full text-3xl" />
      <span className="truncate border-t px-2.5 py-1.5 text-xs font-semibold">{name}</span>
    </span>
  );
}

export function DeckTile({
  deck,
  actions,
  lifted = false,
}: {
  deck: Deck;
  actions: MenuAction[];
  lifted?: boolean;
}) {
  const fine = useFinePointer();
  return (
    <div className={cn("group/tile relative flex w-full", lifted && "opacity-35")}>
      <Link
        to="/decks/$deckId"
        params={{ deckId: deck.id }}
        {...dragSource({ kind: "deck", id: deck.id }, fine)}
        className="group flex w-full flex-col gap-4 rounded-2xl text-foreground no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <Stack className="aspect-[4/3] w-full lg:aspect-[16/10]">
          <Cover
            name={deck.name}
            className={cn(
              "w-full rounded-2xl border text-5xl transition-[border-color,translate] group-hover:-translate-y-1 group-hover:border-primary/50 motion-reduce:transition-none sm:text-6xl",
              lifted && "border-dashed border-primary",
            )}
          />
        </Stack>
        <span className="flex flex-col gap-1 px-0.5 pt-1">
          <span className="line-clamp-2 leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] group-hover:underline group-hover:underline-offset-4 sm:text-[1.05rem]">
            {deck.name}
          </span>
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {deck.description ?? `Created ${createdLabel(deck.createdAt)}`}
          </span>
        </span>
      </Link>
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3">
        <TileMenu label={`More for ${deck.name}`} actions={actions} />
      </div>
    </div>
  );
}

/** One breadcrumb item, a drop target for moving something up. */
function Crumb({
  place,
  name,
  onMove,
}: {
  place: Place;
  name: string;
  onMove: (item: Item, place: Place) => void;
}) {
  const drop = useDropTarget(place, onMove);
  return (
    <span {...drop.props} className="contents">
      {place === null ? (
        <Link
          to="/"
          className={cn(
            "inline-flex h-11 items-center rounded-md px-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground hover:underline lg:h-8",
            drop.over && "bg-accent text-foreground ring-2 ring-primary",
          )}
        >
          {name}
        </Link>
      ) : (
        <Link
          to="/folders/$folderId"
          params={{ folderId: place }}
          className={cn(
            "inline-flex h-11 max-w-48 items-center truncate rounded-md px-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground hover:underline lg:h-8",
            drop.over && "bg-accent text-foreground ring-2 ring-primary",
          )}
        >
          <span className="truncate">{name}</span>
        </Link>
      )}
    </span>
  );
}

/** "Decks › Maths › Analysis": every item but the last links to its place. */
export function Breadcrumb({
  at,
  last,
  onMove,
}: {
  at: Place;
  last?: string;
  onMove: (item: Item, place: Place) => void;
}) {
  const lib = useLibrary();
  const path = pathTo(lib, at);
  const linked = last === undefined ? path.slice(0, -1) : path;
  const current = last ?? path.at(-1)?.name;
  return (
    <nav aria-label="Breadcrumb" className="-ml-1">
      <ol className="flex flex-wrap items-center gap-x-0.5 text-sm">
        <li className="flex items-center">
          <Crumb place={null} name="Decks" onMove={onMove} />
        </li>
        {linked.map((f) => (
          <li key={f.id} className="flex min-w-0 items-center">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
            <Crumb place={f.id} name={f.name} onMove={onMove} />
          </li>
        ))}
        <li className="flex min-w-0 items-center">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span aria-current="page" className="truncate px-1 font-medium text-foreground">
            {current}
          </span>
        </li>
      </ol>
    </nav>
  );
}

export const folderActions = (
  folder: Folder,
  on: {
    rename: (f: Folder) => void;
    move: (i: Item, name: string) => void;
    remove: (f: Folder) => void;
  },
): MenuAction[] => [
  { label: "Rename", icon: <Pencil aria-hidden />, onClick: () => on.rename(folder) },
  {
    label: "Move…",
    icon: <CornerDownRight aria-hidden />,
    onClick: () => on.move({ kind: "folder", id: folder.id }, folder.name),
  },
  { label: "Delete", icon: <Trash2 aria-hidden />, danger: true, onClick: () => on.remove(folder) },
];
