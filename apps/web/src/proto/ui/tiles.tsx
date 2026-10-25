// PROTOTYPE (BAN-10), Variant b: folders are explorer rows, decks keep
// BAN-11's paper stacks. No ⋯ menus: actions live on each page. Tiles and
// rows drag with a mouse or trackpad.
import { Menu } from "@base-ui/react/menu";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  CornerDownRight,
  Ellipsis,
  Folder as FolderIcon,
  Pencil,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
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

/**
 * Variant b: a folder is a row, like a file explorer's: a kraft folder glyph,
 * the name and what's in it, and a chevron. Rows sit in one bordered list
 * above the decks, so the folders read as the way in and the stacks as what
 * you study. No ⋯ menu: a folder's actions are on its page.
 */
export function FolderTile({
  folder,
  onMove,
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
    <div className="relative flex w-full" {...drop.props}>
      <Link
        to="/folders/$folderId"
        params={{ folderId: folder.id }}
        {...dragSource({ kind: "folder", id: folder.id }, fine)}
        className={cn(
          "group flex min-h-16 w-full items-center gap-3.5 rounded-xl border bg-card px-4 py-3 text-foreground no-underline outline-none transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none",
          over && "border-primary bg-accent ring-2 ring-primary/40",
        )}
      >
        <FolderGlyph open={over} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold tracking-tight group-hover:underline group-hover:underline-offset-4">
            {folder.name}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {over ? "Drop to move here" : count === "" ? "Empty" : count}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      {ghost !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-10 z-10 flex max-w-[60%] -translate-y-1/4 rotate-[-3deg] items-center gap-2 rounded-lg border-2 border-primary bg-card py-1.5 pr-3 pl-1.5 shadow-2xl"
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

/** A small kraft folder, its front dropping open while something is held over it. */
function FolderGlyph({ open }: { open: boolean }) {
  return (
    <span aria-hidden className="relative flex h-8 w-10 shrink-0 flex-col">
      <span className={cn("h-2 w-4 rounded-t-[3px]", TAB)} />
      <span className={cn("-mt-px flex-1 rounded-tr-[5px] rounded-b-[5px]", TAB)} />
      <span
        className={cn(
          "absolute inset-x-0 bottom-0 h-[70%] origin-bottom rounded-[5px] border border-black/10 transition-transform motion-reduce:transition-none dark:border-white/10",
          BODY,
          open && "[transform:perspective(60px)_rotateX(-35deg)]",
        )}
      />
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
      {actions.length > 0 && (
        <div className="absolute top-2 right-2 sm:top-3 sm:right-3">
          <TileMenu label={`More for ${deck.name}`} actions={actions} />
        </div>
      )}
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

/**
 * "Decks › Maths › Analysis": every item but the last links to its place.
 * Variant b keeps it to one line: past two folders above the current one, the
 * middle ones fold into "…", a menu of them.
 */
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
  const navigate = useNavigate();
  const path = pathTo(lib, at);
  const linked = last === undefined ? path.slice(0, -1) : path;
  const current = last ?? path.at(-1)?.name;
  const folded = linked.length > 2 ? linked.slice(0, -1) : [];
  const shown = linked.length > 2 ? linked.slice(-1) : linked;
  const sep = <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />;
  return (
    <nav aria-label="Breadcrumb" className="-ml-1">
      <ol className="flex items-center gap-x-0.5 text-sm">
        <li className="flex shrink-0 items-center">
          <Crumb place={null} name="Decks" onMove={onMove} />
        </li>
        {folded.length > 0 && (
          <li className="flex shrink-0 items-center">
            {sep}
            <Menu.Root>
              <Menu.Trigger
                aria-label={`${folded.length} more folders`}
                className="inline-flex h-11 min-w-11 items-center justify-center rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid lg:h-8 lg:min-w-8"
              >
                <Ellipsis aria-hidden className="size-4" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={6} align="start" className="z-50">
                  <Menu.Popup className="min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                    {folded.map((f, i) => (
                      <Menu.Item
                        key={f.id}
                        onClick={() =>
                          void navigate({ to: "/folders/$folderId", params: { folderId: f.id } })
                        }
                        style={{ paddingLeft: `${0.75 + i * 0.75}rem` }}
                        className="flex h-11 cursor-default items-center gap-2 rounded-lg pr-3 text-sm outline-none select-none data-[highlighted]:bg-muted lg:h-9"
                      >
                        <FolderIcon aria-hidden className="size-4 text-muted-foreground" />
                        {f.name}
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </li>
        )}
        {shown.map((f) => (
          <li key={f.id} className="flex min-w-0 items-center">
            {sep}
            <Crumb place={f.id} name={f.name} onMove={onMove} />
          </li>
        ))}
        <li className="flex min-w-0 items-center">
          {sep}
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
