import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun, UserRound, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { meQueryOptions } from "@/lib/me";
import { signOut } from "@/lib/sign-out";
import { signedInQueryOptions } from "@/lib/signed-in";
import { THEME_CHOICES, type ThemeChoice, useThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  ThemeChoice,
  unknown
>;

const isThemeChoice = (value: unknown): value is ThemeChoice =>
  THEME_CHOICES.some((choice) => choice.value === value);

/** Signs this browser out and goes to `/login`, or says it couldn't. */
function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  const attempt = async () => {
    setSigningOut(true);
    setFailed(false);
    const ok = await signOut(
      () => authClient.signOut(),
      async () => {
        queryClient.setQueryData(signedInQueryOptions.queryKey, null);
        queryClient.removeQueries({ queryKey: meQueryOptions.queryKey });
        await navigate({ to: "/login" });
      },
    );
    setSigningOut(false);
    setFailed(!ok);
  };

  return { start: () => void attempt(), signingOut, failed };
}

function useEmail(): string | undefined {
  const me = useQuery(meQueryOptions);
  return me.data?.email;
}

function EmailLine() {
  const me = useQuery(meQueryOptions);
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">Signed in as</p>
      <p className="truncate text-sm font-medium">
        {me.status === "success" && me.data.email}
        {me.status === "pending" && " "}
        {me.status === "error" && "Couldn't load who is signed in."}
      </p>
    </div>
  );
}

function ThemePicker() {
  const id = useId();
  const [choice, setChoice] = useThemeChoice();
  return (
    <div className="flex flex-col gap-2">
      <p id={id} className="text-xs text-muted-foreground">
        Theme
      </p>
      <RadioGroup
        aria-labelledby={id}
        value={choice}
        onValueChange={(value) => {
          if (isThemeChoice(value)) setChoice(value);
        }}
        className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 dark:bg-background"
      >
        {THEME_CHOICES.map(({ value, label }) => {
          const Icon = THEME_ICONS[value];
          return (
            <Radio.Root
              key={value}
              value={value}
              className="flex h-9 cursor-default items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-checked:bg-card data-checked:font-medium data-checked:text-foreground data-checked:shadow-sm data-checked:ring-1 data-checked:ring-border dark:data-checked:bg-secondary"
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </Radio.Root>
          );
        })}
      </RadioGroup>
    </div>
  );
}

function SignOutButton() {
  const { start, signingOut, failed } = useSignOut();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="lg"
        className="justify-start"
        disabled={signingOut}
        onClick={start}
      >
        <LogOut aria-hidden />
        Sign out
      </Button>
      {failed && (
        <p className="text-sm text-destructive" role="alert">
          Couldn't sign out. Try again.
        </p>
      )}
    </div>
  );
}

/** What the account menu and sheet hold: the Email, the theme choice and Sign out. */
function AccountPanel() {
  return (
    <div className="flex flex-col gap-5">
      <EmailLine />
      <ThemePicker />
      <SignOutButton />
    </div>
  );
}

/** The account menu at the foot of the sidebar, on wide screens. */
export function AccountMenu() {
  const email = useEmail();
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Account"
        className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-sm transition-colors outline-none hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-sidebar-accent"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
          <UserRound aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{email ?? "Account"}</span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup className="w-72 origin-(--transform-origin) rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Popover.Title className="sr-only">Account</Popover.Title>
            <AccountPanel />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The account sheet the tab bar's Account opens, on narrow screens. */
export function AccountSheet({ triggerClassName }: { triggerClassName?: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={triggerClassName}>
        <UserRound aria-hidden className="size-5" />
        Account
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
        <Dialog.Popup
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85svh] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-t-2xl border-t bg-popover pt-3 text-popover-foreground shadow-lg outline-none",
            "pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))]",
            "transition-transform duration-250 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full",
          )}
        >
          <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border" />
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold tracking-tight">Account</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-mr-2 flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          <AccountPanel />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
