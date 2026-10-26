import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { OUTLINE_PILL, Row, SettingsCard } from "@/components/settings/parts";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Prototype only (BAN-13, Variant c): Recently deleted is reached from
 * Settings, a row saying how many Deletions wait and when the next goes.
 */
export function RecentlyDeletedCard() {
  return (
    <SettingsCard id="recently-deleted" title="Recently deleted">
      <Row
        label="Kept for 30 days, then removed for good"
        value="9 deletions"
        action={
          <Link
            to="/deleted"
            className={cn(
              buttonVariants({ variant: "outline" }),
              OUTLINE_PILL,
              "h-11 text-foreground no-underline",
            )}
          >
            Open
            <ChevronRight aria-hidden />
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">
        The oldest, <span className="font-medium text-foreground">Calculus 1</span>, is removed
        tomorrow.
      </p>
    </SettingsCard>
  );
}
