import type { Metadata } from "next";
import { VatagaDesktopTerminal } from "@/десктопдаратерминал/vataga-desktop-terminal";

export const metadata: Metadata = {
  title: "Experimental Desktop Darra Terminal"
};

export default function DesktopDarraTerminalPage() {
  return <VatagaDesktopTerminal />;
}
