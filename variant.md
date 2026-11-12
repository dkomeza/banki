# f: Sticker

The Front is a note stuck on the paper itself, like the printed question at the head of an exam sheet: it pans with the ink, so it stays beside what was written about it.

Built on c, with the Maintainer's round-1 feedback: a wheel or a finger over the Front scrolls the Front, never the canvas. The note's header (the grip and "Front") drags it to anywhere on the paper, by pen, mouse or finger, and it then moves with the ink as the canvas pans. The round handle at its bottom-right corner scales it, from 60% to 200%: the type, the Formulas and the Image grow and shrink together (CSS zoom), while the header and the handles keep their touch size. Ctrl+wheel (a trackpad's pinch) over it scales it too, and the percentage in its header puts it back to 100%. Panned out of sight, a "Bring the Front here" chip at the canvas's top-left brings it back into view. Each Card's note starts at the head of its paper, at the size last chosen. "Fold away" folds it to a one-line tab where it sits. The tool bar, the top bar and the dock are as in c.

States: ink, ink-written, ink-long-front

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The state pill steps through the states; Handwrite in the top bar (`?handwriting=1`) puts whatever Card shows into handwriting. The ink is rough prototype ink: a pen or a mouse writes, one finger or the wheel pans.
