import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { healthQueryOptions, healthStatusLine } from "@/lib/health";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const health = useQuery(healthQueryOptions);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2">
      <h1 className="text-4xl font-semibold tracking-tight">Banki</h1>
      <p className="text-muted-foreground" role="status">
        {healthStatusLine(health)}
      </p>
    </main>
  );
}
