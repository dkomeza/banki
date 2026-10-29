// oxlint-disable-next-line import/no-unassigned-import
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

// PROTOTYPE ONLY (BAN-22): a Macro's render, typeset by the store with sample
// arguments, as inert HTML.

export function MacroMath({ html, className }: { html: string | undefined; className?: string }) {
  if (html === undefined || html === "") return null;
  return (
    <span
      aria-hidden
      className={cn("inline-block max-w-full overflow-x-auto overflow-y-hidden", className)}
      // oxlint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
