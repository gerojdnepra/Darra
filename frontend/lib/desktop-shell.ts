import type {
  Bias,
  InterfaceLanguage,
  NotificationPreferences,
  ScreenerAlert,
  SignalBillboardPreferences
} from "./types";
import type {
  DesktopManagedModuleSectionId,
  DesktopScenarioWorkspaceId,
  DesktopWorkspaceOpenMode
} from "./module-sections";

export type DesktopManagedWindowKey = "dashboard" | DesktopManagedModuleSectionId;
export type DesktopSignalOverlayBias = Exclude<Bias, "NEUTRAL">;

export interface DesktopDisplaySnapshot {
  id: number;
  label: string;
  primary: boolean;
  scaleFactor: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface DesktopWindowSnapshot {
  key: DesktopManagedWindowKey;
  title: string;
  route: string;
  open: boolean;
  alwaysOnTop: boolean;
  opacity: number;
  displayId: number | null;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export type DesktopWindowGroupColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";
export type DesktopWindowGroupContextMode = "shared" | "locked";

export interface DesktopWindowGroup {
  groupId: string;
  label: string;
  symbol: string | null;
  color: DesktopWindowGroupColor;
  contextMode: DesktopWindowGroupContextMode;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopWindowGroupsState {
  groups: Record<string, DesktopWindowGroup>;
  assignments: Record<DesktopManagedWindowKey, string | null>;
}

export interface DesktopCreateWindowGroupRequest {
  label: string;
  symbol?: string | null;
  color?: DesktopWindowGroupColor;
  contextMode?: DesktopWindowGroupContextMode;
}

export interface DesktopSavedLayoutWindowState {
  open: boolean;
  alwaysOnTop: boolean;
  opacity: number;
  displayId: number | null;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface DesktopSavedLayoutSummary {
  name: string;
  createdAt: string;
  updatedAt: string;
  openWindowCount: number;
}

export interface DesktopSavedLayoutExport {
  version: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  windows: Record<DesktopManagedWindowKey, DesktopSavedLayoutWindowState>;
}

export type DesktopMonitorRole = "primary" | "chart" | "execution" | "risk" | "review";

export interface DesktopMonitorProfileRoleAssignment {
  displayId: number | null;
}

export interface DesktopMonitorProfileSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  roles: Record<DesktopMonitorRole, DesktopMonitorProfileRoleAssignment>;
  capturedDisplays: DesktopDisplaySnapshot[];
}

export interface DesktopMonitorProfileSaveRequest {
  name: string;
  roles: Record<DesktopMonitorRole, DesktopMonitorProfileRoleAssignment>;
}

export interface DesktopScenarioWorkspaceSummary {
  id: DesktopScenarioWorkspaceId;
  windows: DesktopManagedModuleSectionId[];
  windowCount: number;
}

export interface DesktopShellState {
  frontendBaseUrl: string;
  backendWsUrl: string;
  interfaceLanguage: InterfaceLanguage;
  displays: DesktopDisplaySnapshot[];
  windowGroups: DesktopWindowGroupsState;
  windows: DesktopWindowSnapshot[];
}

export interface DesktopWindowUpdate {
  alwaysOnTop?: boolean;
  opacity?: number;
  displayId?: number | null;
}

export interface DesktopSignalOverlayRequest {
  eventId: string;
  symbol: string;
  bias: DesktopSignalOverlayBias;
  severity: ScreenerAlert["severity"];
  preferences: SignalBillboardPreferences;
}

export interface DesktopSignalOverlayState extends DesktopSignalOverlayRequest {
  id: string;
}

export interface DesktopAlertMonitorSettings {
  backendWsUrl?: string;
  interfaceLanguage?: InterfaceLanguage;
  soundEnabled: boolean;
  signalSoundEnabled: boolean;
  signalAnimationEnabled: boolean;
  signalBillboard: SignalBillboardPreferences;
  notifications: NotificationPreferences;
}

export interface DesktopShellBridge {
  getState: () => Promise<DesktopShellState>;
  openWindow: (key: DesktopManagedWindowKey) => Promise<DesktopShellState>;
  closeWindow: (key: DesktopManagedWindowKey) => Promise<DesktopShellState>;
  focusWindow: (key: DesktopManagedWindowKey) => Promise<DesktopShellState>;
  updateWindow: (
    key: DesktopManagedWindowKey,
    patch: DesktopWindowUpdate
  ) => Promise<DesktopShellState>;
  updateAlertMonitorSettings: (patch: DesktopAlertMonitorSettings) => Promise<void>;
  resetLayout: () => Promise<DesktopShellState>;
  listWorkspaces: () => Promise<DesktopScenarioWorkspaceSummary[]>;
  openWorkspace: (
    id: DesktopScenarioWorkspaceId,
    mode: DesktopWorkspaceOpenMode
  ) => Promise<DesktopShellState>;
  listLayouts: () => Promise<DesktopSavedLayoutSummary[]>;
  saveCurrentLayout: (name: string) => Promise<DesktopSavedLayoutSummary[]>;
  loadLayout: (name: string) => Promise<DesktopShellState>;
  deleteLayout: (name: string) => Promise<DesktopSavedLayoutSummary[]>;
  exportLayout: (name: string) => Promise<DesktopSavedLayoutExport>;
  importLayout: (payload: string) => Promise<DesktopSavedLayoutSummary[]>;
  listDisplays: () => Promise<DesktopDisplaySnapshot[]>;
  listMonitorProfiles: () => Promise<DesktopMonitorProfileSummary[]>;
  saveMonitorProfile: (
    profile: DesktopMonitorProfileSaveRequest
  ) => Promise<DesktopMonitorProfileSummary[]>;
  applyMonitorProfile: (profileId: string) => Promise<DesktopShellState>;
  listGroups: () => Promise<DesktopWindowGroupsState>;
  createGroup: (payload: DesktopCreateWindowGroupRequest) => Promise<DesktopShellState>;
  updateGroupSymbol: (groupId: string, symbol: string | null) => Promise<DesktopShellState>;
  assignWindowToGroup: (
    key: DesktopManagedWindowKey,
    groupId: string
  ) => Promise<DesktopShellState>;
  unassignWindowFromGroup: (key: DesktopManagedWindowKey) => Promise<DesktopShellState>;
  showControlCenter: () => Promise<void>;
  showSignalOverlay: (payload: DesktopSignalOverlayRequest) => Promise<void>;
  hideSignalOverlay: () => Promise<void>;
  getSignalOverlayState: () => Promise<DesktopSignalOverlayState | null>;
  onStateChanged: (listener: (state: DesktopShellState) => void) => () => void;
  onSignalOverlayStateChanged: (
    listener: (state: DesktopSignalOverlayState | null) => void
  ) => () => void;
}

export const getDesktopBridge = (): DesktopShellBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.scalpStationDesktop ?? null;
};

declare global {
  interface Window {
    scalpStationDesktop?: DesktopShellBridge;
  }
}
