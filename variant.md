# g: Picture

The Front is an object on the board, like an image on Miro: whole, like a picture, and nothing but the Front until you tap it.

Built on f (Sticker), from the Maintainer's round-2 feedback ("more like images on Miro"). The Front is stuck on the grid paper and pans with the ink, as in f, but it has no header or handle of its own. Tap it (pen, mouse or finger) and it's selected: an accent frame with a handle at each corner, and a small menu over it with its size (tap it for 100%) and Fold away. Drag anywhere on it to move it. Pull any corner to scale it, about the opposite corner, keeping its shape, from 40% to 250%: the type, the Formulas and the Image grow together (CSS zoom). Tap the paper to let go of it. It always shows whole, so a long Front starts scaled down to fit 60% of the canvas's height, and a wheel over it pans the paper like anywhere else. Ctrl+wheel (a trackpad's pinch) over it scales it; from the keyboard, Tab to it, arrows move it, + / − scale it, 0 is 100%. Its size carries from Card to Card; each Card's Front starts at the head of its paper. Panned out of sight, "Bring the Front here" fetches it back.

States: ink, ink-written, ink-long-front

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The state pill steps through the states; Handwrite in the top bar (`?handwriting=1`) puts whatever Card shows into handwriting. The ink is rough prototype ink: a pen or a mouse writes, one finger or the wheel pans.
