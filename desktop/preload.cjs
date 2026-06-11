const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scalpStationDesktop", {
  getState: () => ipcRenderer.invoke("desktop-shell:get-state"),
  openWindow: (key) => ipcRenderer.invoke("desktop-shell:open-window", key),
  closeWindow: (key) => ipcRenderer.invoke("desktop-shell:close-window", key),
  focusWindow: (key) => ipcRenderer.invoke("desktop-shell:focus-window", key),
  updateWindow: (key, patch) => ipcRenderer.invoke("desktop-shell:update-window", key, patch),
  updateAlertMonitorSettings: (patch) =>
    ipcRenderer.invoke("desktop-shell:update-alert-monitor-settings", patch),
  resetLayout: () => ipcRenderer.invoke("desktop-shell:reset-layout"),
  showControlCenter: () => ipcRenderer.invoke("desktop-shell:show-control-center"),
  showSignalOverlay: (payload) => ipcRenderer.invoke("desktop-shell:show-signal-overlay", payload),
  hideSignalOverlay: () => ipcRenderer.invoke("desktop-shell:hide-signal-overlay"),
  getSignalOverlayState: () => ipcRenderer.invoke("desktop-shell:get-signal-overlay-state"),
  onStateChanged: (listener) => {
    const handler = (_event, state) => listener(state);

    ipcRenderer.on("desktop-shell:state-changed", handler);
    return () => {
      ipcRenderer.removeListener("desktop-shell:state-changed", handler);
    };
  },
  onSignalOverlayStateChanged: (listener) => {
    const handler = (_event, state) => listener(state);

    ipcRenderer.on("desktop-shell:signal-overlay-state-changed", handler);
    return () => {
      ipcRenderer.removeListener("desktop-shell:signal-overlay-state-changed", handler);
    };
  }
});
