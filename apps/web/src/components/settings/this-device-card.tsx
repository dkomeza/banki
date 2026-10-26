import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { SettingsCard } from "@/components/settings/parts";
import { THEME_CHOICES, type ThemeChoice, useThemeChoice } from "@/lib/theme";
import { MiniFolders, MiniRows, MiniStacks, StylePicker } from "@/proto/ui/style-picker";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  ThemeChoice,
  unknown
>;

const isThemeChoice = (value: unknown): value is ThemeChoice =>
  THEME_CHOICES.some((choice) => choice.value === value);

/** This device: choices kept in this browser only, not Settings: the theme and, in
 * the BAN-10 prototype's Variant f, how Home and the folder pages list things. */
export function ThisDeviceCard() {
  const labelId = useId();
  const listId = useId();
  const [choice, setChoice] = useThemeChoice();
  return (
    <SettingsCard id="this-device" title="This device">
      <div className="flex flex-col gap-2.5">
        <p id={labelId} className="text-sm text-muted-foreground">
          Theme, for this device only
        </p>
        <RadioGroup
          aria-labelledby={labelId}
          value={choice}
          onValueChange={(value) => {
            if (isThemeChoice(value)) setChoice(value);
          }}
          className="grid grid-cols-3 gap-2"
        >
          {THEME_CHOICES.map(({ value, label }) => {
            const Icon = THEME_ICONS[value];
            return (
              <Radio.Root
                key={value}
                value={value}
                className="flex h-16 cursor-default flex-col items-center justify-center gap-1 rounded-xl border border-border text-sm text-muted-foreground transition-colors motion-reduce:transition-none outline-none select-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-checked:border-primary data-checked:bg-accent data-checked:font-medium data-checked:text-primary data-checked:ring-1 data-checked:ring-primary"
              >
                <Icon aria-hidden className="size-5" />
                {label}
              </Radio.Root>
            );
          })}
        </RadioGroup>
      </div>
      {/* PROTOTYPE (BAN-10), Variant f: Normal tiles or Compact rows, for this device. */}
      <div className="flex flex-col gap-2.5">
        <p id={listId} className="text-sm text-muted-foreground">
          Folders and decks, for this device only
        </p>
        <StylePicker
          labelledBy={listId}
          pictures={{
            normal: (
              <>
                <MiniFolders />
                <MiniStacks />
              </>
            ),
            compact: <MiniRows count={4} />,
          }}
        />
        <p className="text-sm text-muted-foreground">
          Compact lists folders and decks as rows, so a long list fits on one screen.
        </p>
      </div>
    </SettingsCard>
  );
}
