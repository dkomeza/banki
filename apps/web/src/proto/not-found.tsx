import { Link } from "@tanstack/react-router";

/** An unknown or deleted Card's page, with the way back to Home. */
export function CardNotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
        Card not found
      </h1>
      <p className="text-muted-foreground">It may have been deleted, or the link is wrong.</p>
      <Link to="/" className="inline-flex h-11 items-center font-medium lg:h-auto">
        Back to Home
      </Link>
    </div>
  );
}

/** An unknown or deleted Deck's page, as the deck page shows it. */
export function DeckNotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
        Deck not found
      </h1>
      <p className="text-muted-foreground">It may have been deleted, or the link is wrong.</p>
      <Link to="/" className="inline-flex h-11 items-center font-medium lg:h-auto">
        Back to Home
      </Link>
    </div>
  );
}
