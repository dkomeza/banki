import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/page";
import { DeckList } from "@/proto/deck-list";
import { useProtoState } from "@/proto/decks";

// Variant d, "Desk": Home is the deck list and nothing else, one card with a
// "New deck" field always at its top (type a name, press Enter, and you're on
// the new deck), the sort in the card's own header.

export const Route = createFileRoute("/_shell/")({
  component: Home,
});

function Home() {
  const state = useProtoState();
  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
          Home
        </h1>
        <DeckList state={state} />
      </div>
    </Page>
  );
}
