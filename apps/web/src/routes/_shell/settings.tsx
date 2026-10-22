import { createFileRoute } from "@tanstack/react-router";
import { useProtoState, useVariant } from "@/prototype/shared";
import { SettingsA } from "@/prototype/variant-a";
import { SettingsB } from "@/prototype/variant-b";
import { SettingsC } from "@/prototype/variant-c";
import { SettingsPaper } from "@/prototype/variant-de";

// PROTOTYPE (BAN-9): three Settings pages, ?variant=a|b|c, states via &state=.
export const Route = createFileRoute("/_shell/settings")({
  component: SettingsSwitch,
});

function SettingsSwitch() {
  const variant = useVariant();
  const state = useProtoState();
  const Page = { a: SettingsA, b: SettingsB, c: SettingsC, d: SettingsPaper, e: SettingsPaper }[variant];
  const props = variant === "e" ? { variant: "e" as const } : {};
  return <Page key={`${variant}-${state}`} {...props} />;
}
