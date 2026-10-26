import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type Item, type Library, type Place, ROOT_NAME, pathTo } from "@/lib/folders";
import { cn } from "@/lib/utils";
import { useDropTarget } from "./drag";

const CRUMB =
  "inline-flex h-11 items-center rounded-md px-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground hover:underline lg:h-8";
const OVER = "bg-accent text-foreground ring-2 ring-primary";

/** One linked breadcrumb item, a drop target for moving something up to its place. */
function Crumb({
  library,
  place,
  name,
  onMove,
}: {
  library: Library;
  place: Place;
  name: string;
  onMove: (item: Item, place: Place) => void;
}) {
  const drop = useDropTarget(library, place, onMove);
  return (
    <span {...drop.props} className="contents">
      {place === null ? (
        <Link to="/" className={cn(CRUMB, drop.over && OVER)}>
          {name}
        </Link>
      ) : (
        <Link
          to="/folders/$folderId"
          params={{ folderId: place }}
          className={cn(CRUMB, "max-w-48", drop.over && OVER)}
        >
          <span className="truncate">{name}</span>
        </Link>
      )}
    </span>
  );
}

/**
 * The path from "Decks" (the Root) down to `at`, such as Decks › Maths ›
 * Analysis, wrapping when it's long. Every item but the last links to its
 * place. On a Folder's page the Folder is the last item; on a Deck's page,
 * `last` (the Deck's name) comes after its Folder; on a Card's page, the
 * `deck` links after its Folder, and `last` ("New card", "Edit card") comes
 * after it.
 */
export function Breadcrumb({
  library,
  at,
  deck,
  last,
  onMove,
}: {
  library: Library;
  at: Place;
  deck?: { id: string; name: string };
  last?: string;
  onMove: (item: Item, place: Place) => void;
}) {
  const path = pathTo(library.folders, at);
  const linked = last === undefined ? path.slice(0, -1) : path;
  const current = last ?? path.at(-1)?.name;
  return (
    <nav aria-label="Breadcrumb" className="-ml-1">
      <ol className="flex flex-wrap items-center gap-x-0.5 text-sm">
        <li className="flex items-center">
          <Crumb library={library} place={null} name={ROOT_NAME} onMove={onMove} />
        </li>
        {linked.map((folder) => (
          <li key={folder.id} className="flex min-w-0 items-center">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
            <Crumb library={library} place={folder.id} name={folder.name} onMove={onMove} />
          </li>
        ))}
        {deck !== undefined && (
          <li className="flex min-w-0 items-center">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
            <Link
              to="/decks/$deckId"
              params={{ deckId: deck.id }}
              className={cn(CRUMB, "max-w-56")}
            >
              <span className="truncate">{deck.name}</span>
            </Link>
          </li>
        )}
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
