import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/page";
import { AccountCard } from "@/components/settings/account-card";
import { AppVersion } from "@/components/settings/app-version";
import { EditorCard } from "@/components/settings/editor-card";
import { GradingCard } from "@/components/settings/grading-card";
import { MacrosCard } from "@/components/settings/macros-rows";
import { type Section, SectionIndex } from "@/components/settings/section-index";
import { StudyCard } from "@/components/settings/study-card";
import { StudyDayCard } from "@/components/settings/study-day-card";
import { ThisDeviceCard } from "@/components/settings/this-device-card";
import { decksQueryOptions } from "@/lib/decks";
import { meQueryOptions } from "@/lib/me";
import { settingsQueryOptions } from "@/lib/settings";
import { useHiddenScrollbar } from "@/lib/use-hidden-scrollbar";

export const Route = createFileRoute("/_shell/settings")({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(settingsQueryOptions()),
      queryClient.ensureQueryData(meQueryOptions),
      queryClient.ensureQueryData(decksQueryOptions()),
    ]),
  component: SettingsPage,
});

// In page order. Later features add their cards, and their sections here.
const SECTIONS: readonly Section[] = [
  { id: "study-day", title: "Study day" },
  { id: "study", title: "Study" },
  { id: "grading", title: "Grading" },
  { id: "editor", title: "Editor" },
  { id: "macros", title: "Math macros" },
  { id: "account", title: "Account" },
  { id: "this-device", title: "This device" },
];

function SettingsPage() {
  // The section index stands in for the scrollbar.
  useHiddenScrollbar();
  return (
    <Page width="cards">
      <div className="lg:grid lg:grid-cols-[2rem_minmax(0,1fr)] lg:gap-8">
        <SectionIndex label="Settings sections" sections={SECTIONS} />
        <div className="flex flex-col gap-8 lg:gap-10">
          <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
            Settings
          </h1>
          <StudyDayCard />
          {/* Masonry from 768 px: cards fill the left column first, then the right, so
              the Tab order and the index follow what the eye reads. */}
          <div className="gap-x-5 md:columns-2 lg:gap-x-6 [&>section]:mb-5 [&>section]:break-inside-avoid lg:[&>section]:mb-6">
            <StudyCard />
            <GradingCard />
            <EditorCard />
            <MacrosCard />
            <AccountCard />
            <ThisDeviceCard />
          </div>
          {/* Not a section, so not in the index; fetched on its own, so never waited on. */}
          <AppVersion />
        </div>
      </div>
    </Page>
  );
}
