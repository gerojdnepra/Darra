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
  listWorkspaces: () => ipcRenderer.invoke("desktop-shell:list-workspaces"),
  openWorkspace: (id, mode) => ipcRenderer.invoke("desktop-shell:open-workspace", id, mode),
  listLayouts: () => ipcRenderer.invoke("desktop-shell:list-layouts"),
  saveCurrentLayout: (name) => ipcRenderer.invoke("desktop-shell:save-current-layout", name),
  loadLayout: (name) => ipcRenderer.invoke("desktop-shell:load-layout", name),
  deleteLayout: (name) => ipcRenderer.invoke("desktop-shell:delete-layout", name),
  exportLayout: (name) => ipcRenderer.invoke("desktop-shell:export-layout", name),
  importLayout: (payload) => ipcRenderer.invoke("desktop-shell:import-layout", payload),
  listDisplays: () => ipcRenderer.invoke("desktop-shell:list-displays"),
  listMonitorProfiles: () => ipcRenderer.invoke("desktop-shell:list-monitor-profiles"),
  saveMonitorProfile: (profile) =>
    ipcRenderer.invoke("desktop-shell:save-monitor-profile", profile),
  applyMonitorProfile: (profileId) =>
    ipcRenderer.invoke("desktop-shell:apply-monitor-profile", profileId),
  listGroups: () => ipcRenderer.invoke("desktop-shell:list-groups"),
  createGroup: (payload) => ipcRenderer.invoke("desktop-shell:create-group", payload),
  updateGroupSymbol: (groupId, symbol) =>
    ipcRenderer.invoke("desktop-shell:update-group-symbol", groupId, symbol),
  assignWindowToGroup: (key, groupId) =>
    ipcRenderer.invoke("desktop-shell:assign-window-to-group", key, groupId),
  unassignWindowFromGroup: (key) =>
    ipcRenderer.invoke("desktop-shell:unassign-window-from-group", key),
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
