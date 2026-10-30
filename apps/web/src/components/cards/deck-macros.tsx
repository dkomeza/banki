import type { Macro } from "@banki/shared";
import type { ReactNode } from "react";
import { MacrosContext, useEffectiveMacros } from "@/lib/macros";

/**
 * Renders the Cards inside it, and their editor, with a Deck's effective
 * Macros: Settings' with `own`, the Deck's own, on top. Both follow the
 * cache, so a saved Macro shows at once.
 */
export function DeckMacros({
  own,
  children,
}: {
  own: readonly Macro[] | undefined;
  children: ReactNode;
}) {
  return <MacrosContext value={useEffectiveMacros(own)}>{children}</MacrosContext>;
}
