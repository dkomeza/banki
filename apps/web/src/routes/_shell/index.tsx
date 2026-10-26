import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { showDeletedToast } from "@/components/deleted/toasts";
import { PlaceView } from "@/components/folders/place-view";
import { ensureLibrary } from "@/lib/folders";

// Home is the Root: its Folders, then its Decks.

export const Route = createFileRoute("/_shell/")({
  // Prototype only (BAN-13): `?state=undo` shows the toast a Deck's delete leaves.
  validateSearch: (search: Record<string, unknown>): { state?: "undo" } =>
    search["state"] === "undo" ? { state: "undo" } : {},
  loader: ({ context: { queryClient } }) => ensureLibrary(queryClient),
  component: Home,
});

function Home() {
  const { state } = Route.useSearch();
  useEffect(() => {
    if (state === "undo") showDeletedToast("Calculus 2", true);
  }, [state]);
  return <PlaceView folder={null} />;
}
