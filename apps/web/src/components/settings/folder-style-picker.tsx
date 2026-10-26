import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { KRAFT_BODY, KRAFT_TAB } from "@/components/folders/folder-tile";
import { type FolderStyle, useFolderStyle } from "@/lib/folder-style";
import { cn } from "@/lib/utils";

const STYLES: { value: FolderStyle; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "compact", label: "Compact" },
];

const isFolderStyle = (value: unknown): value is FolderStyle =>
  STYLES.some((style) => style.value === value);

/** Normal or Compact Folders on this device, each option a small picture of what it does. */
export function FolderStylePicker({ labelledBy }: { labelledBy: string }) {
  const [style, setStyle] = useFolderStyle();
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      value={style}
      onValueChange={(value) => {
        if (isFolderStyle(value)) setStyle(value);
      }}
      className="grid grid-cols-2 gap-2"
    >
      {STYLES.map(({ value, label }) => (
        <Radio.Root
          key={value}
          value={value}
          className="flex cursor-default flex-col items-stretch gap-2 rounded-xl border border-border p-2.5 pb-2 text-sm text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-checked:border-primary data-checked:bg-accent data-checked:font-medium data-checked:text-primary data-checked:ring-1 data-checked:ring-primary motion-reduce:transition-none"
        >
          <span
            aria-hidden
            className="flex h-20 flex-col justify-center gap-1 rounded-lg bg-background p-2"
          >
            {value === "normal" ? <MiniFolders /> : <MiniRows />}
            <MiniStacks />
          </span>
          {label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

/** Three kraft folders in a row, as Normal shows them. */
function MiniFolders() {
  return (
    <span className="grid grid-cols-3 gap-1.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex h-7 flex-col">
          <span className={cn("h-1.5 w-[45%] rounded-t-[2px]", KRAFT_TAB)} />
          <span className={cn("-mt-px flex-1 rounded-tr-[3px] rounded-b-[3px]", KRAFT_BODY)} />
        </span>
      ))}
    </span>
  );
}

/** Folder rows, as Compact shows them. */
function MiniRows() {
  return (
    <>
      {[0, 1].map((i) => (
        <span key={i} className="flex h-3 items-center gap-1 rounded-[3px] border bg-card px-1">
          <span className={cn("h-1.5 w-2 rounded-[1px]", KRAFT_BODY)} />
          <span className="h-1 w-8 rounded-full bg-foreground/25" />
        </span>
      ))}
    </>
  );
}

/** Paper stacks: the Decks, the same in both. */
function MiniStacks() {
  return (
    <span className="grid grid-cols-3 gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-5 rounded-[3px] border bg-card shadow-[2px_2px_0_var(--border)]"
        />
      ))}
    </span>
  );
}
