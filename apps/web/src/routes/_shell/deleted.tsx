import { createFileRoute } from "@tanstack/react-router";
import { DeletedPage } from "@/components/deleted/page";
import { parseDeletedState } from "@/lib/deletions-proto";

// Recently deleted: one entry per Deletion, newest first (prototype, BAN-13).

export const Route = createFileRoute("/_shell/deleted")({
  validateSearch: parseDeletedState,
  component: Deleted,
});

function Deleted() {
  const { state } = Route.useSearch();
  return <DeletedPage state={state} />;
}
