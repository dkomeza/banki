// The Dashboard runs from the clone of `main` on the volume (ADR-0014), and
// the tick moves that clone. So it looks at the clone's HEAD now and then, and
// once it has moved, it says so once and stops looking: main.ts exits, and
// Docker's `restart: unless-stopped` starts it on the new `main`. A HEAD it
// can't read is no move, and until it has read one, the first it reads is
// where it started. Unit-tested with a fake reader.

export async function watchHead(options: {
  read: () => Promise<string | undefined>;
  everyMs: number;
  onMove: (head: string) => void;
}): Promise<() => void> {
  let started = await options.read();
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
