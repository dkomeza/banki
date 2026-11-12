import { createFileRoute } from "@tanstack/react-router";
import { StatisticsView } from "@/components/statistics/statistics-view";
import { settingsQueryOptions } from "@/lib/settings";
import { statisticsSearch } from "@/lib/statistics-proto";

// Statistics over every Review: the global page, a nav destination of its own.

export const Route = createFileRoute("/_shell/statistics")({
  validateSearch: statisticsSearch,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(settingsQueryOptions()),
  component: StatisticsPage,
});

function StatisticsPage() {
  const search = Route.useSearch();
  return <StatisticsView scope={{ kind: "global" }} search={search} />;
}
