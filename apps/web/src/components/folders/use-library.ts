import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { decksQueryOptions } from "@/lib/decks";
import { type Library, foldersQueryOptions } from "@/lib/folders";

/** Every live Folder and Deck, from the lists a route's loader has loaded. */
export function useLibrary(): Library {
  const { data: folders } = useSuspenseQuery(foldersQueryOptions());
  const { data: decks } = useSuspenseQuery(decksQueryOptions());
  return useMemo(() => ({ folders, decks }), [folders, decks]);
}
