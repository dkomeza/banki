import { z } from "zod";
import { sqlite } from "@/lib/db";
import { sanitizeCardHtml } from "@/lib/anki-template";

const cardSchema = z.object({
  front: z.string().trim().min(1).max(100_000),
  back: z.string().trim().min(1).max(100_000),
  tags: z.array(z.string().trim().min(1).max(50)).max(40).optional(),
}).strict();

const fileSchema = z.object({
  version: z.literal(1),
  deck: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2_000).optional(),
  }).strict(),
  cards: z.array(cardSchema).min(1).max(10_000),
}).strict();

export type BankiCardFile = z.infer<typeof fileSchema>;

function issueMessage(error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue.path.length ? issue.path.join(".") : "document";
  return `Invalid Banki card file at ${path}: ${issue.message}`;
}

export function parseBankiCardFile(text: string): BankiCardFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid Banki card file: the file is not valid JSON.");
  }
  const result = fileSchema.safeParse(value);
  if (!result.success) throw new Error(issueMessage(result.error));
  return result.data;
}

export function importBankiCardFile(fileName: string, text: string) {
  const input = parseBankiCardFile(text);
  const now = Date.now();
  const deckId = crypto.randomUUID();
  const warnings: string[] = [];

  const insert = sqlite.transaction(() => {
    sqlite.prepare(`
      INSERT INTO decks (id, name, description, source_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(deckId, input.deck.name, input.deck.description ?? "", fileName, now, now);

    const insertCard = sqlite.prepare(`
      INSERT INTO cards (
        id, deck_id, source_guid, front_html, back_html, tags, position, due,
        stability, difficulty, scheduled_days, learning_steps, reps, lapses,
        state, last_review, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, NULL, ?, ?)
    `);

    input.cards.forEach((card, position) => {
      const tags = [...new Set(card.tags ?? [])];
      insertCard.run(
        crypto.randomUUID(), deckId, sanitizeCardHtml(card.front),
        sanitizeCardHtml(card.back), JSON.stringify(tags), position, now, now, now,
      );
    });

    sqlite.prepare(`
      INSERT INTO import_reports (
        id, deck_id, file_name, imported_cards, skipped_cards, imported_media,
        warnings, created_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, ?)
    `).run(crypto.randomUUID(), deckId, fileName, input.cards.length, JSON.stringify(warnings), now);
  });

  insert();
  return {
    deckId,
    importedCards: input.cards.length,
    importedMedia: 0,
    skippedCards: 0,
    warnings,
  };
}
