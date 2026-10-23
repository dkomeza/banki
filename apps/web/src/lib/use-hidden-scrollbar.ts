import { useLayoutEffect } from "react";

/** How wide this browser's scrollbars are: 0 where they overlay the page (macOS by default). */
function scrollbarWidth(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll";
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

/**
 * Hides the browser's scrollbar from 1024 px while the calling page is
 * mounted, for a page with its own scroll indicator, keeping its width as
 * padding so nothing shifts (see .native-scrollbar-hidden in index.css). Other pages are
 * untouched: unmounting puts it back.
 */
export function useHiddenScrollbar() {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.style.setProperty("--scrollbar-width", `${scrollbarWidth()}px`);
    html.classList.add("native-scrollbar-hidden");
    return () => {
      html.classList.remove("native-scrollbar-hidden");
      html.style.removeProperty("--scrollbar-width");
    };
  }, []);
}
