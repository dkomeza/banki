# b: Shelf

Bet: decks are things you pick up, not rows you scan: Home is a wall of deck tiles (two or three to a row, each with its name, the start of its description and when it was made), the sort a picker beside "New deck" in the header, and create and edit happen in a dialog (a sheet on phones), so the pages themselves never change shape; the deck page opens with a cover card holding the deck's name, description, Edit and Delete.

States: `/`: `empty`, `create`, `create-taken`, `newest`. `/decks/$deckId`: `edit`, `delete`, `no-description`, `not-found`.
