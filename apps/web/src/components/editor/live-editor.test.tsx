import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LiveEditor } from "./live-editor";

/** The editor's markup, given an upload or not. */
const markup = (upload: boolean) =>
  renderToStaticMarkup(
    <LiveEditor
      value=""
      onChange={() => {}}
      placeholder="What to recall"
      labelledBy="back-label"
      autoClose={DEFAULT_AUTO_CLOSE}
      toolbarLabel="Back formatting"
      onSubmit={() => {}}
      onUpload={upload ? async () => ({ ok: true, reference: "images/a.png" }) : undefined}
    />,
  );

describe("LiveEditor", () => {
  test("ends its toolbar with an Image button and a picker of Images when given an upload", () => {
    const html = markup(true);

    expect(html).toContain('aria-label="Image"');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/png,[^"]*"[^>]*multiple/);
    expect(html).toContain('aria-live="polite"');
  });

  test("has a LaTeX cheatsheet button after the math group, the cheatsheet closed", () => {
    const html = markup(false);

    expect(html).toMatch(
      /aria-label="Display formula".*?<\/button><button[^>]*aria-label="LaTeX cheatsheet" aria-haspopup="dialog" aria-expanded="false"/,
    );
    expect(html).not.toContain('role="dialog"');
  });

  test("has no Image button without one", () => {
    const html = markup(false);

    expect(html).not.toContain('aria-label="Image"');
    expect(html).not.toContain('type="file"');
  });
});
