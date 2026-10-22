import { createFileRoute } from "@tanstack/react-router";
import { useProtoState, useVariant } from "@/prototype/shared";
import { SettingsA } from "@/prototype/variant-a";
import { SettingsB } from "@/prototype/variant-b";
import { SettingsC } from "@/prototype/variant-c";

// PROTOTYPE (BAN-9): three Settings pages, ?variant=a|b|c, states via &state=.
export const Route = createFileRoute("/_shell/settings")({
  component: SettingsSwitch,
});

function SettingsSwitch() {
  const variant = useVariant();
  const state = useProtoState();
  const Page = variant === "b" ? SettingsB : variant === "c" ? SettingsC : SettingsA;
  return <Page key={`${variant}-${state}`} />;
}
