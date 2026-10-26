import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Trash2 } from "lucide-react";
import { deletionsQueryOptions } from "@/lib/deletions";

/**
 * The way to Recently deleted: a quiet row at the foot of Home, with how many
 * Deletions wait there once that has loaded.
 */
export function RecentlyDeletedLink() {
  const { data } = useQuery(deletionsQueryOptions());
  const waiting = data?.length ?? 0;
  return (
    <Link
      to="/deleted"
      className="group flex items-center gap-3 self-start rounded-full border border-dashed px-4 py-2.5 text-sm text-muted-foreground no-underline transition-colors outline-none hover:border-solid hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none"
    >
      <Trash2 aria-hidden className="size-4" />
      <span>
        <span className="font-medium text-foreground">Recently deleted</span>
        {waiting > 0 && ` · ${waiting} waiting`}
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}
