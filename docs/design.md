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
- **A long page of sections gets a section index** in a narrow column to its left, from 1024 px: one short dash per section, the section in view in the accent. Hovering anywhere in the gutter, or tabbing into it, opens the section names as a list of links, like Notion's page outline. It is a `nav` with real links; the current one has `aria-current="location"`. Below 1024 px it is hidden.
- **Rows show a value with an action beside it** ("Email · asdf@… · Change"). The action opens its form in place, inside the card, on a muted background.
- **Preferences save as they change**, with a quiet "Saving…" / "Saved" beside the field and, on failure, an inline error with "Try again" that restores the old value. **Changes that need a Password are forms** with a primary submit and a plain Cancel.
- **Buttons are pills.** A primary action is filled with the accent; others are outlined in ink.
- A confirmation after a form ("Password changed…") is a short line on the accent background with a check, in place of the form.

## Touch, contrast and motion

- Below 1024 px every interactive control is at least 44 px tall, and icon-only buttons are 44×44. Desktop keeps compact sizes.
- Text and controls meet WCAG AA contrast in both themes, including state indicators such as the selected theme (3:1). Focus rings are always visible.
- Animation respects `prefers-reduced-motion`.
