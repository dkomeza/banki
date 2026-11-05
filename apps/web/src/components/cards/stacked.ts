import { cn } from "@/lib/utils";

// A Card's form put its labels in the margin from 640 px. A narrow one, such
// as the study screen's side panel, puts them back above the fields from
// 1024 px, as on a phone.

/** A field's row in a narrow form. */
export const STACKED_ROW = "lg:flex-col lg:gap-1";
/** A field's label in a narrow form. */
export const STACKED_LABEL = "lg:w-auto lg:pt-1 lg:text-left";
/** What lines up with the fields beside the margin from 640 px; in a narrow form, not from 1024 px. */
export const marginIndent = (stacked: boolean) => cn("sm:pl-22", stacked && "lg:pl-0");
