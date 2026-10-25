// The Dashboard runs from the clone of `main` on the volume (ADR-0014), and
// the tick moves that clone. So it looks at the clone's HEAD now and then, and
// once it has moved, it says so once and stops looking: main.ts exits, and
// Docker's `restart: unless-stopped` starts it on the new `main`. Where it
// started is the HEAD bin/dashboard read before bun loaded any code, so a
// move in between counts; without one, the first HEAD it can read. A HEAD
// it can't read is no move. Unit-tested with a fake reader.

export async function watchHead(options: {
  /** The HEAD it was started on, if known. */
  started?: string;
  read: () => Promise<string | undefined>;
  everyMs: number;
  onMove: (head: string) => void;
}): Promise<() => void> {
  let started = options.started ?? (await options.read());
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void options
      .read()
      .then((now) => {
        if (now === undefined || now === started) return;
        if (started === undefined) {
          started = now;
          return;
        }
        clearInterval(timer);
        options.onMove(now);
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, options.everyMs);
  return () => clearInterval(timer);
}
