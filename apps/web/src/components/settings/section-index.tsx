import { useEffect, useRef, useState } from "react";
import { activeSection, scrollTargets, sectionFromHash } from "@/lib/section-index";
import { cn } from "@/lib/utils";

export type Section = { id: string; title: string };

function Dash({ title, current }: { title: string; current: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-[3px] rounded-full transition-colors motion-reduce:transition-none",
        current ? "bg-primary" : "bg-input/45",
      )}
      // Longer names, longer dashes, up to a point.
      style={{ width: `${10 + Math.min(title.length, 12)}px` }}
    />
  );
}

/**
 * A long page's section index, from 1024 px wide: a sticky column of dashes,
 * one per section, the one in view in the accent. Hovering anywhere in the
 * gutter between the sidebar and the dashes, or tabbing into it, opens a panel
 * of the sections' names as real links, the current one with
 * `aria-current="location"`.
 *
 * The section in view is the last one whose scroll position the page has
 * reached (see scrollTargets), so every section gets its turn, even those too
 * near the end to reach the top of the viewport; a clicked link's section is
 * current at once.
 */
export function SectionIndex({ label, sections }: { label: string; sections: readonly Section[] }) {
  const ids = sections.map((section) => section.id).join(" ");
  const [current, setCurrent] = useState(sections[0]?.id);
  const [gutter, setGutter] = useState(0);
  const navRef = useRef<HTMLElement>(null);
  // A clicked link's section (or the one the page was opened at), kept
  // current while the page stays where the jump left it (`y`, set by the
  // jump's scroll, or after the click when there was nothing to scroll), then
  // given back to the scroll position.
  const clicked = useRef<{ id: string; y: number | undefined } | undefined>(undefined);

  useEffect(() => {
    const list = ids.split(" ");
    const track = (scrolled: boolean) => {
      const lock = clicked.current;
      if (lock !== undefined) {
        if (!scrolled && lock.y === undefined) {
          setCurrent(lock.id);
          return;
        }
        lock.y ??= window.scrollY;
        if (Math.abs(window.scrollY - lock.y) < 2) return;
        clicked.current = undefined;
      }
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const tops = list.map((id) => {
        const element = document.getElementById(id);
        if (element === null) return 0;
        const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
        return element.getBoundingClientRect().top + window.scrollY - margin;
      });
      setCurrent(list[activeSection(scrollTargets(tops, maxScroll), window.scrollY)]);
    };
    const measure = () => {
      const nav = navRef.current;
      const main = nav?.closest("main");
      if (nav && main)
        setGutter(nav.getBoundingClientRect().left - main.getBoundingClientRect().left);
      track(false);
    };
    const onScroll = () => track(true);
    const linked = sectionFromHash(window.location.hash, list);
    if (linked !== undefined) clicked.current = { id: linked, y: undefined };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(document.body);
    // The hash changing in place (the address bar, Back) jumps like a click.
    const onHashChange = () => {
      const id = sectionFromHash(window.location.hash, list);
      if (id === undefined) return;
      clicked.current = { id, y: window.scrollY };
      setCurrent(id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", onHashChange);
    return () => {
      resized.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [ids]);

  return (
    <nav ref={navRef} aria-label={label} className="group/index relative hidden lg:block">
      <div className="sticky top-28">
        {/* The hover zone: the whole gutter left of the dashes, a little taller than them. */}
        <div aria-hidden className="absolute -inset-y-8 right-0" style={{ left: -gutter }} />
        <div
          aria-hidden
          className="relative flex flex-col gap-2.5 py-3 transition-opacity motion-reduce:transition-none group-focus-within/index:opacity-0 group-hover/index:opacity-0"
        >
          {sections.map(({ id, title }) => (
            <Dash key={id} title={title} current={id === current} />
          ))}
        </div>
        <ul className="pointer-events-none absolute top-0 -left-3 z-20 flex w-max min-w-48 flex-col gap-1 rounded-xl border bg-popover p-2.5 text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 motion-reduce:transition-none group-focus-within/index:pointer-events-auto group-focus-within/index:opacity-100 group-hover/index:pointer-events-auto group-hover/index:opacity-100">
          {sections.map(({ id, title }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={id === current ? "location" : undefined}
                onClick={() => {
                  const lock: { id: string; y: number | undefined } = { id, y: undefined };
                  clicked.current = lock;
                  setCurrent(id);
                  // After the jump, which may not scroll at all.
                  window.setTimeout(() => {
                    lock.y ??= window.scrollY;
                  });
                }}
                className="flex h-9 items-center gap-3.5 rounded-lg pr-5 pl-3 text-sm text-muted-foreground no-underline outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid aria-[current=location]:font-medium aria-[current=location]:text-foreground"
              >
                <span className="flex w-[22px] shrink-0">
                  <Dash title={title} current={id === current} />
                </span>
                {title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
