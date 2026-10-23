import type { QueryClient } from "@tanstack/react-query";
import { saveSettings, settingsQueryOptions } from "./settings";
import { type SettingsSaver, createSettingsSaver } from "./settings-saver";

/**
 * The signed-in app's one settings saver, per query client. It outlives the
 * Settings page: a save keeps running when the User leaves, and a failure is
 * waiting, with Try again, when they come back.
 */
const savers = new WeakMap<QueryClient, { saver: SettingsSaver; unsubscribe: () => void }>();

/**
 * The app's settings saver, made on first use from the Settings in the query
 * cache (which must hold them: the Settings page loads them first). It keeps
 * the cache in step with each save's answer, and takes every read that
 * reaches the cache (a refetch, the first fill) whether or not a page is open.
 */
export function settingsSaverFor(
  queryClient: QueryClient,
  { save = saveSettings }: { save?: typeof saveSettings } = {},
): SettingsSaver {
  const existing = savers.get(queryClient);
  if (existing !== undefined) return existing.saver;

  const { queryKey } = settingsQueryOptions();
  const initial = queryClient.getQueryData(queryKey);
  if (initial === undefined) throw new Error("The Settings aren't loaded yet");
  const saver = createSettingsSaver({
    initial,
    save: (patch) => save(patch),
    onStored: (read) => queryClient.setQueryData(queryKey, read),
  });
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query.queryKey[0] !== queryKey[0]) return;
    const read = queryClient.getQueryData(queryKey);
    if (read !== undefined) saver.sync(read);
  });
  savers.set(queryClient, { saver, unsubscribe });
  return saver;
}

/**
 * Forgets the app's settings saver, as signing out does, so the next sign-in
 * starts clean. A save still under way finishes without touching the cache.
 */
export function dropSettingsSaver(queryClient: QueryClient) {
  const entry = savers.get(queryClient);
  if (entry === undefined) return;
  savers.delete(queryClient);
  entry.unsubscribe();
  entry.saver.dispose();
}
