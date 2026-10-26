import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { Deck } from "@/lib/decks";
import { type Library, ROOT_NAME, pathTo } from "@/lib/folders";

const CRUMB =
  "inline-flex h-11 items-center rounded-md px-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground hover:underline lg:h-8";

/** Decks › its Folders › the Deck › `last`, every item but the last a link. */
export function CardCrumbs({
  library,
  deck,
  last,
}: {
  library: Library;
  deck: Deck;
  last: string;
}) {
  const path = pathTo(library.folders, deck.folderId);
  return (
    <nav aria-label="Breadcrumb" className="-ml-1">
      <ol className="flex flex-wrap items-center gap-x-0.5 text-sm">
        <li className="flex items-center">
          <Link to="/" className={CRUMB}>
            {ROOT_NAME}
          </Link>
        </li>
        {path.map((folder) => (
          <li key={folder.id} className="flex min-w-0 items-center">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
            <Link
              to="/folders/$folderId"
              params={{ folderId: folder.id }}
              className={`${CRUMB} max-w-48`}
            >
              <span className="truncate">{folder.name}</span>
            </Link>
          </li>
        ))}
        <li className="flex min-w-0 items-center">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
          <Link to="/decks/$deckId" params={{ deckId: deck.id }} className={`${CRUMB} max-w-56`}>
            <span className="truncate">{deck.name}</span>
          </Link>
        </li>
        <li className="flex min-w-0 items-center">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span aria-current="page" className="truncate px-1 font-medium text-foreground">
            {last}
          </span>
        </li>
      </ol>
    </nav>
  );
}
