import { createFileRoute } from "@tanstack/react-router";
import { PlaceView } from "@/components/folders/place-view";
import { ensureLibrary } from "@/lib/folders";

// Home is the Root: its Folders, then its Decks.

export const Route = createFileRoute("/_shell/")({
  loader: ({ context: { queryClient } }) => ensureLibrary(queryClient),
  component: Home,
});

function Home() {
  return <PlaceView folder={null} />;
}
