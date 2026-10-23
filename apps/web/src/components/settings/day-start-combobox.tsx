import { useCallback } from "react";
import { Combobox } from "@/components/settings/combobox";
import { dayStartLabel, matchHours } from "@/lib/time";

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: dayStartLabel(hour),
}));

/** The Day start picker: the 24 whole hours, narrowed as you type ("6", "6 pm", "noon"). */
export function DayStartCombobox({
  value,
  onChange,
  labelledBy,
}: {
  value: number;
  onChange: (hour: number) => void;
  labelledBy: string;
}) {
  const search = useCallback(
    (query: string) => matchHours(query).flatMap((hour) => HOURS[hour] ?? []),
    [],
  );
  return (
    <Combobox
      options={HOURS}
      value={String(value)}
      onPick={(hour) => onChange(Number(hour))}
      search={search}
      labelledBy={labelledBy}
      placeholder="Pick an hour"
      searchPlaceholder="Search: 6, 6 pm or noon"
      noMatch={(query) => `No hour matches “${query}”.`}
      chevron
    />
  );
}
