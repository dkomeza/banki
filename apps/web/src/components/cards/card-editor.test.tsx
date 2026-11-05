import type { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Card } from "@/lib/cards";
import { DuplicateNote, Field } from "./card-editor";

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

describe("DuplicateNote", () => {
  const match: Card = {
    id: "c2",
    deckId: "d1",
    front: "hola",
    back: "hello",
    tags: [],
    gradingNotes: null,
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-01T09:00:00.000Z",
    studied: false,
  };
  const note = (linked?: boolean) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <RouterContextProvider
          router={createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })}
        >
          <DuplicateNote duplicates={[match]} linked={linked} />
        </RouterContextProvider>
      </QueryClientProvider>,
    );

  test("links to the match's edit page", () => {
    expect(note()).toContain('href="/cards/c2"');
  });

  test("unlinked, as in a Session, names the match with no way out", () => {
    const html = note(false);

    expect(html).toContain("hola");
    expect(html).not.toContain("<a");
  });
});
