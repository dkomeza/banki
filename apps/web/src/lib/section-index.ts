// Which section a page's section index shows as current while it scrolls.

/**
 * Each section's scroll position, from where its link would jump to (`tops`,
 * in page order), capped at the most the page can scroll and never before the
 * section above it. A run of sections sharing a position (cards side by side,
 * or the last sections, which can't reach the top of the viewport and so all
 * stop at the cap) is spread evenly between the section before it and that
 * position, so each gets a turn as the page scrolls.
 */
export function scrollTargets(tops: readonly number[], maxScroll: number): number[] {
  const targets: number[] = [];
  for (const top of tops) {
    targets.push(Math.max(Math.min(Math.max(top, 0), maxScroll), targets.at(-1) ?? 0));
  }
  for (let start = 1; start < targets.length;) {
    let end = start;
    while (end + 1 < targets.length && targets[end + 1] === targets[start]) end += 1;
    const from = targets[start - 1] ?? 0;
    const to = targets[start] ?? 0;
    if ((end > start || to === from) && to > from) {
      const count = end - start + 1;
      for (let n = 0; n < count; n++) targets[start + n] = from + ((to - from) * (n + 1)) / count;
    }
    start = end + 1;
  }
  return targets;
}

/** The index of the last section whose scroll position `scrollY` has reached. */
export function activeSection(targets: readonly number[], scrollY: number): number {
  let current = 0;
  targets.forEach((target, index) => {
    if (target <= scrollY + 1) current = index;
  });
  return current;
}

/**
 * The section a URL hash names (`location.hash`, with or without its `#`), or
 * undefined when it names none of `ids` or can't be decoded (`#%`).
 */
export function sectionFromHash(hash: string, ids: readonly string[]): string | undefined {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return undefined;
  }
  return ids.includes(id) ? id : undefined;
}
