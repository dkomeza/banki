import { type SettingsPatch, SettingsResponse } from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { ApiRequestError } from "./query";
import { deviceTimezone as browserTimezone } from "./time";

/**
 * The Settings as one request read them, with when that request was issued
 * (on {@link settingsClock}). The server may have changed them after that, so
 * a read issued before a save completed can't stand in for the save's answer
 * (see createSettingsSaver).
 */
export type SettingsRead = { settings: SettingsResponse; issuedAt: number };

/** The clock reads and saves of the Settings are stamped with. */
export const settingsClock = () => performance.now();

/** The User's Settings, from `GET /api/settings`, stamped when the request went out. */
export const settingsQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["settings"],
    queryFn: async (): Promise<SettingsRead> => {
      const issuedAt = settingsClock();
      const res = await client.api.settings.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return { settings: SettingsResponse.parse(await res.json()), issuedAt };
    },
  });

/** Changes any of the Settings, answering them all as stored; throws when that fails. */
export async function saveSettings(
  patch: SettingsPatch,
  client: ApiClient = api,
): Promise<SettingsResponse> {
  const res = await client.api.settings.$patch({ json: patch });
  if (!res.ok) throw new ApiRequestError(res.status);
  return SettingsResponse.parse(await res.json());
}

/**
 * The first fill: when no Timezone is stored yet, sends this browser's zone,
 * which the API stores only if it still has none (another device may have got
 * there first). Never throws: a failed fill is tried again on the next load.
 */
export async function fillFirstTimezone(
  queryClient: QueryClient,
  { client = api, deviceTimezone = browserTimezone } = {},
): Promise<void> {
  const options = settingsQueryOptions(client);
  try {
    const { settings } = await queryClient.ensureQueryData(options);
    if (settings.timezone !== null) return;
    const issuedAt = settingsClock();
    const res = await client.api.settings.timezone.initial.$put({
      json: { timezone: deviceTimezone() },
    });
    if (!res.ok) return;
    queryClient.setQueryData(options.queryKey, {
      settings: SettingsResponse.parse(await res.json()),
      issuedAt,
    });
  } catch {
    // Can't reach Banki: the next signed-in load tries again.
  }
}
