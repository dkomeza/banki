import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { StatisticsView } from "@/components/statistics/statistics-view";
import { rangeOf, searchFor, statisticsQueryOptions, statisticsSearch } from "@/lib/statistics";

// Statistics over every Review: the global page, a nav destination of its
// own. The range is in the URL (`?range=7|90|all`, 30 days left out), so it
// survives Back and can be shared.

export const Route = createFileRoute("/_shell/statistics")({
  validateSearch: statisticsSearch,
  loaderDeps: ({ search }) => ({ range: rangeOf(search) }),
  loader: ({ context: { queryClient }, deps: { range } }) =>
    queryClient.ensureQueryData(statisticsQueryOptions(range)),
  component: StatisticsPage,
});

function StatisticsPage() {
  const range = rangeOf(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: stats } = useSuspenseQuery(statisticsQueryOptions(range));
  return (
    <StatisticsView
      stats={stats}
      range={range}
      onRange={(next) => void navigate({ search: searchFor(next), replace: true })}
    />
  );
}
