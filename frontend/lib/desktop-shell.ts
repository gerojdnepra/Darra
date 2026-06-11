import type {
  Bias,
  InterfaceLanguage,
  NotificationPreferences,
  ScreenerAlert,
  SignalBillboardPreferences
} from "./types";
import type { DesktopManagedModuleSectionId } from "./module-sections";

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

export interface DesktopShellState {
  frontendBaseUrl: string;
  backendWsUrl: string;
  interfaceLanguage: InterfaceLanguage;
  displays: DesktopDisplaySnapshot[];
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
