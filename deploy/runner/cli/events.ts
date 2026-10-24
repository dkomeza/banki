import { isRecord } from "../lib/parse";

// One line per stream-json event from `claude -p --verbose`, for whoever
// watches `runner stage` in a terminal. The whole event is in the Stage's
// log; this only says what is going on. Pure, so it is unit-tested.

const MAX = 160;

export function summarize(text: string): string {
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    event = undefined;
  }
  if (!isRecord(event) || typeof event.type !== "string") {
    return shorten(`(not an event) ${oneLine(text)}`);
  }
  const indent = typeof event.parent_tool_use_id === "string" ? "  ↳ " : "";
  return shorten(`${indent}${describe(event, event.type)}`);
}

function describe(event: Record<string, unknown>, type: string): string {
  const subtype = typeof event.subtype === "string" ? event.subtype : undefined;
  if (type === "system" && subtype === "init") return start(event);
  if (type === "result") return end(event, subtype);
  if (type === "assistant" || type === "user") {
    const parts = contentOf(event).flatMap((block) => describeBlock(block) ?? []);
    if (parts.length > 0) return parts.join(" · ");
  }
  return subtype === undefined ? type : `${type}: ${subtype}`;
}

function start(event: Record<string, unknown>): string {
  const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers.filter(isRecord) : [];
  const mcp = servers.map((server) => `${String(server.name)} ${String(server.status)}`);
  return [
    `start: ${String(event.model)}`,
    `session ${String(event.session_id)}`,
    ...(mcp.length === 0 ? ["no MCP server"] : [`MCP ${mcp.join(", ")}`]),
  ].join(", ");
}

function end(event: Record<string, unknown>, subtype: string | undefined): string {
  const parts = [`end: ${subtype ?? "?"}${event.is_error === true ? " (error)" : ""}`];
  if (typeof event.num_turns === "number") parts.push(`${event.num_turns} turns`);
  if (typeof event.duration_ms === "number") parts.push(duration(event.duration_ms));
  if (typeof event.total_cost_usd === "number") parts.push(`$${event.total_cost_usd.toFixed(2)}`);
  return parts.join(", ");
}

function contentOf(event: Record<string, unknown>): Record<string, unknown>[] {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord);
}

/** The input field that says best what a tool is called on, in order of preference. */
const SUBJECT_FIELDS = [
  "command",
  "file_path",
  "pattern",
  "path",
  "url",
  "query",
  "description",
  "id",
];

function describeBlock(block: Record<string, unknown>): string | undefined {
  if (block.type === "text" && typeof block.text === "string") {
    return `say: ${firstLine(block.text)}`;
  }
  if (block.type === "tool_use" && typeof block.name === "string") {
    const input = isRecord(block.input) ? block.input : {};
    const field = SUBJECT_FIELDS.find((name) => typeof input[name] === "string");
    return field === undefined
      ? `tool: ${block.name}`
      : `tool: ${block.name} ${oneLine(String(input[field]))}`;
  }
  if (block.type === "tool_result") {
    return block.is_error === true
      ? `tool error: ${firstLine(resultText(block.content))}`
      : "tool result";
  }
  return undefined;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return [h > 0 ? `${h}h` : "", h > 0 || m > 0 ? `${m}m` : "", `${s}s`].filter(Boolean).join(" ");
}

const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() ?? "";
const oneLine = (text: string) => text.trim().replaceAll(/\s*\n\s*/g, " ");
const shorten = (text: string) => (text.length <= MAX ? text : `${text.slice(0, MAX - 1)}…`);
