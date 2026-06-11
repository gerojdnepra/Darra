"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (/electron/i.test(navigator.userAgent)) {
      return;
    }

    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return null;
}
