import type {
  CardFileMacro,
  ImportInvalidCard,
  ImportReportResponse,
  NumberedCard,
} from "@banki/shared";
import type { ImageStatus } from "./read";

// What an Import row stores as JSON (`card_import`, db/schema.ts).

/**
 * What an unconfirmed Import holds of its file, in its `preview` column: its
 * Cards and invalid Cards, its Macros as the file has them (planned against
 * the Deck when shown and again when confirmed), and its zip's images the
 * Cards refer to, each staged as `<importsDir>/<id>/<file>` or a problem.
 */
export type StagedImport = {
  total: number;
  cards: NumberedCard[];
  invalid: ImportInvalidCard[];
  macros: CardFileMacro[];
  zipped: boolean;
  images: Record<string, ImageStatus>;
};

/** What a confirmed Import did, in its `report` column. */
export type ImportReport = Omit<
  ImportReportResponse,
  "id" | "deckId" | "fileName" | "source" | "createdAt" | "status" | "confirmedAt"
>;
