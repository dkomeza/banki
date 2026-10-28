import { createFileRoute } from "@tanstack/react-router";
import { DeletedPage } from "@/components/deleted/page";
import { deletionsQueryOptions } from "@/lib/deletions";

// Recently deleted: one entry per Deletion, newest first, reached from the foot of Home.

export const Route = createFileRoute("/_shell/deleted")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(deletionsQueryOptions()),
  component: DeletedPage,
});
