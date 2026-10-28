import { type CardNode, cardParser } from "@banki/shared";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { typeset } from "@/lib/formula";
import { imageSrc } from "@/lib/images";
import { highlight } from "@/lib/tags";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

// Renders a Card side read-only: the Card parser's tree (ADR-0020) to React,
// with its Formulas typeset by KaTeX. Raw HTML in a Card shows as typed, never
// as HTML: the only markup set from a string is KaTeX's own output. Every
// newline is a line break and a blank line a new paragraph.
//
// Every place a Card renders today is inside a link (the timeline) or names
// one, so a Markdown link renders as underlined text, never a nested link.
// Headings render as larger bold lines, not as headings of the page.

/** Delimiters and other markup that render as nothing. */
const MARKS = new Set([
  "CodeInfo",
  "CodeMark",
  "EmphasisMark",
  "FormulaMark",
  "HeaderMark",
  "LinkLabel",
  "LinkMark",
  "LinkTitle",
  "ListMark",
  "QuoteMark",
  "StrikethroughMark",
  "TableDelimiter",
  "URL",
]);

/** How a side is being rendered: in full, or as its first line only. */
type Context = {
  doc: string;
  /** Renders the first line alone: no line breaks, images or display-sized math. */
  oneLine: boolean;
  /** Set once the first line has ended, in one-line rendering. */
  ended: boolean;
  /** The words searched for, marked in the text and code but not in Formulas. */
  words: readonly string[];
};

const NO_WORDS: readonly string[] = [];

/** Text with the runs that match the search marked. */
function marked(value: string, cx: Context, key: string): ReactNode[] {
  if (cx.words.length === 0) return [value];
  return highlight(value, cx.words).map((run, i) =>
    run.hit ? (
      <mark key={`${key}-m${i}`} className="rounded-[0.2em] bg-primary/18 text-inherit">
        {run.text}
      </mark>
    ) : (
      run.text
    ),
  );
}

/** The node's children, in order. */
function childrenOf(node: CardNode): CardNode[] {
  const out: CardNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) out.push(child);
  return out;
}

/** The first child named `name`. */
const childNamed = (node: CardNode, name: string) => node.getChild(name);

/**
 * A Formula's source: the text between its delimiters, without any other
 * markup inside it (the `>` of a blockquote's lines).
 */
function formulaSource(node: CardNode, doc: string): string {
  const marks = node.getChildren("FormulaMark");
  const from = marks[0]?.to ?? node.from;
  const to = marks[1]?.from ?? node.to;
  let source = "";
  let pos = from;
  for (const child of childrenOf(node)) {
    if (child.name === "FormulaMark" || child.to <= from || child.from >= to) continue;
    source += doc.slice(pos, child.from);
    pos = child.to;
  }
  return source + doc.slice(pos, to);
}

/** One Formula: typeset, or on broken LaTeX its source in red with the error after it. */
function Formula({
  source,
  display,
  delimiter,
  atomic,
}: {
  source: string;
  display: boolean;
  delimiter: string;
  /** Kept whole on a cut line: hidden by an ellipsis entirely or not at all. */
  atomic: boolean;
}) {
  const result = typeset(source, display);
  if ("error" in result) {
    return (
      <span
        className={cn("text-destructive", display && !atomic && "block", atomic && "inline-block")}
      >
        <span className="font-mono text-[0.9em] [overflow-wrap:anywhere]">
          {delimiter}
          {source}
          {delimiter}
        </span>{" "}
        <span className="text-xs">{result.error}</span>
      </span>
    );
  }
  if (display) {
    // A display Formula too wide for its card scrolls sideways on its own. It
    // isn't a keyboard stop, as a scrolling box would otherwise be.
    return (
      <span
        tabIndex={-1}
        className="block max-w-full overflow-x-auto overflow-y-hidden py-1 outline-none [&_.katex-display]:m-0"
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    );
  }
  return (
    <span
      className={atomic ? "inline-block" : undefined}
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );
}

/** Text between nodes: each newline a line break, with the next line's indent dropped. */
function text(value: string, cx: Context, key: string): ReactNode[] {
  const lines = value.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) {
      if (cx.oneLine) {
        cx.ended = true;
        return;
      }
      out.push(<br key={`${key}-br${i}`} />);
    }
    if (cx.ended) return;
    const shown = i > 0 ? line.replace(/^[ \t]+/, "") : line;
    if (shown !== "") out.push(...marked(shown, cx, `${key}-l${i}`));
  });
  return out;
}

/** The inline content of `node` between `from` and `to`: text, with its inline nodes rendered. */
function inline(node: CardNode, cx: Context, from = node.from, to = node.to): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = from;
  for (const child of childrenOf(node)) {
    if (cx.ended) break;
    if (child.to <= from || child.from >= to) continue;
    if (child.from > pos) out.push(...text(cx.doc.slice(pos, child.from), cx, `t${pos}`));
    if (cx.ended) break;
    out.push(inlineNode(child, cx));
    pos = child.to;
  }
  if (!cx.ended && pos < to) out.push(...text(cx.doc.slice(pos, to), cx, `t${pos}`));
  return out;
}

/** One inline node. */
function inlineNode(node: CardNode, cx: Context): ReactNode {
  const key = `${node.name}${node.from}`;
  const { doc } = cx;
  switch (node.name) {
    case "Escape":
      return doc.slice(node.from + 1, node.to);
    case "HardBreak":
      if (cx.oneLine) {
        cx.ended = true;
        return null;
      }
      return <br key={key} />;
    case "Emphasis":
      return <em key={key}>{inline(node, cx)}</em>;
    case "StrongEmphasis":
      return <strong key={key}>{inline(node, cx)}</strong>;
    case "Strikethrough":
      return <s key={key}>{inline(node, cx)}</s>;
    case "InlineCode": {
      const marks = node.getChildren("CodeMark");
      const code = doc
        .slice(marks[0]?.to ?? node.from, marks[1]?.from ?? node.to)
        .replaceAll("\n", " ");
      // As CommonMark: one space each side is dropped, so `` ` `` ` `` can hold a backtick.
      const trimmed =
        code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== ""
          ? code.slice(1, -1)
          : code;
      return (
        <code key={key} className="rounded bg-muted px-1 py-px font-mono text-[0.9em]">
          {marked(trimmed, cx, key)}
        </code>
      );
    }
    case "InlineFormula":
    case "DisplayFormula": {
      const display = node.name === "DisplayFormula";
      return (
        <Formula
          key={key}
          source={formulaSource(node, doc)}
          display={display && !cx.oneLine}
          delimiter={display ? "$$" : "$"}
          atomic={cx.oneLine}
        />
      );
    }
    case "Link": {
      const marks = node.getChildren("LinkMark");
      return (
        <span key={key} className="underline underline-offset-2">
          {inline(node, cx, marks[0]?.to ?? node.from, marks[1]?.from ?? node.to)}
        </span>
      );
    }
    case "Autolink":
      return (
        <span key={key} className="underline underline-offset-2">
          {doc.slice(
            childNamed(node, "URL")?.from ?? node.from,
            childNamed(node, "URL")?.to ?? node.to,
          )}
        </span>
      );
    case "Image": {
      const marks = node.getChildren("LinkMark");
      const alt = doc.slice(marks[0]?.to ?? node.from, marks[1]?.from ?? node.to);
      const url = childNamed(node, "URL");
      if (cx.oneLine || url === null) return alt;
      return (
        <img
          key={key}
          src={imageSrc(doc.slice(url.from, url.to))}
          alt={alt}
          loading="lazy"
          className="inline-block h-auto max-w-full align-bottom"
        />
      );
    }
    default:
      // Markup that renders as nothing, and anything else (an HTML tag) as typed.
      return MARKS.has(node.name) ? null : doc.slice(node.from, node.to);
  }
}

/** How the delimiter row aligns each column of a table. */
function alignments(row: string): ("left" | "center" | "right" | undefined)[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => {
      const c = cell.trim();
      if (c.startsWith(":") && c.endsWith(":")) return "center";
      if (c.endsWith(":")) return "right";
      if (c.startsWith(":")) return "left";
      return undefined;
    });
}

/** A table row's cells. */
function cells(row: CardNode, cx: Context, header: boolean, align: ReturnType<typeof alignments>) {
  return row.getChildren("TableCell").map((cell, i) => {
    const Cell = header ? "th" : "td";
    return (
      <Cell
        key={cell.from}
        style={{ textAlign: align[i] }}
        className={cn("border px-2 py-1 align-top", header && "font-semibold")}
      >
        {inline(cell, cx)}
      </Cell>
    );
  });
}

/** The text of a code block, without its fences or indent. */
const codeOf = (node: CardNode, doc: string) =>
  node
    .getChildren("CodeText")
    .map((part) => doc.slice(part.from, part.to))
    .join("");

/**
 * Where a heading's text is: after its `#`s and before any closing ones, or
 * above its setext underline, without the spaces around it.
 */
function headingRange(node: CardNode, doc: string): [number, number] {
  const marks = node.getChildren("HeaderMark");
  let from = node.from;
  let to = node.to;
  if (node.name.startsWith("ATX")) {
    from = marks[0]?.to ?? from;
    if (marks.length > 1) to = marks.at(-1)?.from ?? to;
  } else {
    to = marks[0]?.from ?? to;
  }
  while (from < to && /\s/.test(doc.charAt(from))) from++;
  while (to > from && /\s/.test(doc.charAt(to - 1))) to--;
  return [from, to];
}

/** A container's blocks. */
function blocks(node: CardNode, cx: Context): ReactNode[] {
  return childrenOf(node)
    .filter((child) => !MARKS.has(child.name))
    .map((child) => block(child, cx));
}

/** One block. */
function block(node: CardNode, cx: Context): ReactNode {
  const key = `${node.name}${node.from}`;
  const { doc } = cx;
  switch (node.name) {
    case "Paragraph":
      return <p key={key}>{inline(node, cx)}</p>;
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
    case "SetextHeading1":
    case "SetextHeading2":
      return (
        <p key={key} className="text-[1.15em] leading-snug font-semibold text-foreground">
          {inline(node, cx, ...headingRange(node, doc))}
        </p>
      );
    case "BulletList":
      return (
        <ul key={key} className="list-disc pl-5 [&>li]:mt-0.5">
          {blocks(node, cx)}
        </ul>
      );
    case "OrderedList": {
      const mark = node.firstChild?.getChild("ListMark");
      const start = mark ? Number.parseInt(doc.slice(mark.from, mark.to), 10) : 1;
      return (
        <ol key={key} start={start} className="list-decimal pl-5 [&>li]:mt-0.5">
          {blocks(node, cx)}
        </ol>
      );
    }
    case "ListItem":
      return (
        <li key={key} className="[&>*+*]:mt-1">
          {blocks(node, cx)}
        </li>
      );
    case "Blockquote":
      return (
        <blockquote key={key} className="flex flex-col gap-1 border-l-2 pl-3">
          {blocks(node, cx)}
        </blockquote>
      );
    case "FencedCode":
    case "CodeBlock":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[0.85em] leading-normal"
        >
          <code>{marked(codeOf(node, doc), cx, key)}</code>
        </pre>
      );
    case "Table": {
      // The delimiter row is the one delimiter right inside the table.
      const delimiter = node.getChild("TableDelimiter");
      const align = alignments(delimiter ? doc.slice(delimiter.from, delimiter.to) : "");
      const header = node.getChild("TableHeader");
      return (
        <div key={key} className="max-w-full overflow-x-auto">
          <table className="border-collapse text-[0.95em]">
            {header && (
              <thead>
                <tr>{cells(header, cx, true, align)}</tr>
              </thead>
            )}
            <tbody>
              {node.getChildren("TableRow").map((row) => (
                <tr key={row.from}>{cells(row, cx, false, align)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "HorizontalRule":
      return <hr key={key} className="my-1" />;
    case "DisplayFormulaBlock":
      return (
        <Formula
          key={key}
          source={formulaSource(node, doc)}
          display
          delimiter="$$"
          atomic={false}
        />
      );
    case "LinkReference":
      return null;
    default:
      return <p key={key}>{doc.slice(node.from, node.to)}</p>;
  }
}

/** The blocks a first line can come from: the first leaf with something on it, inside any list or quote. */
function firstLeaf(node: CardNode): CardNode | null {
  for (const child of childrenOf(node)) {
    if (
      MARKS.has(child.name) ||
      child.name === "LinkReference" ||
      child.name === "HorizontalRule"
    ) {
      continue;
    }
    if (["BulletList", "OrderedList", "ListItem", "Blockquote"].includes(child.name)) {
      const leaf = firstLeaf(child);
      if (leaf !== null) return leaf;
      continue;
    }
    return child;
  }
  return null;
}

/** The first line of a block, inline. */
function firstLineOf(node: CardNode, cx: Context): ReactNode[] {
  const { doc } = cx;
  switch (node.name) {
    case "FencedCode":
    case "CodeBlock":
      return [
        <code key="code" className="font-mono text-[0.9em]">
          {marked(codeOf(node, doc).split("\n")[0] ?? "", cx, "code")}
        </code>,
      ];
    case "DisplayFormulaBlock":
      return [
        <Formula
          key="formula"
          source={formulaSource(node, doc)}
          display={false}
          delimiter="$$"
          atomic
        />,
      ];
    case "Table": {
      const header = node.getChild("TableHeader");
      if (header === null) return [];
      return header
        .getChildren("TableCell")
        .flatMap((cell, i) => [
          i > 0 ? " · " : null,
          <span key={cell.from}>{inline(cell, { ...cx, ended: false })}</span>,
        ]);
    }
    default:
      return node.name.includes("Heading")
        ? inline(node, cx, ...headingRange(node, doc))
        : inline(node, cx);
  }
}

/** A Card side, rendered in full, with the `words` searched for marked. */
export function CardText({
  text: side,
  words = NO_WORDS,
  className,
}: {
  text: string;
  words?: readonly string[];
  className?: string;
}) {
  // The words as one string, so a new array of the same words keeps the render.
  const search = words.join(" ");
  const content = useMemo(() => {
    const tree = cardParser.parse(side);
    const searched = search === "" ? [] : search.split(" ");
    return blocks(tree.topNode, { doc: side, oneLine: false, ended: false, words: searched });
  }, [side, search]);
  return (
    <div className={cn("flex flex-col gap-2 [overflow-wrap:anywhere]", className)}>{content}</div>
  );
}

/**
 * A Card side's first line with something on it, inline Markdown and Formulas
 * on one line (a display Formula typeset inline-sized), cut by an ellipsis but
 * never mid-Formula. Names a Card.
 */
export function CardLine({ text: side, className }: { text: string; className?: string }) {
  const content = useMemo(() => {
    const leaf = firstLeaf(cardParser.parse(side).topNode);
    return leaf === null
      ? []
      : firstLineOf(leaf, { doc: side, oneLine: true, ended: false, words: NO_WORDS });
  }, [side]);
  return <span className={cn("block truncate", className)}>{content}</span>;
}

/**
 * A Card side in full, cut at about `lines` lines' height, fading out where it
 * is cut. Short ones show whole, unfaded.
 */
export function FadingCardText({
  text: side,
  words,
  lines,
  className,
}: {
  text: string;
  words?: readonly string[];
  lines: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = box.current;
    const check = () => {
      if (element !== null) setCut(element.scrollHeight > element.clientHeight + 1);
    };
    // The box stops growing at its cap, so the content is watched too: it
    // grows when KaTeX's fonts arrive or the page gets narrower.
    const observer = new ResizeObserver(check);
    if (element !== null) {
      check();
      observer.observe(element);
      if (element.firstElementChild) observer.observe(element.firstElementChild);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      style={{ maxHeight: `${lines}lh` }}
      className={cn(
        "overflow-hidden",
        className,
        cut && "[mask-image:linear-gradient(to_bottom,#000_calc(100%-1.5lh),transparent)]",
      )}
    >
      <CardText text={side} words={words} />
    </div>
  );
}
