import {
  API_KEY_MAX_LENGTH,
  ApiError,
  type ApiKeyStatus,
  type Model,
  SettingsResponse,
} from "@banki/shared";
import { type ApiClient, api } from "./api";
import { type SettingsRead, settingsClock } from "./settings";

// What the Grading card says about the API key and the Model, and how it
// stores and removes the API key.

const CANT_REACH = "Can't reach Banki. Check your connection and try again.";

/** What the API key row shows for its value. */
export function apiKeyValue(status: ApiKeyStatus): string {
  if (status.state === "set") return `sk-or-…${status.lastFour}`;
  if (status.state === "unreadable") return "Can't be read. Enter it again.";
  return "Not set";
}

/** What's wrong with an API key as typed, if anything, before it is sent. */
export function apiKeyProblem(typed: string): string | undefined {
  const apiKey = typed.trim();
  if (apiKey === "") return "Enter the API key.";
  if (apiKey.length > API_KEY_MAX_LENGTH) {
    return `That's longer than ${API_KEY_MAX_LENGTH} characters, so it isn't an OpenRouter API key.`;
  }
  return undefined;
}

export type ApiKeyOutcome = { ok: true; read: SettingsRead } | { ok: false; message: string };

const API_KEY_REFUSALS: Record<string, string> = {
  api_key_refused: "OpenRouter didn't accept this key.",
  openrouter_unreachable: "Couldn't reach OpenRouter. Try again.",
};

async function outcomeOf(
  send: () => Promise<Response>,
  failed: string,
  issuedAt: number,
): Promise<ApiKeyOutcome> {
  let res: Response;
  try {
    res = await send();
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  if (res.ok) {
    return { ok: true, read: { settings: SettingsResponse.parse(await res.json()), issuedAt } };
  }
  const parsed = ApiError.safeParse(await res.json().catch(() => undefined));
  const refusal = parsed.success ? API_KEY_REFUSALS[parsed.data.error.code] : undefined;
  return { ok: false, message: refusal ?? failed };
}

/**
 * Stores a new API key with `PUT /api/settings/api-key`, which OpenRouter
 * checks first, and says how it went. A success carries the Settings as
 * stored, stamped when the request went out.
 */
export function saveApiKey(apiKey: string, client: ApiClient = api): Promise<ApiKeyOutcome> {
  const issuedAt = settingsClock();
  return outcomeOf(
    () => client.api.settings["api-key"].$put({ json: { apiKey: apiKey.trim() } }),
    "Banki couldn't save the API key. Try again.",
    issuedAt,
  );
}

/** Deletes the stored API key with `DELETE /api/settings/api-key`, and says how it went. */
export function removeApiKey(client: ApiClient = api): Promise<ApiKeyOutcome> {
  const issuedAt = settingsClock();
  return outcomeOf(
    () => client.api.settings["api-key"].$delete(),
    "Banki couldn't remove the API key. Try again.",
    issuedAt,
  );
}

/** What a failed change of Model says: which Model is kept instead. */
export function modelSaveErrorText(attempted: Model, kept: Model): string {
  return `The change to ${attempted.name} didn't save, so the Model is still ${kept.name}.`;
}

/** One of a Model's ratings as Settings shows it, and in words for screen readers. */
export type RatingShown = {
  aspect: "Handwriting" | "Speed" | "Cost";
  /** Dots (`●●○`), dollar signs (`$`), or "Untested" with no marks. */
  marks: "dots" | "dollars" | "untested";
  /** How many of the three marks are filled. */
  filled: number;
  /** What a screen reader hears, such as "Handwriting: good". */
  words: string;
};

const HANDWRITING_WORDS = { 1: "fair", 2: "good", 3: "very good" } as const;
const SPEED_WORDS = { 1: "slow", 2: "moderate", 3: "fast" } as const;
const COST_WORDS = { 1: "low", 2: "moderate", 3: "high" } as const;

/** A Model's three ratings, in the order Settings shows them. */
export function ratingsOf(model: Model): RatingShown[] {
  return [
    model.handwriting === "untested"
      ? { aspect: "Handwriting", marks: "untested", filled: 0, words: "Handwriting: untested" }
      : {
          aspect: "Handwriting",
          marks: "dots",
          filled: model.handwriting,
          words: `Handwriting: ${HANDWRITING_WORDS[model.handwriting]}`,
        },
    {
      aspect: "Speed",
      marks: "dots",
      filled: model.speed,
      words: `Speed: ${SPEED_WORDS[model.speed]}`,
    },
    {
      aspect: "Cost",
      marks: "dollars",
      filled: model.cost,
      words: `Cost: ${COST_WORDS[model.cost]}`,
    },
  ];
}

/** The Models matching `query`, by name or maker, in the list's order. */
export function matchModels<T extends Model>(models: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...models];
  return models.filter((model) => `${model.name} ${model.maker}`.toLowerCase().includes(q));
}
