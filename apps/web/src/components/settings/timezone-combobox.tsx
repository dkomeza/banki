import { useCallback, useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/settings/combobox";
import { offsetOf } from "@/lib/time";

/** Every zone this browser knows, plus UTC, which some list only as an alias. */
function allZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : [...zones, "UTC"];
}

/**
 * The zones matching `query` (part of a name, or an offset such as "utc+2"):
 * cities that start with it first, then zones with any part that does, then
 * the rest.
 */
function search(zones: readonly ComboboxOption[], query: string) {
  const q = query.trim().toLowerCase().replaceAll(" ", "_");
  if (q === "") return zones;
  const rank = (zone: string) => {
    const name = zone.toLowerCase();
    if ((name.split("/").at(-1) ?? "").startsWith(q)) return 0;
    if (name.split(/[/_-]/).some((part) => part.startsWith(q))) return 1;
    return 2;
  };
  return zones
    .filter(
      ({ value, detail = "" }) =>
        value.toLowerCase().includes(q) || detail.toLowerCase().replace("−", "-").includes(q),
    )
    .toSorted((a, b) => rank(a.value) - rank(b.value));
}

/** The Timezone picker: every IANA zone with its UTC offset now, searchable. */
export function TimezoneCombobox({
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: string | null;
  onChange: (timezone: string) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  const zones = useMemo(
    () =>
      allZones().map((zone) => ({
        value: zone,
        label: zone.replaceAll("_", " "),
        display: zone,
        detail: offsetOf(zone),
      })),
    [],
  );
  const searchZones = useCallback((query: string) => search(zones, query), [zones]);
  return (
    <Combobox
      options={zones}
      value={value}
      onPick={onChange}
      search={searchZones}
      labelledBy={labelledBy}
      describedBy={describedBy}
      placeholder="Pick your timezone"
      searchPlaceholder="Search: a city, region or UTC+2"
      noMatch={(query) => `No timezone matches “${query}”.`}
    />
  );
}
