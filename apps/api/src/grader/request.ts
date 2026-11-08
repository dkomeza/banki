import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expandMacros,
  expandMacrosMapped,
  imageReferencesIn,
  type Macro,
  type MappedText,
  mappedBuilder,
  type ModelId,
  modelById,
  RATINGS,
  sourceRange,
} from "@banki/shared";

/** The Grader's instructions: the grading rules, the Ratings' rubric, and how to write Feedback and Highlights. */
export const GRADER_PROMPT = readFileSync(join(import.meta.dir, "prompt.md"), "utf8");

/** What an Image that can't be sent (a GIF, or one whose file is gone) becomes in the text. */
export const UNSENT_IMAGE = "[an image that couldn't be sent]";

/** An Image's bytes and type, or undefined when it has no file: how the Grader reads the User's Images. */
export type ReadImage = (file: string) => { contentType: string; bytes: Uint8Array } | undefined;

/** What the Grader grades: a Card's sides and Grading notes, the Macros of its Deck, and the Written answer. */
export type GradingInput = {
  front: string;
  back: string;
  gradingNotes: string | null;
  answer: string;
  macros: readonly Macro[];
};

/** One part of a chat message's content, as OpenRouter takes it. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * What the Grader answers, in OpenRouter's strict structured output: each
 * Highlight as a line of the text it was sent and a quote on it, which the
 * server maps to a range of the stored text.
 */
export const GRADE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rating", "feedback", "missing", "mistakes"],
  properties: {
    rating: { type: "string", enum: [...RATINGS], description: "The suggested Rating." },
    feedback: {
      type: "string",
      description: "Markdown with LaTeX, in the Written answer's language.",
    },
    missing: {
      type: "array",
      description: "Parts of the Back that the Written answer leaves out.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "quote"],
        properties: {
          line: { type: "integer", description: "The line's number in <back>, from 1." },
          quote: { type: "string", description: "A short quote copied exactly from that line." },
        },
      },
    },
    mistakes: {
      type: "array",
      description: "Parts of the Written answer that are wrong.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "quote", "note"],
        properties: {
          line: { type: "integer", description: "The line's number in <written_answer>, from 1." },
          quote: { type: "string", description: "A short quote copied exactly from that line." },
          note: { type: "string", description: "What is wrong, in the Written answer's language." },
        },
      },
    },
  },
} as const;

/** The chat completion OpenRouter is asked for. */
export type ChatRequest = {
  model: ModelId;
  messages: [{ role: "system"; content: string }, { role: "user"; content: ContentPart[] }];
  stream: false;
  temperature?: 0;
  response_format: {
    type: "json_schema";
    json_schema: { name: string; strict: true; schema: typeof GRADE_JSON_SCHEMA };
  };
  provider: { require_parameters: true };
};

/** `text` with each line numbered from 1, `n| ` before it, as the prompt describes. */
const numbered = (text: string) =>
  text
    .split("\n")
    .map((line, i) => `${i + 1}| ${line}`)
    .join("\n");

/**
 * `mapped` with each Image reference replaced by `[Image n]`, numbered by file
 * in `numbers` (a file seen first gets the next number), or by
 * {@link UNSENT_IMAGE} when `sendable` says it can't go. A replacement maps
 * back to the whole reference.
 */
function replaceImages(
  mapped: MappedText,
  numbers: Map<string, number | null>,
  sendable: (file: string) => boolean,
): MappedText {
  const out = mappedBuilder();
  let pos = 0;
  for (const { start, end, file } of imageReferencesIn(mapped.text)) {
    out.pushSlice(mapped, pos, start);
    if (!numbers.has(file)) {
      const sent = [...numbers.values()].filter((n) => n !== null).length;
      numbers.set(file, sendable(file) ? sent + 1 : null);
    }
    const n = numbers.get(file) ?? null;
    out.push(
      n === null ? UNSENT_IMAGE : `[Image ${n}]`,
      sourceRange(mapped, start, end) ?? {
        from: start,
        to: start,
      },
      false,
    );
    pos = end;
  }
  out.pushSlice(mapped, pos, mapped.text.length);
  return out.done();
}

/**
 * The chat completion that grades `input` with `model`, and the Back and the
 * Written answer as sent, mapped to the stored text, for the Highlights.
 * Macros are expanded in all four texts; each Image the Front or Back refers
 * to becomes `[Image n]` and goes along as a base64 data URL labelled Image n,
 * except a GIF or one with no file, which becomes {@link UNSENT_IMAGE}.
 */
export function gradingRequest(
  input: GradingInput,
  model: ModelId,
  readImage: ReadImage,
): { body: ChatRequest; back: MappedText; answer: MappedText } {
  const loaded = new Map<string, { contentType: string; bytes: Uint8Array } | undefined>();
  const load = (file: string) => {
    if (!loaded.has(file)) {
      const image = readImage(file);
      loaded.set(file, image?.contentType === "image/gif" ? undefined : image);
    }
    return loaded.get(file);
  };
  const numbers = new Map<string, number | null>();
  const sendable = (file: string) => load(file) !== undefined;
  const front = replaceImages(expandMacrosMapped(input.front, input.macros), numbers, sendable);
  const back = replaceImages(expandMacrosMapped(input.back, input.macros), numbers, sendable);
  const answer = expandMacrosMapped(input.answer, input.macros);

  const sections = [
    `<front>\n${front.text}\n</front>`,
    `<back>\n${numbered(back.text)}\n</back>`,
    ...(input.gradingNotes === null
      ? []
      : [`<grading_notes>\n${expandMacros(input.gradingNotes, input.macros)}\n</grading_notes>`]),
    `<written_answer>\n${numbered(answer.text)}\n</written_answer>`,
  ];
  const content: ContentPart[] = [{ type: "text", text: sections.join("\n\n") }];
  for (const [file, n] of numbers) {
    const image = load(file);
    if (n === null || image === undefined) continue;
    content.push(
      { type: "text", text: `Image ${n}:` },
      {
        type: "image_url",
        image_url: {
          url: `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`,
        },
      },
    );
  }

  return {
    body: {
      model,
      messages: [
        { role: "system", content: GRADER_PROMPT },
        { role: "user", content },
      ],
      stream: false,
      ...(modelById(model).temperature ? { temperature: 0 as const } : {}),
      response_format: {
        type: "json_schema",
        json_schema: { name: "grade", strict: true, schema: GRADE_JSON_SCHEMA },
      },
      provider: { require_parameters: true },
    },
    back,
    answer,
  };
}
