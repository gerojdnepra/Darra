/// <reference types="@capacitor/local-notifications" />

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.troesh.scalpstation",
  appName: "Scalp Station",
  webDir: "out",
  server: {
    androidScheme: "http",
    cleartext: true
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_scalpstation",
      iconColor: "#38bdf8",
      sound: "signal_chime.wav",
      presentationOptions: ["sound", "banner", "list"]
    }
  }
};

export default config;
