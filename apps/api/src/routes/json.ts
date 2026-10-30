import type { NameClashError } from "@banki/shared";
import { validator } from "hono/validator";
import type { z } from "zod";
import { apiError } from "../http/errors";
import type { Clash } from "../repositories/places";

/**
 * What a refused body's 400 says: the first problem with its `macros`, which
 * names it (a bad name, a blank or long definition, a name twice, too many),
 * or else `message`.
 */
const problemOf = (error: z.ZodError, message: string) =>
  error.issues.find((issue) => issue.path[0] === "macros")?.message ?? message;

/** A JSON body validator that answers 400 `invalid_request` when `schema` refuses it. */
export const json = <T extends z.ZodType>(schema: T, message: string) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json(apiError("invalid_request", problemOf(parsed.error, message)), 400);
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
