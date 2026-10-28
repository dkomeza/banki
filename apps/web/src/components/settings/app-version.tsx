import type { HealthResponse } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { healthQueryOptions, versionLabel } from "@/lib/version";

/**
 * The line ending Settings: "Banki <version>". Fetched on its own, so the
 * page never waits for it; while it loads, or when it can't, there is no line.
 */
export function AppVersion() {
  const { data } = useQuery(healthQueryOptions());
  return data === undefined ? null : <VersionLine health={data} />;
}

/** "Banki <version>", the version linking to its Release or commit when it has one. */
export function VersionLine({ health }: { health: HealthResponse }) {
  const { text, href } = versionLabel(health);
  return (
    <p className="text-xs text-muted-foreground">
      Banki{" "}
      {href === undefined ? (
        <span className="tabular-nums">{text}</span>
      ) : (
        // Muted like the line: the global link style would give it the accent.
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 rounded-sm text-muted-foreground tabular-nums underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-0"
        >
          {text}
          <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </p>
  );
}
