// A Folder in a place, as a kraft folder with a tab (Normal) or an explorer row
// (Compact): the tops of what's inside peek out of the kraft folder, so it
// reads as something that holds decks rather than one more stack. Both drag
// with a mouse or trackpad, take drops, and have a ⋯ menu.
import { Link } from "@tanstack/react-router";
import { type MenuAction, TileMenu } from "@/components/tile-menu";
import { monogram } from "@/components/decks/cover";
import { sortItems } from "@/lib/decks";
import {
  type Folder,
  type Item,
  type Library,
  type Place,
  contentsOf,
  countInside,
  countLabel,
} from "@/lib/folders";
import { cn } from "@/lib/utils";
import { dragSource, useDragging, useDropTarget, useFinePointer } from "./drag";

/** The kraft folder's back and tab. */
export const KRAFT_TAB = "bg-[oklch(0.86_0.045_75)] dark:bg-[oklch(0.36_0.035_65)]";
/** The kraft folder's front. */
export const KRAFT_BODY = "bg-[oklch(0.9_0.04_78)] dark:bg-[oklch(0.33_0.03_65)]";

const LINK =
  "group flex w-full text-foreground no-underline outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid";

type TileProps = {
  folder: Folder;
  library: Library;
  onMove: (item: Item, place: Place) => void;
  actions: MenuAction[];
};

/** What a Folder holds, in words, or what a drop would do. */
const caption = (library: Library, folder: Folder, over: boolean) => {
  if (over) return "Drop to move here";
  return countLabel(countInside(library, folder.id)) || "Empty";
};

export function FolderTile({ folder, library, onMove, actions }: TileProps) {
  const fine = useFinePointer();
  const drop = useDropTarget(library, folder.id, onMove);
  const lifted = useDragging()?.id === folder.id;
  const inside = contentsOf(library, folder.id);
  // Subfolders peek out as smaller kraft folders, decks as index cards.
  const peek = [
    ...sortItems(inside.folders, "alphabetical").map((f) => ({
      ...f,
      label: f.name,
      isFolder: true,
    })),
    ...sortItems(inside.decks, "alphabetical").map((d) => ({
      ...d,
      label: monogram(d.name),
      isFolder: false,
    })),
  ].slice(0, 3);
  return (
    <div className={cn("group/tile relative flex w-full", lifted && "opacity-35")} {...drop.props}>
      <Link
        to="/folders/$folderId"
        params={{ folderId: folder.id }}
        {...dragSource({ kind: "folder", id: folder.id }, fine)}
        className={cn(LINK, "flex-col gap-4 rounded-2xl focus-visible:outline-offset-4")}
      >
        <span
          className={cn(
            "relative isolate flex aspect-[4/3] w-full flex-col transition-transform motion-reduce:transition-none lg:aspect-[16/10]",
            drop.over && "scale-[1.03]",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-[14%] w-[42%] rounded-t-xl border border-b-0 border-black/10 dark:border-white/10",
              KRAFT_TAB,
            )}
          />
          <span
            aria-hidden
            className={cn(
              "relative -mt-px flex-1 rounded-tr-2xl rounded-b-2xl border border-black/10 dark:border-white/10",
              KRAFT_TAB,
            )}
          >
            <span className="absolute inset-x-[8%] top-[9%] bottom-0 flex items-start justify-center gap-[5%]">
              {peek.map((item, i) => (
                <span
                  key={item.id}
                  style={{ rotate: `${(i - (peek.length - 1) / 2) * 4}deg` }}
                  className={cn(
                    "flex h-[70%] w-[30%] items-start justify-start truncate rounded-md border px-2 pt-1.5 text-xs font-semibold tracking-tight text-foreground/70 shadow-xs transition-transform group-hover:-translate-y-1 motion-reduce:transition-none sm:text-sm",
                    item.isFolder
                      ? cn(KRAFT_TAB, "rounded-tl-none border-black/15 dark:border-white/15")
                      : "bg-card",
                  )}
                >
                  {item.label}
                </span>
              ))}
            </span>
            {/* The front of the folder, lower than the back. */}
            <span
              className={cn(
                "absolute inset-x-0 bottom-0 flex h-[62%] items-end rounded-2xl border border-black/10 p-3 shadow-[0_-1px_0_oklch(1_0_0/0.35)_inset] transition-colors motion-reduce:transition-none sm:p-4 dark:border-white/10",
                KRAFT_BODY,
                drop.over &&
                  "border-primary bg-[color-mix(in_oklch,var(--primary)_18%,oklch(0.9_0.04_78))] dark:bg-[color-mix(in_oklch,var(--primary)_22%,oklch(0.33_0.03_65))]",
              )}
            >
              <span className="text-xs font-medium text-foreground/70 tabular-nums sm:text-sm">
                {caption(library, folder, drop.over)}
              </span>
            </span>
          </span>
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

/** Compact's Folder: a small kraft folder, the name and what's inside, in a row. */
export function FolderRow({ folder, library, onMove, actions }: TileProps) {
  const fine = useFinePointer();
  const drop = useDropTarget(library, folder.id, onMove);
  const lifted = useDragging()?.id === folder.id;
  return (
    <div className={cn("group/tile relative flex w-full", lifted && "opacity-35")} {...drop.props}>
      <Link
        to="/folders/$folderId"
        params={{ folderId: folder.id }}
        {...dragSource({ kind: "folder", id: folder.id }, fine)}
        className={cn(
          LINK,
          "min-h-16 items-center gap-3.5 rounded-xl border bg-card py-3 pr-14 pl-4 transition-colors hover:border-primary/50 focus-visible:outline-offset-2 motion-reduce:transition-none",
          drop.over && "border-primary bg-accent ring-2 ring-primary/40",
        )}
      >
        <FolderGlyph open={drop.over} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold tracking-tight group-hover:underline group-hover:underline-offset-4">
            {folder.name}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {caption(library, folder, drop.over)}
          </span>
        </span>
      </Link>
      <div className="absolute top-1/2 right-2 -translate-y-1/2">
        <TileMenu
          label={`More for ${folder.name}`}
          actions={actions}
          className="bg-transparent shadow-none backdrop-blur-none"
        />
      </div>
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
