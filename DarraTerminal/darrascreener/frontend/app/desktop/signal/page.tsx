"use client";

import { useEffect, useState } from "react";
import { SignalBillboardOverlay } from "@/components/signal-billboard-overlay";
import {
  getDesktopBridge,
  type DesktopShellState,
  type DesktopSignalOverlayState
} from "@/lib/desktop-shell";
import { normalizeInterfaceLanguage } from "@/lib/interface-language";
import type { InterfaceLanguage } from "@/lib/types";

export default function DesktopSignalOverlayPage() {
  const [overlay, setOverlay] = useState<DesktopSignalOverlayState | null>(null);
  const [interfaceLanguage, setInterfaceLanguage] = useState<InterfaceLanguage>("en");

  useEffect(() => {
    document.body.dataset.desktopShell = "signal-overlay";

    const desktopBridge = getDesktopBridge();
    let cancelled = false;

    const syncLanguage = (state: DesktopShellState) => {
      if (!cancelled) {
        setInterfaceLanguage(normalizeInterfaceLanguage(state.interfaceLanguage));
      }
    };

    if (!desktopBridge) {
      return () => {
        delete document.body.dataset.desktopShell;
      };
    }

    desktopBridge
      .getSignalOverlayState()
      .then((state) => {
        if (!cancelled) {
          setOverlay(state);
        }
      })
      .catch(() => {
        // Overlay page should stay silent when the desktop bridge is temporarily unavailable.
      });

    desktopBridge
      .getState()
      .then((state) => {
        syncLanguage(state);
      })
      .catch(() => undefined);

    const unsubscribe = desktopBridge.onSignalOverlayStateChanged((state) => {
      setOverlay(state);
    });
    const unsubscribeState = desktopBridge.onStateChanged((state) => {
      syncLanguage(state);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeState();
      delete document.body.dataset.desktopShell;
    };
  }, []);

  return (
    <main className="pointer-events-none relative h-screen w-screen overflow-hidden bg-transparent">
      {overlay ? (
        <SignalBillboardOverlay
          key={overlay.id}
          symbol={overlay.symbol}
          bias={overlay.bias}
          severity={overlay.severity}
          preferences={overlay.preferences}
          interfaceLanguage={interfaceLanguage}
          className="absolute inset-0"
        />
      ) : null}
    </main>
  );
}
