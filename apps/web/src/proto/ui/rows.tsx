// PROTOTYPE (BAN-10), round 2: Compact's folder, Variant b's explorer row: a
// small kraft folder, the name and what's inside, and a chevron (or a ⋯ menu
// where a Variant keeps them). Drags with a mouse or trackpad like a tile.
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Cover } from "@/components/decks/cover";
import { createdLabel } from "@/lib/decks";
import { cn } from "@/lib/utils";
import {
  type Deck,
  type Folder,
  type Item,
  type Place,
  countInside,
  countLabel,
  useFinePointer,
  useLibrary,
} from "../folders";
import { dragSource, useDropTarget } from "../use-move";
import { type MenuAction, TileMenu } from "./tiles";

export const KRAFT_TAB = "bg-[oklch(0.86_0.045_75)] dark:bg-[oklch(0.36_0.035_65)]";
export const KRAFT_BODY = "bg-[oklch(0.9_0.04_78)] dark:bg-[oklch(0.33_0.03_65)]";

export function FolderRow({
  folder,
  onMove,
  actions = [],
  forceOver = false,
  ghost,
}: {
  folder: Folder;
  onMove: (item: Item, place: Place) => void;
  actions?: MenuAction[];
  forceOver?: boolean;
  ghost?: string | undefined;
}) {
  const lib = useLibrary();
  const fine = useFinePointer();
  const drop = useDropTarget(folder.id, onMove);
  const over = drop.over || forceOver;
  const count = countLabel(countInside(lib, folder.id));
  return (
    <div className="group/tile relative flex w-full" {...drop.props}>
      <Link
        to="/folders/$folderId"
        params={{ folderId: folder.id }}
        {...dragSource({ kind: "folder", id: folder.id }, fine)}
        className={cn(
          "group flex min-h-16 w-full items-center gap-3.5 rounded-xl border bg-card px-4 py-3 text-foreground no-underline outline-none transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none",
          actions.length > 0 && "pr-14",
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
        {actions.length === 0 && (
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
      </Link>
      {actions.length > 0 && (
        <div className="absolute top-1/2 right-2 -translate-y-1/2 [&_button]:bg-transparent [&_button]:shadow-none [&_button]:backdrop-blur-none">
          <TileMenu label={`More for ${folder.name}`} actions={actions} />
        </div>
      )}
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
export function FolderGlyph({ open = false, className }: { open?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative flex h-8 w-10 shrink-0 flex-col", className)}>
      <span className={cn("h-[25%] w-[40%] rounded-t-[3px]", KRAFT_TAB)} />
      <span className={cn("-mt-px flex-1 rounded-tr-[5px] rounded-b-[5px]", KRAFT_TAB)} />
      <span
        className={cn(
          "absolute inset-x-0 bottom-0 h-[70%] origin-bottom rounded-[5px] border border-black/10 transition-transform motion-reduce:transition-none dark:border-white/10",
          KRAFT_BODY,
          open && "[transform:perspective(60px)_rotateX(-35deg)]",
        )}
      />
    </span>
  );
}

/**
 * Variant f: Compact's deck, a row like a folder's: a small index card with the
 * monogram, the name and its description (or when it was made), and a ⋯ menu.
 */
export function DeckRow({
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
        className={cn(
          "group flex min-h-16 w-full items-center gap-3.5 rounded-xl border bg-card py-3 pr-14 pl-4 text-foreground no-underline outline-none transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none",
          lifted && "border-dashed border-primary",
        )}
      >
        <span aria-hidden className="relative h-8 w-10 shrink-0">
          <span className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-[5px] border bg-card" />
          <Cover
            name={deck.name}
            className="absolute inset-0 rounded-[5px] border text-[0.7rem] [&>span:first-child]:left-1.5 [&>span:last-child]:pb-0.5 [&>span:last-child]:pl-2.5"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold tracking-tight group-hover:underline group-hover:underline-offset-4">
            {deck.name}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {deck.description?.split("\n")[0] ?? `Created ${createdLabel(deck.createdAt)}`}
          </span>
        </span>
      </Link>
      <div className="absolute top-1/2 right-2 -translate-y-1/2 [&_button]:bg-transparent [&_button]:shadow-none [&_button]:backdrop-blur-none">
        <TileMenu label={`More for ${deck.name}`} actions={actions} />
      </div>
    </div>
  );
}
