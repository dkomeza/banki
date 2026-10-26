import { Link } from "@tanstack/react-router";

/** What a page shows for something unknown or deleted, with the way back to Home. */
export function NotFound({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
        {title}
      </h1>
      <p className="text-muted-foreground">It may have been deleted, or the link is wrong.</p>
      <Link to="/" className="inline-flex h-11 items-center font-medium lg:h-auto">
        Back to Home
      </Link>
    </div>
  );
}

/** An unknown or deleted Deck's page. */
export const DeckNotFound = () => <NotFound title="Deck not found" />;

/** An unknown or deleted Card's page, or one whose Deck is deleted. */
export const CardNotFound = () => <NotFound title="Card not found" />;
