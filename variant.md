# d: Folders switch

Bet: a and b as one design, with Normal / Compact deciding only how a place's folders look: Normal shows a's kraft folders in the stacks' grid, Compact shows b's explorer rows above the stacks, and everything else (the ⋯ menus on every tile and row, the breadcrumb that wraps, a's Move… sheet with its Move button, a's clash popup whose choices say what they do) stays the same in both. The switch sits in Settings' This device card, beside the theme: a per-device choice, like the A–Z/Newest sort.

States: `/`: `empty`, `new-folder`, `drag`. `/folders/$folderId`: `empty`, `rename`, `move`, `clash`, `delete`, `deep`, `not-found`. `/decks/$deckId`: `move`, `clash`. Each also as `compact-<state>` (Compact for that load) or `normal-<state>`; `?state=compact` opens a plain load in Compact. `/settings` holds the switch.
