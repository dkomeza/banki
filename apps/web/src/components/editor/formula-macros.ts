import type { Macro } from "@banki/shared";
import { Facet } from "@codemirror/state";
import { NO_MACROS } from "@/lib/formula";

/**
 * The Macros an editor's Formulas are typeset with, and its autocomplete
 * offers: the Deck's effective Macros. A side's editor and its table's
 * cells all have them.
 */
export const formulaMacros = Facet.define<readonly Macro[], readonly Macro[]>({
  combine: (lists) => lists[0] ?? NO_MACROS,
});
