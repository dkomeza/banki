// PROTOTYPE (BAN-11): Variant c's sort, a menu behind a quiet "Sorted …" button.
import { Menu } from "@base-ui/react/menu";
import { ArrowDownUp, Check } from "lucide-react";
import type { DeckSort } from "@/proto/decks";

const LABELS: Record<DeckSort, string> = { alphabetical: "Alphabetical", newest: "Newest" };
const SORTS: readonly DeckSort[] = ["alphabetical", "newest"];

export function SortMenu({
  value,
  onChange,
}: {
  value: DeckSort;
  onChange: (s: DeckSort) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid aria-expanded:bg-muted aria-expanded:text-foreground lg:h-8">
        <ArrowDownUp aria-hidden className="size-4" />
        <span>
          <span className="sr-only">Sort: </span>
          {LABELS[value]}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-40">
          <Menu.Popup className="min-w-48 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none">
            <Menu.RadioGroup
              value={value}
              onValueChange={(v: string) => onChange(v === "newest" ? "newest" : "alphabetical")}
            >
              {SORTS.map((s) => (
                <Menu.RadioItem
                  key={s}
                  value={s}
                  className="flex min-h-11 cursor-default items-center justify-between gap-3 rounded-lg px-3 text-[0.95rem] outline-none data-[checked]:font-semibold data-[checked]:text-primary data-[highlighted]:bg-accent lg:min-h-9"
                >
                  {LABELS[s]}
                  <Menu.RadioItemIndicator>
                    <Check aria-hidden className="size-4" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
