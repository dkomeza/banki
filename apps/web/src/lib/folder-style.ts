import { createDeviceChoiceStore, useDeviceChoice } from "./device-choice";

/**
 * How a place shows its Folders on this device: Normal as kraft folders in the
 * decks' grid, Compact as rows above the decks. Nothing else changes with it.
 */
export type FolderStyle = "normal" | "compact";

/** Where this device keeps the Folder style, like the theme: it isn't a Setting. */
export const FOLDER_STYLE_KEY = "banki.folderStyle";

/** The Folder style as `storage` remembers it: Normal until Compact is chosen. */
export const createFolderStyleStore = (
  storage: () => Pick<Storage, "getItem" | "setItem"> | undefined,
) =>
  createDeviceChoiceStore<FolderStyle>(FOLDER_STYLE_KEY, ["normal", "compact"], "normal", storage);

const store = createFolderStyleStore(() => globalThis.localStorage);

/** The Folder style on this device, and a way to change it. */
export const useFolderStyle = () => useDeviceChoice(store);
