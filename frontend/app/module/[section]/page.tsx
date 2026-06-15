import { notFound } from "next/navigation";
import { DesktopWindowGroupBadgeOverlay } from "@/components/desktop-window-group-badge";
import { ScalpStationApp } from "@/components/scalp-station-app";
import { desktopModuleSections, isDesktopManagedModuleSectionId } from "@/lib/module-sections";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ section: string }> {
  return desktopModuleSections.map((section) => ({ section }));
}

export default function DesktopModulePage({
  params
}: {
  params: { section: string };
}) {
  if (!isDesktopManagedModuleSectionId(params.section)) {
    notFound();
  }

  return (
    <>
      <DesktopWindowGroupBadgeOverlay windowKey={params.section} />
      <ScalpStationApp desktopSection={params.section} />
    </>
  );
}
