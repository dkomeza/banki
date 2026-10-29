import { CARD_FILE_JSON_SCHEMA } from "@banki/shared";
import { Hono } from "hono";

/** The Card file's JSON Schema, generated once from `CardFile`, as it is served. */
const CARD_FILE_SCHEMA_BODY = JSON.stringify(CARD_FILE_JSON_SCHEMA, null, 2);

/**
 * Banki's public JSON Schemas, under `/api/schemas`: `GET /card-file-v1.json`
 * answers the Card file's, which anyone may fetch without signing in.
 */
export function schemaRoutes() {
  return new Hono().get("/card-file-v1.json", (c) =>
    c.body(CARD_FILE_SCHEMA_BODY, 200, { "Content-Type": "application/schema+json" }),
  );
}
