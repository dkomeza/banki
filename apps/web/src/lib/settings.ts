import { type SettingsPatch, SettingsResponse } from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { ApiRequestError } from "./query";
import { deviceTimezone as browserTimezone } from "./time";

/** The User's Settings, from `GET /api/settings`. */
export const settingsQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await client.api.settings.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return SettingsResponse.parse(await res.json());
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
    const settings = await queryClient.ensureQueryData(options);
    if (settings.timezone !== null) return;
    const res = await client.api.settings.timezone.initial.$put({
      json: { timezone: deviceTimezone() },
    });
    if (!res.ok) return;
    queryClient.setQueryData(options.queryKey, SettingsResponse.parse(await res.json()));
  } catch {
    // Can't reach Banki: the next signed-in load tries again.
  }
}
