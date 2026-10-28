# i: Fold away

Bet: what selection mode doesn't need still leaves, but eased: "Select cards" fades out in place, keeping its row's height, while New card and each Card's Tags fold shut over 300 ms, so the list slides up instead of jumping, and back down on Done. The dock rises in.

- Builds on: e (the paper dock, the checks on the rail, the picker), from the round-two verdict: "e, with a more noticeable shadow", and no jumpy layout shift on "Select cards" (option two: animate the layout after they disappear).
- Dock: e's paper pill with a deeper, warmer shadow in light, and in dark a stronger hairline with a near-black shadow, so it lifts clear of the Cards.
- Enter: **Select cards** beside the Cards heading. Leave: ✕ in the dock, Esc, or any Move or Delete.
- Instant under reduced motion. Card text keeps the same right padding in both modes, so it wraps the same.
- The Move is faked in the browser (no API yet); Delete is real.

States: selecting, selected, picker, picker-one, moved
