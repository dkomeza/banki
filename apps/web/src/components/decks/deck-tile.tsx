import { Link } from "@tanstack/react-router";
import { Cover, Stack } from "@/components/decks/cover";
import { useFinePointer, dragSource } from "@/components/folders/drag";
import { type MenuAction, TileMenu } from "@/components/tile-menu";
import { type Deck, createdLabel } from "@/lib/decks";

/**
 * A deck as a stack whose top card is its cover, f's monogram on ruled paper,
 * with two more cards peeking out under it. The name and the start of the
 * description sit under the stack, like a title under a book. It drags with
 * a mouse or trackpad, and has a ⋯ menu.
 */
export function DeckTile({ deck, actions }: { deck: Deck; actions: MenuAction[] }) {
  const fine = useFinePointer();
  return (
    <div className="group/tile relative flex w-full">
      <Link
        to="/decks/$deckId"
        params={{ deckId: deck.id }}
        {...dragSource({ kind: "deck", id: deck.id }, fine)}
        className="group flex w-full flex-col gap-4 rounded-2xl text-foreground no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <Stack className="aspect-[4/3] w-full lg:aspect-[16/10]">
          <Cover
            name={deck.name}
            className="w-full rounded-2xl border text-5xl transition-[border-color,translate] group-hover:-translate-y-1 group-hover:border-primary/50 motion-reduce:transition-none sm:text-6xl"
          />
        </Stack>
        <span className="flex flex-col gap-1 px-0.5 pt-1">
          <span className="line-clamp-2 leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] group-hover:underline group-hover:underline-offset-4 sm:text-[1.05rem]">
            {deck.name}
          </span>
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {deck.description ?? `Created ${createdLabel(deck.createdAt)}`}
          </span>
        </span>
      </Link>
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3">
        <TileMenu label={`More for ${deck.name}`} actions={actions} />
      </div>
    </div>
  );
}
