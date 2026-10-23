import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = {
  /** A reading page, such as Home: a narrow column. */
  reading: "max-w-3xl",
  /** A page of cards, such as Settings: room for a section index and two columns. */
  cards: "max-w-5xl",
};

/** A screen's content inside the shell, at the width the page sets for itself. */
export function Page({ width, children }: { width: keyof typeof WIDTHS; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full px-5 py-8 sm:px-8 lg:px-10 lg:py-12", WIDTHS[width])}>
      {children}
    </div>
  );
}
