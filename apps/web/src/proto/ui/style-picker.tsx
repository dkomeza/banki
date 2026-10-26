// PROTOTYPE (BAN-10), round 2: the Normal / Compact choice on Settings, each
// option a small picture of what it does to a place's folders.
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type FolderStyle, useStoredFolderStyle } from "../style";
import { KRAFT_BODY, KRAFT_TAB } from "./rows";

export function StylePicker({
  labelledBy,
  pictures,
  labels = { normal: "Normal", compact: "Compact" },
}: {
  labelledBy: string;
  pictures: Record<FolderStyle, ReactNode>;
  labels?: Record<FolderStyle, string>;
}) {
  const [style, setStyle] = useStoredFolderStyle();
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      value={style}
      onValueChange={(value) => {
        if (value === "normal" || value === "compact") setStyle(value);
      }}
      className="grid grid-cols-2 gap-2"
    >
      {(["normal", "compact"] as const).map((value) => (
        <Radio.Root
          key={value}
          value={value}
          className="group/opt flex cursor-default flex-col items-stretch gap-2 rounded-xl border border-border p-2.5 pb-2 text-sm text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-checked:border-primary data-checked:bg-accent data-checked:font-medium data-checked:text-primary data-checked:ring-1 data-checked:ring-primary motion-reduce:transition-none"
        >
          <span
            aria-hidden
            className="flex h-16 flex-col justify-center gap-1 rounded-lg bg-background p-2"
          >
            {pictures[value]}
          </span>
          {labels[value]}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

/** Three kraft folders in a row, as Normal shows them. */
export function MiniFolders() {
  return (
    <span className="grid grid-cols-3 gap-1.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex h-9 flex-col">
          <span className={cn("h-1.5 w-[45%] rounded-t-[2px]", KRAFT_TAB)} />
          <span className={cn("-mt-px flex-1 rounded-tr-[3px] rounded-b-[3px]", KRAFT_BODY)} />
        </span>
      ))}
    </span>
  );
}

/** Folder rows, as Compact shows them. */
export function MiniRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="flex h-3 items-center gap-1 rounded-[3px] border bg-card px-1">
          <span className={cn("h-1.5 w-2 rounded-[1px]", KRAFT_BODY)} />
          <span className="h-1 w-8 rounded-full bg-foreground/25" />
        </span>
      ))}
    </>
  );
}

/** Paper stacks, as decks show in both styles where only folders change. */
export function MiniStacks() {
  return (
    <span className="grid grid-cols-3 gap-1.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-5 rounded-[3px] border bg-card shadow-[2px_2px_0_var(--border)]" />
      ))}
    </span>
  );
}
