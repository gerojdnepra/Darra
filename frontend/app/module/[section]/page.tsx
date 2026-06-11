import { notFound } from "next/navigation";
import { ScalpStationApp } from "@/components/scalp-station-app";
import { desktopModuleSections, isCollapsibleSectionId } from "@/lib/module-sections";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ section: string }> {
  return desktopModuleSections.map((section) => ({ section }));
}

export default function DesktopModulePage({
  params
}: {
  params: { section: string };
}) {
  if (!isCollapsibleSectionId(params.section)) {
    notFound();
  }

  return <ScalpStationApp desktopSection={params.section} />;
}
