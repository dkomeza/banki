# The Stroke being written is drawn on a canvas, and finished Ink is SVG

Ink is drawn two ways. The Stroke the stylus is writing goes on a `<canvas>` the size of the Canvas's viewport, and that canvas holds nothing else. It is cleared and drawn again in the animation frame its pen samples arrive in, from the coalesced samples and the predicted ones where the browser has them, and it never goes through a React render. When the stylus lifts, the Stroke becomes an SVG `<path>` in the layer that holds the Front, under one CSS transform. Panning and zooming change only that transform, so no Stroke is drawn again while the User navigates.

Writing has to feel immediate, and the Canvas has to pan and zoom smoothly under a full page of Ink on an iPad. The two parts want different things. The Stroke being written changes every few milliseconds: on a small canvas, each frame costs the same however much Ink there is. Finished Ink changes only when a Stroke ends: as SVG in the Front's layer, the compositor moves it with the Front, it stays crisp at every zoom, and it shares the Front's coordinates with no second transform to keep in step.

## Considered Options

- **All canvas** (Excalidraw's model): a static canvas of finished Ink and a second one for the live Stroke. It is exact at every zoom and scales to huge drawings, but every pan and zoom frame draws every Stroke again, and the canvas's transform has to be kept in step with the Front, which is DOM, by hand.
- **All SVG** (tldraw's model): one render path and the least code. The live Stroke's path is rasterized again on every sample, which adds latency on a long Stroke.

## Consequences

- A Stroke's points are in the Canvas's own coordinates, not the screen's, and its thickness is in them too: zooming in shows Ink thicker.
- Finishing a Stroke hands it from the canvas to the SVG layer within one frame, so the handover never shows as a flicker or a jump.
- What the Grader gets (BAN-48) is drawn from the Strokes, not read back from either layer.
- "Crisp at every zoom" needs one step past the transform. On the iPad, Ink scaled up by the transform alone showed pixelated: a browser that composites the layer draws it at its laid-out size and enlarges that picture. Once the view rests zoomed in, the layer is laid out at its zoom with CSS `zoom`, and the transform scales by what is left. The browser draws it once more then, never while the view moves.
