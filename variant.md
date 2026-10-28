# e: Paper dock

Bet: the dock is made of the same paper as the Cards (their surface, hairline border and a soft shadow), so it reads as one more card floating over the list, quiet in both themes, and the accent Move… is the only colour in it.

- Dock: the popover surface with a hairline border and a soft shadow, in both themes.
- Builds on: a (the dock, the checks on the rail, the picker) and b (the "Select cards" button beside the Cards heading, hidden while selecting), as d does; only the dock's surface differs.
- Enter: **Select cards** beside the Cards heading. Leave: ✕ in the dock, Esc, or any Move or Delete.
- Dock contents as a's: "3 selected · 1 not shown", Select all (Select none once every shown Card is), Move… (accent), Delete.
- Picker: as a's, the Move deck sheet with Folders as small-caps headings and each Deck with its mini cover; "Here now" on the current Deck.
- The Move is faked in the browser (no API yet); Delete is real.

States: selecting, selected, picker, picker-one, moved
