// PROTOTYPE (BAN-10), Variant e: Settings' Decks card, holding the layout of
// Home and the folder pages. A Setting, so the same on every device (the
// prototype keeps it in this browser only).
import { useId } from "react";
import { SettingsCard } from "@/components/settings/parts";
import { MiniFolders, MiniRows, MiniStacks, StylePicker } from "./style-picker";

export function DecksCard() {
  const labelId = useId();
  return (
    <SettingsCard id="decks" title="Decks">
      <div className="flex flex-col gap-2.5">
        <p id={labelId} className="text-sm text-muted-foreground">
          Layout
        </p>
        <StylePicker
          labelledBy={labelId}
          pictures={{
            normal: (
              <>
                <MiniFolders />
                <MiniStacks />
              </>
            ),
            compact: (
              <>
                <MiniRows count={2} />
                <MiniStacks />
              </>
            ),
          }}
        />
        <p className="text-sm text-muted-foreground">
          Normal shows folders as kraft folders, with a ⋯ menu on every folder and deck. Compact
          lists folders as rows, keeps the breadcrumb to one line, and moves with one tap. The same
          on every device.
        </p>
      </div>
    </SettingsCard>
  );
}
