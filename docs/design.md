# Banki's design

Banki's design language in words: what it is going for, and the conventions screens follow. The values (colours, radii, fonts) live in `apps/web/src/index.css`; this file says what they are for. A prototype, the implementer and the `ui-reviewer` all work within it. Changing it is a decision made in a `/work-issue` grill, usually through a prototype.

It was settled by the BAN-9 prototype (branch `dkomeza/ban-9-settings-page-with-timezone-and-day-start-prototype`, variant `e`).

## Direction: Paper & ink

Banki should feel like a quiet desk: warm paper, dark ink and one burnt-orange accent. The accent is reserved for what matters on a screen: the primary action, the active nav item, the current selection, focus rings, and the one figure a screen is built around (such as the Study day bar). Everything else is ink at a few strengths on paper. Dark mode is the same desk at night: a warm near-black page, paper-coloured text and a brighter orange.

Geist is the UI font. Headings are semibold with slightly tight tracking; a page title is large (about 2.25 rem on phones, 3 rem on desktop), so each screen announces itself before its content.

## The shell

- **From 1024 px wide:** a sidebar with the logo and "Banki" at the top, the nav, and at its foot a "Signed in as <Email>" row that links to Settings.
- **Below 1024 px:** a bottom tab bar holding the nav destinations only. There is no account menu or sheet: everything about the User and this device lives on the Settings page.
- The nav lists only real destinations. The active one gets `aria-current="page"` and the accent.
- The shell pads itself with the safe-area insets, so nothing sits under a notch or the home indicator.
- Each page sets its own content width inside the shell: a reading page (Home) keeps a narrow column; a page of cards (Settings) is wider.

## Pages

- **Cards hold sections.** A section is a rounded card with a hairline border and an `h2`. Paper & ink's card and page colours are close, so the border is what separates them.
- **A page of several cards lays them out as masonry** from 768 px: two columns that cards fill top to bottom, the left column first, so cards of different heights pack without gaps and Tab order matches what the eye reads. One column on phones.
- **The section a page is about comes first, full width**, with a picture of what its setting does where one helps (the Study day bar on Settings).
- **A long page of sections gets a section index** in a narrow column to its left, from 1024 px: one short dash per section, the section in view in the accent. Hovering the dashes themselves (with a little padding), or tabbing into the index, opens the section names as a list of links over them, like Notion's page outline; it stays open while the pointer is on it. The rest of the gutter does nothing. It is a `nav` with real links; the current one has `aria-current="location"`. Below 1024 px it is hidden.
- **A page with a section index hides the browser's scrollbar** from 1024 px, since the index shows where you are; it still scrolls by wheel, trackpad, keys and touch. Every page keeps the scrollbar's width from 1024 px (a stable gutter, padding where it is hidden), so content never shifts between pages. Below 1024 px the scrollbar stays.
- **Rows show a value with an action beside it** ("Email · asdf@… · Change"). The action opens its form in place, inside the card, on a muted background.
- **Pickers are searchable comboboxes**, never the browser's own select: the input shows the current choice, typing narrows the list (by name, offset or hour, as fits), arrows and Enter pick, a click or tap picks, and a touch swipe scrolls the list.
- **Preferences save as they change**, with a quiet "Saving…" / "Saved" beside the field and, on failure, an inline error with "Try again" that restores the old value. **Changes that need a Password are forms** with a primary submit and a plain Cancel. **A setting made of several values that only mean something together** (a Deck's Plan) is a form too, opened in place in its card, with a primary submit and a plain Cancel, so the User sees what it means before it takes effect.
- **Buttons are pills.** A primary action is filled with the accent; others are outlined in ink.
- A confirmation after a form ("Password changed…") is a short line on the accent background with a check, in place of the form.

## Handwriting

Writing an answer by hand on the study screen, in write-and-grade before Check, is a board: settled by the BAN-45 prototype (branch `dkomeza/ban-45-decide-the-tablet-layout-for-handwriting-proto-j`, variant `j`, "Bare board"). Later handwriting screens, such as the transcription after Check, follow it.

- **The canvas takes the rest of the screen**, between the study screen's top bar and its dock, edge to edge, on grid paper (a 24 px grid in the hairline colour, on the card colour). The page itself never scrolls while it shows: the canvas is a viewport of its own, which pans and zooms.
- **The Front sits on the paper**, like an image on a board, at the same place at every width: the canvas's top-left, with a small "Front" label above it. It is a rounded card with a hairline ring and a soft shadow, and no chrome of its own: no header, menu or fold. Tapped, it is selected: an accent frame with a round handle at each corner. A drag anywhere on it moves it, a corner scales it about the opposite one (40% to 250%, its type, Formulas and Image together), and a tap on the paper lets go of it. From the keyboard, it takes the focus; arrows move it, + and − scale it, and 0 sets it back to 100%. The next Card's Front starts at the scale the User last chose.
- **Its width**: 416 px at 100% on a canvas from 1000 px wide (a desktop, a landscape tablet), so it reads as a column beside the room to write; narrower, the canvas's width less the tool bar's, so on a phone and a tablet in portrait it spans the top of the canvas and the writing goes below it.
- **A long Front** starts scaled down so it shows whole within 60% of the canvas's height (never below 40%). It never scrolls inside itself or folds; its corners scale it up to read it, and the board's zoom does the same for it and the ink together.
- **The tool bar** is a vertical pill at the right edge, centred: pen, its three thicknesses (fine, medium, bold dots), eraser, then undo, redo and clear below a hairline.
- **The zoom control** is a pill at the bottom-left: −, the zoom (100%), +, and Fit, which shows the Front and all the ink at once.
- **The dock** stays as in write-and-grade: I don't know, then Check, the wider. The top bar stays as it is.
- Below 1024 px the Front's corner handles, the tools and the zoom's buttons keep 44 px touch targets.

## Touch, contrast and motion

- Below 1024 px every interactive control is at least 44 px tall, and icon-only buttons are 44×44. Desktop keeps compact sizes.
- Text and controls meet WCAG AA contrast in both themes, including state indicators such as the selected theme (3:1). Focus rings are always visible.
- Animation respects `prefers-reduced-motion`.
