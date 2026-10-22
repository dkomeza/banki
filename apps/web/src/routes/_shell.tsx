import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ShellA } from "@/prototype/variant-a";
import { ShellB } from "@/prototype/variant-b";
import { ShellC } from "@/prototype/variant-c";
import { ShellD, ShellE } from "@/prototype/variant-de";
import { useVariant, useVariantTokens } from "@/prototype/shared";
import { PrototypeSwitcher } from "@/prototype/switcher";
import "@/prototype/prototype.css";

// PROTOTYPE (BAN-9): the shell switches with ?variant=a|b|c.
// A pathless layout around every signed-in screen. /login, /setup and the
// "Can't reach Banki" error stay full-screen, outside it.
export const Route = createFileRoute("/_shell")({
  component: ShellSwitch,
});

function ShellSwitch() {
  const variant = useVariant();
  useVariantTokens(variant);
  const Shell = { a: ShellA, b: ShellB, c: ShellC, d: ShellD, e: ShellE }[variant];
  return (
    <>
      <Shell>
        <Outlet />
      </Shell>
      <PrototypeSwitcher />
    </>
  );
}
