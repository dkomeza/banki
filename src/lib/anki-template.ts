import sanitizeHtml from "sanitize-html";
import { normalizeMathMarkup } from "@/lib/math";

export type AnkiModel = {
  type?: number;
  css?: string;
  flds?: Array<{ name: string; ord: number }>;
  tmpls?: Array<{ name: string; ord: number; qfmt: string; afmt: string }>;
};

function clozeValue(value: string, index: number, answer: boolean) {
  return value.replace(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/g, (_all, rawIndex, content, hint) => {
    if (Number(rawIndex) !== index) return content;
    if (answer) return `<mark class="cloze">${content}</mark>`;
    return `<span class="cloze cloze-blank">[${hint || "…"}]</span>`;
  });
}

function renderFields(template: string, fields: Record<string, string>, clozeIndex: number, answer: boolean) {
  let output = template;
  output = output.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_all, name, body) => fields[name]?.trim() ? body : "");
  output = output.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_all, name, body) => fields[name]?.trim() ? "" : body);
  output = output.replace(/\{\{cloze:([^}]+)\}\}/gi, (_all, name) => clozeValue(fields[name] ?? "", clozeIndex, answer));
  output = output.replace(/\{\{text:([^}]+)\}\}/gi, (_all, name) => sanitizeHtml(fields[name] ?? "", { allowedTags: [], allowedAttributes: {} }));
  output = output.replace(/\{\{([^}:]+)\}\}/g, (_all, name) => fields[name.trim()] ?? "");
  return output;
}

function safeCss(css: string) {
  return css
    .replace(/@import[^;]+;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/<\/style/gi, "");
}

export function sanitizeCardHtml(input: string) {
  return sanitizeHtml(normalizeMathMarkup(input), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "audio", "source", "style", "mark", "ruby", "rt", "rp"]),
    allowVulnerableTags: true,
    allowedAttributes: {
      "*": ["class", "dir", "lang", "title", "style"],
      img: ["src", "alt", "width", "height"],
      audio: ["src", "controls", "preload"],
      source: ["src", "type"],
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "data"],
    transformTags: {
      a: (_tagName, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noreferrer noopener" } }),
    },
  });
}

export function renderAnkiCard(model: AnkiModel, values: string[], ordinal: number) {
  const fields = Object.fromEntries((model.flds ?? []).map((field) => [field.name, values[field.ord] ?? ""]));
  const template = model.tmpls?.find((item) => item.ord === ordinal) ?? model.tmpls?.[0];
  if (!template) return null;
  const clozeIndex = ordinal + 1;
  const frontBody = renderFields(template.qfmt, fields, clozeIndex, false);
  const backBody = renderFields(template.afmt.replace(/\{\{FrontSide\}\}/g, frontBody), fields, clozeIndex, true);
  const css = model.css ? `<style>${safeCss(model.css)}</style>` : "";
  return { frontHtml: sanitizeCardHtml(css + frontBody), backHtml: sanitizeCardHtml(css + backBody) };
}

export function rewriteMedia(html: string, mapping: Map<string, string>) {
  let output = html.replace(/\[sound:([^\]]+)\]/gi, (_all, name) => {
    const src = mapping.get(name);
    return src ? `<audio controls preload="none" src="${src}"></audio>` : `<span class="media-missing">Missing audio: ${name}</span>`;
  });
  output = output.replace(/(src=["'])([^"']+)(["'])/gi, (all, before, name, after) => {
    const src = mapping.get(name);
    return src ? `${before}${src}${after}` : all;
  });
  return output;
}
