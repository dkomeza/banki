import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/page";

export const Route = createFileRoute("/_shell/")({
  component: Home,
});

function Home() {
  return (
    <Page width="reading">
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <section
          aria-labelledby="home-empty"
          className="flex flex-col items-center gap-5 rounded-2xl border border-dashed border-input/60 px-6 py-14 text-center"
        >
          <EmptyStack />
          <div className="flex max-w-xs flex-col gap-1.5">
            <h2 id="home-empty" className="text-lg font-semibold tracking-tight">
              Your decks will live here
            </h2>
            <p className="text-sm text-balance text-muted-foreground">
              Each deck you make shows up on this page, with its cards.
            </p>
          </div>
        </section>
      </div>
    </Page>
  );
}

/** Three blank cards, the logo's stack drawn as outlines: nothing in it yet. */
function EmptyStack() {
  return (
    <div aria-hidden className="relative h-20 w-28">
      <div className="absolute top-0 left-6 h-14 w-20 rotate-9 rounded-lg border-2 border-input/50 bg-card" />
      <div className="absolute top-2.5 left-3.5 h-14 w-20 rotate-2 rounded-lg border-2 border-input/70 bg-card" />
      <div className="absolute top-5 left-1 h-14 w-20 -rotate-5 rounded-lg border-2 border-primary/70 bg-card" />
    </div>
  );
}
