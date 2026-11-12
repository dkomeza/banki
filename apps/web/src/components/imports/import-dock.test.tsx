import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ImportDock, roomLine } from "./import-page";

const dock = (ticked: number, room: number, busy = false) =>
  renderToStaticMarkup(
    <ImportDock
      ticked={ticked}
      total={40}
      room={room}
      allTicked={false}
      busy={busy}
      onTickAll={() => {}}
      onConfirm={() => {}}
    />,
  );

/** The Import button: the dock's last button, its tag and its text. */
const confirmButton = (html: string) => {
  const buttons = [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map((m) => m[0]);
  const last = buttons.at(-1) ?? "";
  return { disabled: /^<button[^>]*\sdisabled=""/.test(last), text: last.replace(/<[^>]+>/g, "") };
};

describe("ImportDock", () => {
  test("shows the Deck's room beside the ticked count", () => {
    const html = dock(12, 24);
    expect(html).toContain("Room for 24 more cards");
    expect(confirmButton(html)).toEqual({ disabled: false, text: "Import 12" });
  });

  test("with as many ticked as fit, imports them", () => {
    expect(confirmButton(dock(8, 8))).toEqual({ disabled: false, text: "Import 8" });
  });

  test("with more ticked than fit, Import is off and says how many to untick", () => {
    const html = dock(11, 8);
    expect(html).toContain("Room for 8 more cards");
    expect(confirmButton(html)).toEqual({ disabled: true, text: "Untick 3" });
    expect(confirmButton(dock(1_204, 0))).toEqual({ disabled: true, text: "Untick 1,204" });
  });

  test("words the room", () => {
    expect(roomLine(1_000)).toBe("Room for 1,000 more cards");
    expect(roomLine(1)).toBe("Room for 1 more card");
    expect(roomLine(0)).toBe("No room for more cards");
  });
});
