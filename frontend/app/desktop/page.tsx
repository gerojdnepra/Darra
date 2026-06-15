import type { Metadata } from "next";
import { DesktopControlCenter } from "@/components/desktop-control-center";

export const metadata: Metadata = {
  title: "Darra Window Manager"
};

export default function DesktopControlPage() {
  return <DesktopControlCenter />;
}
