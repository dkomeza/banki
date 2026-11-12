# i: Frame

The Front is an object on the board like a Miro image, but its frame has a size of its own: the corners scale it, and the sides set how wide and how tall it is, so a long Front scrolls inside a frame you sized.

Built on f (Sticker), from the Maintainer's round-2 feedback ("more like images on Miro"), and on g (Picture): the Front is stuck on the grid paper with no chrome of its own. Tap it to select it (an accent frame and a menu over it, with its size and Fold away), drag anywhere on it to move it, and tap the paper to let go of it.

What i adds: handles on the frame's sides as well as its corners. A corner scales it, about the opposite corner, from 40% to 250%, frame and all. The right side's handle sets its width, and the text reflows. The bottom side's handle sets its height: shorter than the Front, the rest scrolls inside it, with a fade at the foot (a wheel or a finger over it scrolls the Front, never the canvas, and a pen or a mouse still moves it); pulled down past the end, it shows all of it. "Show all" in the menu does that in one tap. Its first height is at most 45% of the canvas, as in f. Ctrl+wheel (a trackpad's pinch) over it scales it; from the keyboard, Tab to it, arrows move it, + / − scale it, 0 is 100%. Its size carries from Card to Card; each Card's Front starts at the head of its paper. Panned out of sight, "Bring the Front here" fetches it back.

States: ink, ink-written, ink-long-front

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The state pill steps through the states; Handwrite in the top bar (`?handwriting=1`) puts whatever Card shows into handwriting. The ink is rough prototype ink: a pen or a mouse writes, one finger or the wheel pans.
