import { z } from "zod";

/** The longest a Tag may be, in characters. */
export const TAG_MAX_LENGTH = 50;

/** The most Tags one Card may carry. */
export const CARD_TAGS_MAX = 20;

/**
 * One word: Unicode letters (with their combining marks), digits, `-` and
 * `_`, such as `irregular-verb`, `ch3` or `動詞`.
 */
const ONE_WORD = /^[\p{L}\p{M}\p{Nd}_-]+$/u;

/** What's wrong with `raw` as a Tag, if anything, in a sentence for the Tags field. */
export function tagNameProblem(raw: string): string | undefined {
  const name = raw.normalize("NFC");
  if (name === "") return "Write a tag.";
  if (!ONE_WORD.test(name)) return "A tag is one word: letters, digits, - and _.";
  if (Array.from(name).length > TAG_MAX_LENGTH) {
    return `Keep a tag to ${TAG_MAX_LENGTH} characters.`;
  }
  return undefined;
}

/**
 * A Tag, as it is stored and answered: one word of 1 to 50 characters,
 * lowercased (and NFC-normalized), so Tags match ignoring case. BAN-30's
 * import reuses it.
 */
export const TagName = z
  .string()
  .superRefine((raw, ctx) => {
    const problem = tagNameProblem(raw);
    if (problem !== undefined) ctx.addIssue({ code: "custom", message: problem });
  })
  .transform((raw) => raw.normalize("NFC").toLowerCase());

/** Tags A–Z, the order every Tag list is answered in. */
export const sortTags = (tags: Iterable<string>): string[] =>
  [...tags].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * A Card's Tags as a request gives them: each a `TagName`, duplicates (ignoring
 * case) dropped, at most 20 once they are, and answered A–Z.
 */
export const CardTags = z
  .array(TagName)
  .transform((tags) => sortTags(new Set(tags)))
  .refine((tags) => tags.length <= CARD_TAGS_MAX, `A card carries up to ${CARD_TAGS_MAX} tags`);

/** The body of `GET /api/tags`: the User's Tags on live Cards in live Decks, A–Z. */
export const TagListResponse = z.array(z.string());
export type TagListResponse = z.infer<typeof TagListResponse>;
