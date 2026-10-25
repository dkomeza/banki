# g: Open shelf

Bet: builds on b, Shelf, and makes it quieter: Home keeps b's tiles but flat and wider, two to a row, each with the deck's name, the start of its description and a "0 cards · Created" footer, without b's peeking card or dashed "New deck" tile, and create stays in b's dialog; the deck page splits like Settings, the cards in the wide column and an "About this deck" card beside them with the description, Edit (its form opening in place in the card) and Delete.

States: `/`: `empty`, `create`, `create-taken`, `newest`. `/decks/$deckId`: `edit`, `delete`, `no-description`, `not-found`.
