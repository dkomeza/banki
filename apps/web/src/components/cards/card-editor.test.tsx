import type { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Field } from "./card-editor";

/** A field's markup: the Back, which takes Images, or the Grading notes, which don't. */
const markup = (label: "Back" | "Grading notes") =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Field
        label={label}
        placeholder="…"
        value="Must mention $x$."
        error={undefined}
        readOnly={false}
        inputRef={createRef<EditorView>()}
        onChange={() => {}}
        onSubmit={() => {}}
        {...(label === "Back" ? { onUploading: () => {} } : {})}
      />
    </QueryClientProvider>,
  );

describe("Field", () => {
  test("gives a side an Image button", () => {
    expect(markup("Back")).toContain('aria-label="Image"');
  });

  test("gives the Grading notes their formatting toolbar, with no Image button or picker", () => {
    const html = markup("Grading notes");

    expect(html).toContain('aria-label="Grading notes formatting"');
    expect(html).toContain('aria-label="Inline formula"');
    expect(html).not.toContain('aria-label="Image"');
    expect(html).not.toContain('type="file"');
  });
});
