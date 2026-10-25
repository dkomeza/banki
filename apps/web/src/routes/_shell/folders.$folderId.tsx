import { Link, createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/page";
import { ensureDeep, useLibrary, useProtoState } from "@/proto/folders";
import { PlaceView } from "@/proto/ui/place";

// PROTOTYPE (BAN-10): a folder's page, its subfolders then its decks, under
// the breadcrumb from "Decks".

export const Route = createFileRoute("/_shell/folders/$folderId")({
  // `deep` adds its chain of folders before the page renders.
  loaderDeps: ({ search }: { search: Record<string, unknown> }) => ({ state: search["state"] }),
  loader: ({ deps }) => ({ deepId: deps.state === "deep" ? ensureDeep() : undefined }),
  component: FolderPage,
});

function FolderPage() {
  const { folderId } = Route.useParams();
  const state = useProtoState();
  const lib = useLibrary();
  const { deepId } = Route.useLoaderData();
  const id = deepId ?? folderId;
  const folder = state === "not-found" ? undefined : lib.folders.find((f) => f.id === id);
  if (folder === undefined) return <FolderNotFound />;
  return <PlaceView key={`${folder.id}-${state ?? ""}`} folder={folder} state={state} />;
}

/** An unknown or deleted folder's page, with the way back to Home. */
function FolderNotFound() {
  return (
    <Page width="cards">
      <div className="flex flex-col items-start gap-4 py-10">
        <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
          Folder not found
        </h1>
        <p className="text-muted-foreground">It may have been deleted, or the link is wrong.</p>
        <Link to="/" className="inline-flex h-11 items-center font-medium lg:h-auto">
          Back to Home
        </Link>
      </div>
    </Page>
  );
}
