# d: Desk

Bet: moving between decks and adding one should cost nothing: Home is one list card with a "New deck" field always at its top (type a name, press Enter, land on the deck; a description is one tap away), the sort in the card's own header; from 1024 px the deck page keeps that list beside the deck with the current one marked, and Edit turns the deck's heading and description into fields where they stand, with Delete in the "…" menu beside it.

States: `/`: `empty`, `create`, `create-taken`, `newest`. `/decks/$deckId`: `edit`, `delete`, `no-description`, `not-found`.
