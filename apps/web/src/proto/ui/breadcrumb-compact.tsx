// PROTOTYPE (BAN-10), Variant e: Variant b's breadcrumb, which Compact shows:
// one line, the middle folders folded into a "…" menu past two above.
import { Menu } from "@base-ui/react/menu";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Ellipsis, Folder as FolderIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Item, type Place, pathTo, useLibrary } from "../folders";
import { useDropTarget } from "../use-move";

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
export function FoldingBreadcrumb({
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
