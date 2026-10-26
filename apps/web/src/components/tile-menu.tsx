import { Menu } from "@base-ui/react/menu";
import { Ellipsis } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MenuAction = { label: string; icon: ReactNode; danger?: boolean; onClick: () => void };

/**
 * A tile's ⋯ menu. On a desktop it shows while the tile (the nearest
 * `group/tile`) is hovered or the menu is focused or open; on touch, always.
 */
export function TileMenu({
  label,
  actions,
  className,
}: {
  label: string;
  actions: MenuAction[];
  className?: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cn(
              "rounded-full bg-card/85 text-muted-foreground shadow-xs backdrop-blur hover:text-foreground lg:opacity-0 lg:group-hover/tile:opacity-100 lg:focus-visible:opacity-100 lg:aria-expanded:opacity-100",
              className,
            )}
          />
        }
      >
        <Ellipsis aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className="min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {actions.map((action) => (
              <Menu.Item
                key={action.label}
                onClick={action.onClick}
                className={cn(
                  "flex h-11 cursor-default items-center gap-2.5 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-muted lg:h-9 [&_svg]:size-4",
                  action.danger && "text-destructive",
                )}
              >
                {action.icon}
                {action.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
