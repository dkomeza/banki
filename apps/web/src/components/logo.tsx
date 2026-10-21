import { cn } from "@/lib/utils";

/**
 * Banki's card-stack glyph: public/icon.svg, the same file every app icon and
 * the favicon are made from. Decorative: put the name "Banki" next to it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/icon.svg"
      alt=""
      width={32}
      height={32}
      className={cn("size-8 shrink-0 rounded-[22%] dark:ring-1 dark:ring-white/10", className)}
    />
  );
}

/** The glyph with the name, as the sign-in, Setup and error screens head their page. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo className="size-9" />
      <span className="text-xl font-semibold tracking-tight">Banki</span>
    </div>
  );
}
