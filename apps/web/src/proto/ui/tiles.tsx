// PROTOTYPE (BAN-10), Variant c: folders are outlined index tabs, decks keep
// BAN-11's paper stacks, and from 1024 px the folder tree sits beside the
// place. Each tile has a ⋯ menu, and drags with a mouse or trackpad.
import { Menu } from "@base-ui/react/menu";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  CornerDownRight,
  Ellipsis,
  Folder as FolderIcon,
  FolderOpen,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Cover, Stack } from "@/components/decks/cover";
import { Button } from "@/components/ui/button";
import { createdLabel } from "@/lib/decks";
import { cn } from "@/lib/utils";
import {
  type Deck,
  type Folder,
  type Item,
  type Place,
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

/**
 * Variant c: a folder is a small index tab, outlined rather than filled, so a
 * place's folders read as labels to go through and its decks as the paper
 * stacks under them.
 */
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
  const count = countLabel(countInside(lib, folder.id));
  return (
    <div className="group/tile relative flex w-full pt-3" {...drop.props}>
      {/* The tab, joined to the card below it. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-0 left-4 h-4 w-16 rounded-t-lg border border-b-0 bg-card transition-colors motion-reduce:transition-none",
          over && "border-primary bg-accent",
        )}
      />
      <Link
        to="/folders/$folderId"
        params={{ folderId: folder.id }}
        {...dragSource({ kind: "folder", id: folder.id }, fine)}
        className={cn(
          "group relative flex min-h-24 w-full flex-col justify-between gap-3 rounded-xl rounded-tl-md border bg-card p-4 pr-12 text-foreground no-underline outline-none transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none",
          over && "border-primary bg-accent",
        )}
      >
        <span className="flex items-center gap-2">
          <FolderIcon
            aria-hidden
            className={cn("size-4 shrink-0 text-muted-foreground", over && "text-primary")}
          />
          <span className="line-clamp-2 font-semibold tracking-tight [overflow-wrap:anywhere] group-hover:underline group-hover:underline-offset-4">
            {folder.name}
          </span>
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {over ? "Drop to move here" : count === "" ? "Empty" : count}
        </span>
      </Link>
      <div className="absolute top-5 right-2">
        <TileMenu label={`More for ${folder.name}`} actions={actions} />
      </div>
      {ghost !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-6 bottom-[-1.25rem] z-10 flex max-w-[75%] rotate-[-3deg] items-center gap-2 rounded-lg border-2 border-primary bg-card py-1.5 pr-3 pl-1.5 shadow-2xl"
        >
          <Cover
            name={ghost}
            className="size-8 shrink-0 rounded-md border text-sm [&>span:first-child]:left-1.5 [&>span:last-child]:pl-2.5"
          />
          <span className="truncate text-sm font-semibold">{ghost}</span>
        </span>
      )}
    </div>
  );
}

/**
 * The folder tree beside a place, from 1024 px: "Decks" on top, each folder
 * nested under its parent, the place being shown in the accent. The path down
 * to it is open; any folder with folders in it opens and closes with its
 * chevron. Every row is a drop target.
 */
export function FolderTree({
  at,
  onMove,
}: {
  at: Place;
  onMove: (item: Item, place: Place) => void;
}) {
  const lib = useLibrary();
  const path = pathTo(lib, at);
  const [open, setOpen] = useState<Set<string>>(() => new Set(path.map((f) => f.id)));
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const rows: { folder: Folder | null; depth: number }[] = [{ folder: null, depth: 0 }];
  const walk = (parent: string | null, depth: number) => {
    for (const f of sortItems(
      lib.folders.filter((x) => x.parentId === parent),
      "alphabetical",
    )) {
      rows.push({ folder: f, depth });
      if (open.has(f.id)) walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  return (
    <nav aria-label="Folders" className="flex flex-col gap-2">
      <h2 className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Folders
      </h2>
      <ul className="flex flex-col gap-0.5">
        {rows.map(({ folder, depth }) => (
          <TreeRow
            key={folder?.id ?? "root"}
            folder={folder}
            depth={depth}
            current={(folder?.id ?? null) === at}
            open={folder !== null && open.has(folder.id)}
            hasChildren={folder !== null && lib.folders.some((x) => x.parentId === folder.id)}
            onToggle={() => folder && toggle(folder.id)}
            onMove={onMove}
          />
        ))}
      </ul>
    </nav>
  );
}

function TreeRow({
  folder,
  depth,
  current,
  open,
  hasChildren,
  onToggle,
  onMove,
}: {
  folder: Folder | null;
  depth: number;
  current: boolean;
  open: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onMove: (item: Item, place: Place) => void;
}) {
  const drop = useDropTarget(folder?.id ?? null, onMove);
  const row = cn(
    "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pr-2 text-sm text-foreground no-underline outline-none hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    current && "bg-accent font-medium text-primary hover:bg-accent",
    drop.over && "bg-accent ring-2 ring-primary",
  );
  const Icon = folder === null ? Layers : open ? FolderOpen : FolderIcon;
  const body = (
    <>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{folder?.name ?? "Decks"}</span>
    </>
  );
  return (
    <li
      className="flex items-center"
      style={{ paddingLeft: `${Math.max(0, depth - 1) * 0.875}rem` }}
      {...drop.props}
    >
      {depth > 0 && (
        <button
          type="button"
          aria-label={open ? `Close ${folder?.name}` : `Open ${folder?.name}`}
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid",
            !hasChildren && "invisible",
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        </button>
      )}
      {folder === null ? (
        <Link to="/" aria-current={current ? "page" : undefined} className={cn(row, "pl-2")}>
          {body}
        </Link>
      ) : (
        <Link
          to="/folders/$folderId"
          params={{ folderId: folder.id }}
          aria-current={current ? "page" : undefined}
          className={cn(row, "pl-1")}
        >
          {body}
        </Link>
      )}
    </li>
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
            "inline-flex h-11 shrink-0 items-center rounded-md px-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground hover:underline lg:h-8",
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
    <nav aria-label="Breadcrumb" className="flex">
      {/* A path bar: one line that scrolls sideways when it runs out of room. */}
      <ol
        // Scrolled to its end, so the place being shown is always in view.
        ref={(el) => {
          // Again once the fonts have set the width.
          if (el) void document.fonts.ready.then(() => (el.scrollLeft = el.scrollWidth));
        }}
        className="flex max-w-full items-center gap-x-0.5 overflow-x-auto rounded-full border bg-card px-3 text-sm whitespace-nowrap [scrollbar-width:none]"
      >
        <li className="flex items-center">
          <Crumb place={null} name="Decks" onMove={onMove} />
        </li>
        {linked.map((f) => (
          <li key={f.id} className="flex shrink-0 items-center">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
            <Crumb place={f.id} name={f.name} onMove={onMove} />
          </li>
        ))}
        <li className="flex shrink-0 items-center">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span aria-current="page" className="px-1 font-medium text-foreground">
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
