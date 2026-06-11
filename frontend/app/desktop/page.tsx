import type { Metadata } from "next";
import DesktopDarraTerminalPage from "../desktopdaraterminal/page";

export const metadata: Metadata = {
  title: "Darra Terminal"
};

export default function DesktopControlPage() {
  return <DesktopDarraTerminalPage />;
}
