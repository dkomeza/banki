import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { FolderStylePicker } from "@/components/settings/folder-style-picker";
import { SettingsCard } from "@/components/settings/parts";
import { THEME_CHOICES, type ThemeChoice, useThemeChoice } from "@/lib/theme";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  ThemeChoice,
  unknown
>;

const isThemeChoice = (value: unknown): value is ThemeChoice =>
  THEME_CHOICES.some((choice) => choice.value === value);

/** This device: choices kept in this browser only, not Settings: the theme and how Folders look. */
export function ThisDeviceCard() {
  const labelId = useId();
  const foldersId = useId();
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
      <div className="flex flex-col gap-2.5">
        <p id={foldersId} className="text-sm text-muted-foreground">
          Folders, for this device only
        </p>
        <FolderStylePicker labelledBy={foldersId} />
        <p className="text-sm text-muted-foreground">
          Compact lists folders as rows above the decks, so more fit on a screen.
        </p>
      </div>
    </SettingsCard>
  );
}
