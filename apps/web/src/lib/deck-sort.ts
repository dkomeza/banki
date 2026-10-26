import { type DeviceChoiceStore, createDeviceChoiceStore, useDeviceChoice } from "./device-choice";
import type { DeckSort } from "./decks";

/** Where this device keeps the sort of Home and every Folder's page, like the theme: it isn't a Setting. */
export const DECK_SORT_KEY = "banki.deckSort";

export type DeckSortStore = DeviceChoiceStore<DeckSort>;

/** The sort as `storage` remembers it: Alphabetical until Newest is chosen. */
export const createDeckSortStore = (
  storage: () => Pick<Storage, "getItem" | "setItem"> | undefined,
) =>
  createDeviceChoiceStore<DeckSort>(
    DECK_SORT_KEY,
    ["alphabetical", "newest"],
    "alphabetical",
    storage,
  );

const store = createDeckSortStore(() => globalThis.localStorage);

/** The sort on this device, one choice for every place, and a way to change it. */
export const useDeckSort = () => useDeviceChoice(store);
