import { createFileRoute } from "@tanstack/react-router";
import { useProtoState } from "@/proto/folders";
import { PlaceView } from "@/proto/ui/place";

// PROTOTYPE (BAN-10): Home is the root: its folders, then its decks, from the
// in-memory store in src/proto/folders.ts.

export const Route = createFileRoute("/_shell/")({
  component: Home,
});

function Home() {
  const state = useProtoState();
  return <PlaceView key={state ?? ""} folder={null} state={state} />;
}
