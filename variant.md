# f: Compact is dense

Bet: Compact is for many decks, so it turns decks into rows too, not just folders: Normal is Variant a (kraft folders and paper stacks in one grid), and Compact lists a place's folders, then its decks, as explorer rows (a small kraft folder or a small index card, the name, what's inside or the description, a ⋯ menu), two or three columns wide from tablet up. Everything else is Variant a's in both: ⋯ menus, the wrapping breadcrumb, the Move… sheet with its Move button, the clash popup whose choices say what they do. The switch sits in Settings' This device card, beside the theme.

States: `/`: `empty`, `new-folder`, `drag`. `/folders/$folderId`: `empty`, `rename`, `move`, `clash`, `delete`, `deep`, `not-found`. `/decks/$deckId`: `move`, `clash`. Each also as `compact-<state>` (Compact for that load) or `normal-<state>`; `?state=compact` opens a plain load in Compact. `/settings` holds the switch.
