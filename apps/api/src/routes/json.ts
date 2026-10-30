import type { NameClashError } from "@banki/shared";
import { validator } from "hono/validator";
import type { z } from "zod";
import { apiError } from "../http/errors";
import type { Clash } from "../repositories/places";

/**
 * What a refused body's 400 says: the first problem with its `macros`, which
 * names it (a bad name, a blank or long definition, a name twice, too many),
 * or else, when `named`, a problem one of Banki's own rules words (such as
 * "Keep grading notes to 2,000 characters"), or else `message`.
 */
const problemOf = (error: z.ZodError, message: string, named: boolean) =>
  error.issues.find((issue) => issue.path[0] === "macros")?.message ??
  (named ? error.issues.find((issue) => issue.code === "custom")?.message : undefined) ??
  message;

/**
 * A JSON body validator that answers 400 `invalid_request` when `schema`
 * refuses it. With `named`, a problem one of Banki's own rules words is
 * answered in its words.
 */
export const json = <T extends z.ZodType>(
  schema: T,
  message: string,
  { named = false }: { named?: boolean } = {},
) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json(apiError("invalid_request", problemOf(parsed.error, message, named)), 400);
    }
    return parsed.data;
  });
/** A query string validator that answers 400 `invalid_request` when `schema` refuses it. */
export const query = <T extends z.ZodType>(schema: T, message: string) =>
  validator("query", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json(apiError("invalid_request", message), 400);
    return parsed.data;
  });

export const INVALID_MOVE = apiError("invalid_move", "It can't move there");

/** The 409 a move answers when something of its kind beside the destination has its name. */
export const nameClash = (clash: Clash): NameClashError => ({
  error: { code: "name_clash", message: `There's already a "${clash.name}" there` },
  clash,
});
