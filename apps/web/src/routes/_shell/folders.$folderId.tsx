import { Link, createFileRoute } from "@tanstack/react-router";
import { PlaceView } from "@/components/folders/place-view";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { ensureLibrary } from "@/lib/folders";

// A Folder's page: its subfolders, then its Decks, under the breadcrumb from
// "Decks".

export const Route = createFileRoute("/_shell/folders/$folderId")({
  loader: ({ context: { queryClient } }) => ensureLibrary(queryClient),
  component: FolderPage,
});

function FolderPage() {
  const { folderId } = Route.useParams();
  const folder = useLibrary().folders.find((f) => f.id === folderId);
  if (folder === undefined) return <FolderNotFound />;
  return <PlaceView key={folder.id} folder={folder} />;
}

/** An unknown or deleted Folder's page, with the way back to Home. */
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
