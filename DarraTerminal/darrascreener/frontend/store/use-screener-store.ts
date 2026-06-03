"use client";

import { Capacitor } from "@capacitor/core";
import { create } from "zustand";
import {
  defaultInterfaceLanguage,
  normalizeInterfaceLanguage
} from "@/lib/interface-language";
import {
  desktopDashboardPanels,
  normalizeDashboardPanelCoordinate,
  normalizeDashboardPanelFreeHeight,
  normalizeDashboardPanelHeight,
  normalizeDashboardPanelLayout,
  normalizeDashboardPanelOrder,
  normalizeDashboardPanelSpan,
  normalizeDashboardPanelWidth
} from "@/lib/module-sections";
import {
  defaultSignalBillboardPreferences,
  normalizeSignalBillboardPreferences
} from "@/lib/signal-billboard";
import {
  defaultSignalSoundId,
  normalizeSignalSoundId
} from "@/lib/signal-sounds";
import {
  defaultDashboardSettings,
  normalizeDashboardSettings
} from "@/lib/settings";
import { renderTelemetry } from "@/lib/render-telemetry";
import {
  defaultSpeechProviderId,
  normalizeSpeechProviderId
} from "@/lib/tts";
import type {
  CollapsibleSectionId,
  DashboardSettings,
  DashboardLayoutMode,
  DashboardPanelLayout,
  DashboardPanelId,
  CreateJournalEntryInput,
  InterfaceLanguage,
  JournalAnalyticsFilters,
  JournalAnalyticsPayload,
  JournalEntryFilters,
  JournalEntryRecord,
  LearningReportFilters,
  LearningReportPayload,
  NotificationPreferences,
  PersistedState,
  ScreenerFrame,
  SignalReplayPayload,
  SignalStatisticsPayload,
  SignalBillboardPreferences,
  SignalSoundId,
  SpeechProviderId,
  UpdateJournalEntryPatch,
  ServerMessage,
  UiPreferences,
  VoiceProfileId
} from "@/lib/types";
import { defaultVoiceProfileId, normalizeVoiceProfileId } from "@/lib/voice-profiles";

const configuredBackendWsUrl =
  process.env.NEXT_PUBLIC_BACKEND_WS_URL?.trim() || "";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const isLoopbackHost = (hostname: string): boolean =>
  loopbackHosts.has(hostname.trim().toLowerCase());

const isNativePlatform = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const isPrivateIpv4Host = (hostname: string): boolean => {
  const match = hostname.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (!match) {
    return false;
  }

  const parts = match.slice(1).map(Number);

  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
};

const normalizeBackendPath = (url: URL): string =>
  !url.pathname || url.pathname === "/" ? "/ws" : url.pathname;

const resolveConfiguredBackendWsUrl = (): string => {
  if (!configuredBackendWsUrl) {
    return "";
  }

  if (typeof window === "undefined") {
    return configuredBackendWsUrl;
  }

  try {
    const parsed = new URL(configuredBackendWsUrl);
    const pageHostname = window.location.hostname;

    if (isLoopbackHost(parsed.hostname) && pageHostname && !isLoopbackHost(pageHostname)) {
      parsed.hostname = pageHostname;
      return parsed.toString();
    }
  } catch {
    return configuredBackendWsUrl;
  }

  return configuredBackendWsUrl;
};

const getDefaultBackendWsUrl = (): string => {
  const resolvedConfiguredUrl = resolveConfiguredBackendWsUrl();

  if (resolvedConfiguredUrl) {
    return resolvedConfiguredUrl;
  }

  if (typeof window !== "undefined") {
    const { hostname } = window.location;

    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      return `ws://${hostname}:3001/ws`;
    }
  }

  return "ws://localhost:3001/ws";
};

const shouldUseDefaultNativeBackendUrl = (
  persistedBackendWsUrl: string,
  defaultBackendWsUrl: string
): boolean => {
  if (!isNativePlatform()) {
    return false;
  }

  try {
    const persisted = new URL(persistedBackendWsUrl);
    const fallback = new URL(defaultBackendWsUrl);

    if (isLoopbackHost(persisted.hostname)) {
      return true;
    }

    return (
      isPrivateIpv4Host(persisted.hostname) &&
      isPrivateIpv4Host(fallback.hostname) &&
      persisted.hostname !== fallback.hostname &&
      persisted.protocol === fallback.protocol &&
      persisted.port === fallback.port &&
      normalizeBackendPath(persisted) === normalizeBackendPath(fallback)
    );
  } catch {
    return false;
  }
};

const resolvePersistedBackendWsUrl = (value: string | undefined): string => {
  const defaultBackendWsUrl = getDefaultBackendWsUrl();
  const persistedBackendWsUrl = value?.trim();

  if (!persistedBackendWsUrl) {
    return defaultBackendWsUrl;
  }

  return shouldUseDefaultNativeBackendUrl(persistedBackendWsUrl, defaultBackendWsUrl)
    ? defaultBackendWsUrl
    : persistedBackendWsUrl;
};

const createDefaultNotificationPreferences = (): NotificationPreferences => ({
  tradeSignals: true,
  liquidationSignals: true,
  systemStatus: true,
  pulseChanges: true
});

const createDefaultUiPreferences = (): UiPreferences => ({
  interfaceLanguage: defaultInterfaceLanguage,
  soundEnabled: true,
  signalAnimationEnabled: true,
  signalSoundEnabled: true,
  signalBillboard: defaultSignalBillboardPreferences,
  selectedSignalSoundId: defaultSignalSoundId,
  speechProvider: defaultSpeechProviderId,
  voiceProfile: defaultVoiceProfileId,
  selectedSpeechVoiceUri: null,
  selectedTtsModelId: null,
  notifications: createDefaultNotificationPreferences(),
  collapsedSections: {
    overview: false,
    filters: false,
    screener: false,
    account: false,
    activeTrades: false,
    riskCenter: false,
    correlationHeatmap: false,
    varPanel: false,
    fundingBasis: false,
    marketFlow: false,
    signalIntelligence: false,
    metaRegimeGovernor: false,
    positionRiskOrchestrator: false,
    regimeMemory: false,
    regimePrediction: false,
    regimeFeedbackCalibration: false,
    pnlAttribution: false,
    signalStatistics: false,
    learningCenter: false,
    tradeJournal: false,
    watchlist: false,
    volumeMilestones: false,
    volumeThresholdMilestones: false,
    alerts: false,
    frameTelemetry: false,
    renderTelemetry: false,
    health: false
  },
  visibleSections: {
    overview: true,
    filters: true,
    screener: true,
    account: true,
    activeTrades: true,
    riskCenter: true,
    correlationHeatmap: true,
    varPanel: true,
    fundingBasis: true,
    marketFlow: true,
    signalIntelligence: true,
    metaRegimeGovernor: true,
    positionRiskOrchestrator: true,
    regimeMemory: true,
    regimePrediction: true,
    regimeFeedbackCalibration: true,
    pnlAttribution: true,
    signalStatistics: true,
    learningCenter: true,
    tradeJournal: true,
    watchlist: true,
    volumeMilestones: true,
    volumeThresholdMilestones: true,
    alerts: true,
    frameTelemetry: true,
    renderTelemetry: true,
    health: true
  },
  dashboardLayoutMode: "free",
  dashboardLayoutModePinned: false,
  dashboardPanelOrder: desktopDashboardPanels,
  dashboardPanelLayout: normalizeDashboardPanelLayout(null)
});

interface ScreenerState {
  connectionState: "connecting" | "open" | "closed";
  latencyMs: number | null;
  frame: ScreenerFrame | null;
  signalStatistics: SignalStatisticsPayload | null;
  signalStatisticsUpdatedAt: number | null;
  signalReplay: SignalReplayPayload | null;
  signalReplayLoading: boolean;
  signalReplayError: string | null;
  journalEntries: JournalEntryRecord[];
  journalAnalytics: JournalAnalyticsPayload | null;
  journalAnalyticsLoading: boolean;
  journalAnalyticsUpdatedAt: number | null;
  learningReport: LearningReportPayload | null;
  learningReportLoading: boolean;
  learningReportUpdatedAt: number | null;
  journalLoading: boolean;
  journalError: string | null;
  selectedJournalEntry: JournalEntryRecord | null;
  backendWsUrl: string;
  settings: DashboardSettings;
  watchlist: string[];
  activeTrades: string[];
  uiPreferences: UiPreferences;
  profileNotes: string;
  search: string;
  lastNotice: string;
  setConnectionState: (value: ScreenerState["connectionState"]) => void;
  applyServerMessage: (message: ServerMessage) => void;
  setSignalReplayLoading: (value: boolean) => void;
  clearSignalReplay: () => void;
  setSelectedJournalEntry: (entry: JournalEntryRecord | null) => void;
  requestJournalEntries: (
    sendMessage: (payload: Record<string, unknown>) => boolean,
    filters?: JournalEntryFilters
  ) => boolean;
  requestJournalAnalytics: (
    sendMessage: (payload: Record<string, unknown>) => boolean,
    filters?: JournalAnalyticsFilters
  ) => boolean;
  requestLearningReport: (
    sendMessage: (payload: Record<string, unknown>) => boolean,
    filters?: LearningReportFilters
  ) => boolean;
  createJournalEntry: (
    sendMessage: (payload: Record<string, unknown>) => boolean,
    input: CreateJournalEntryInput
  ) => boolean;
  updateJournalEntry: (
    sendMessage: (payload: Record<string, unknown>) => boolean,
    id: string,
    patch: UpdateJournalEntryPatch
  ) => boolean;
  deleteJournalEntry: (
    sendMessage: (payload: Record<string, unknown>) => boolean,
    id: string
  ) => boolean;
  setBackendWsUrl: (value: string) => void;
  setSettings: (partial: Partial<DashboardSettings>) => void;
  setSearch: (value: string) => void;
  toggleWatchlist: (symbol: string) => void;
  removeWatchlist: (symbol: string) => void;
  toggleActiveTrade: (symbol: string) => void;
  removeActiveTrade: (symbol: string) => void;
  hydratePersistedState: (state: PersistedState | null) => void;
  setLatency: (value: number | null) => void;
  toggleSection: (section: CollapsibleSectionId) => void;
  setInterfaceLanguage: (value: InterfaceLanguage) => void;
  setSoundEnabled: (value: boolean) => void;
  setSignalAnimationEnabled: (value: boolean) => void;
  setSignalSoundEnabled: (value: boolean) => void;
  setSignalBillboardPreference: (
    key: keyof SignalBillboardPreferences,
    value: number
  ) => void;
  setSelectedSignalSoundId: (value: SignalSoundId) => void;
  setVoiceProfile: (value: VoiceProfileId) => void;
  setSpeechProvider: (value: SpeechProviderId) => void;
  setSelectedSpeechVoiceUri: (value: string | null) => void;
  setSelectedTtsModelId: (value: string | null) => void;
  setNotificationPreference: (
    key: keyof NotificationPreferences,
    value: boolean
  ) => void;
  setSectionVisibility: (section: CollapsibleSectionId, value: boolean) => void;
  setDashboardLayoutMode: (value: DashboardLayoutMode) => void;
  setDashboardPanelOrder: (value: DashboardPanelId[]) => void;
  setDashboardPanelLayout: (value: DashboardPanelLayout) => void;
  setDashboardPanelSpan: (panel: DashboardPanelId, colSpan: number) => void;
  setDashboardPanelSize: (
    panel: DashboardPanelId,
    value: {
      colSpan?: number;
      minHeightPx?: number;
      x?: number;
      y?: number;
      widthPx?: number;
      heightPx?: number;
    }
  ) => void;
  setProfileNotes: (value: string) => void;
}

export const useScreenerStore = create<ScreenerState>((set) => ({
  connectionState: "connecting",
  latencyMs: null,
  frame: null,
  signalStatistics: null,
  signalStatisticsUpdatedAt: null,
  signalReplay: null,
  signalReplayLoading: false,
  signalReplayError: null,
  journalEntries: [],
  journalAnalytics: null,
  journalAnalyticsLoading: false,
  journalAnalyticsUpdatedAt: null,
  learningReport: null,
  learningReportLoading: false,
  learningReportUpdatedAt: null,
  journalLoading: false,
  journalError: null,
  selectedJournalEntry: null,
  backendWsUrl: getDefaultBackendWsUrl(),
  settings: defaultDashboardSettings,
  watchlist: [],
  activeTrades: [],
  uiPreferences: createDefaultUiPreferences(),
  profileNotes: "",
  search: "",
  lastNotice: "waiting for backend",
  setConnectionState: (value) => set({ connectionState: value }),
  applyServerMessage: (message) =>
    set((state) => {
      if (message.type === "welcome") {
        return { lastNotice: message.message };
      }

      if (message.type === "pong") {
        return {
          latencyMs: Math.max(message.receivedAt - message.sentAt, 0)
        };
      }

      if (message.type === "risk_snapshot" || message.type === "risk_update") {
        return state;
      }

      if (message.type === "signal_statistics") {
        return {
          signalStatistics: message.payload,
          signalStatisticsUpdatedAt: message.generatedAt
        };
      }

      if (message.type === "signal_replay") {
        return {
          signalReplay: message.payload,
          signalReplayLoading: false,
          signalReplayError: message.error ?? null
        };
      }

      if (message.type === "journal_entries") {
        return {
          journalEntries: message.payload,
          journalLoading: false,
          journalError: null
        };
      }

      if (message.type === "journal_analytics") {
        return {
          journalAnalytics: message.payload,
          journalAnalyticsLoading: false,
          journalAnalyticsUpdatedAt: message.generatedAt,
          journalError: null
        };
      }

      if (message.type === "learning_report") {
        return {
          learningReport: message.payload,
          learningReportLoading: false,
          learningReportUpdatedAt: message.generatedAt
        };
      }

      if (message.type === "journal_error") {
        return {
          journalLoading: false,
          journalAnalyticsLoading: false,
          journalError: message.error
        };
      }

      if (message.type === "journal_auto_event") {
        const eventLabel =
          message.payload.event === "created"
            ? "created"
            : message.payload.event === "closed"
              ? "closed"
              : "updated";

        return {
          lastNotice: `Auto journal entry ${eventLabel} from Binance position.`
        };
      }

      if (message.type === "position_sizing") {
        return {
          lastNotice: `Position sizing ready for ${message.payload.symbol}.`
        };
      }

      if (message.type === "snapshot") {
        renderTelemetry.markFrameUpdateStarted(message.frame.generatedAt);

        return {
          frame: message.frame,
          lastNotice: message.frame.status.message
        };
      }

      if (message.type === "frame_patch") {
        const mergeStartedAt =
          typeof performance !== "undefined" ? performance.now() : null;
        const nextFrame = state.frame
          ? { ...state.frame, ...message.changed }
          : (message.changed as ScreenerFrame);

        if (mergeStartedAt !== null) {
          renderTelemetry.recordPatchMerge(performance.now() - mergeStartedAt);
        }

        renderTelemetry.markFrameUpdateStarted(nextFrame.generatedAt ?? null);

        return {
          frame: nextFrame,
          lastNotice: nextFrame.status?.message ?? state.lastNotice
        };
      }

      renderTelemetry.markFrameUpdateStarted(message.generatedAt);

      return {
        frame: state.frame ? { ...state.frame, ...message } : message,
        lastNotice: message.status.message
      };
    }),
  setSignalReplayLoading: (value) =>
    set((state) => ({
      signalReplayLoading: value,
      signalReplayError: value ? null : state.signalReplayError
    })),
  clearSignalReplay: () =>
    set({
      signalReplay: null,
      signalReplayLoading: false,
      signalReplayError: null
    }),
  setSelectedJournalEntry: (entry) => set({ selectedJournalEntry: entry }),
  requestJournalEntries: (sendMessage, filters) => {
    set({ journalLoading: true, journalError: null });
    const sent = sendMessage({
      type: "request_journal_entries",
      filters
    });

    if (!sent) {
      set({ journalLoading: false, journalError: "Connection is not ready yet." });
    }

    return sent;
  },
  requestJournalAnalytics: (sendMessage, filters) => {
    set({ journalAnalyticsLoading: true, journalError: null });
    const sent = sendMessage({
      type: "request_journal_analytics",
      filters
    });

    if (!sent) {
      set({
        journalAnalyticsLoading: false,
        journalError: "Connection is not ready yet."
      });
    }

    return sent;
  },
  requestLearningReport: (sendMessage, filters) => {
    set({ learningReportLoading: true });
    const sent = sendMessage({
      type: "request_learning_report",
      filters
    });

    if (!sent) {
      set({ learningReportLoading: false });
    }

    return sent;
  },
  createJournalEntry: (sendMessage, input) => {
    set({ journalLoading: true, journalError: null });
    const sent = sendMessage({
      type: "create_journal_entry",
      payload: input
    });

    if (!sent) {
      set({ journalLoading: false, journalError: "Connection is not ready yet." });
    }

    return sent;
  },
  updateJournalEntry: (sendMessage, id, patch) => {
    set({ journalLoading: true, journalError: null });
    const sent = sendMessage({
      type: "update_journal_entry",
      id,
      patch
    });

    if (!sent) {
      set({ journalLoading: false, journalError: "Connection is not ready yet." });
    }

    return sent;
  },
  deleteJournalEntry: (sendMessage, id) => {
    set({ journalLoading: true, journalError: null });
    const sent = sendMessage({
      type: "delete_journal_entry",
      id
    });

    if (!sent) {
      set({ journalLoading: false, journalError: "Connection is not ready yet." });
    }

    return sent;
  },
  setBackendWsUrl: (value) =>
    set({
      backendWsUrl: value.trim()
    }),
  setSettings: (partial) =>
    set((state) => ({
      settings: normalizeDashboardSettings({
        ...state.settings,
        ...partial
      })
    })),
  setSearch: (value) => set({ search: value }),
  toggleWatchlist: (symbol) =>
    set((state) => {
      const upper = symbol.toUpperCase();
      const next = state.watchlist.includes(upper)
        ? state.watchlist.filter((item) => item !== upper)
        : [...state.watchlist, upper];

      return { watchlist: next };
    }),
  removeWatchlist: (symbol) =>
    set((state) => ({
      watchlist: state.watchlist.filter((item) => item !== symbol.toUpperCase())
    })),
  toggleActiveTrade: (symbol) =>
    set((state) => {
      const upper = symbol.toUpperCase();
      const next = state.activeTrades.includes(upper)
        ? state.activeTrades.filter((item) => item !== upper)
        : [...state.activeTrades, upper];

      return { activeTrades: next };
    }),
  removeActiveTrade: (symbol) =>
    set((state) => ({
      activeTrades: state.activeTrades.filter((item) => item !== symbol.toUpperCase())
    })),
  toggleSection: (section) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        collapsedSections: {
          ...state.uiPreferences.collapsedSections,
          [section]: !state.uiPreferences.collapsedSections[section]
        }
      }
    })),
  setInterfaceLanguage: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        interfaceLanguage: value
      }
    })),
  setSoundEnabled: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        soundEnabled: value
      }
    })),
  setSignalAnimationEnabled: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        signalAnimationEnabled: value
      }
    })),
  setSignalSoundEnabled: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        signalSoundEnabled: value
      }
    })),
  setSignalBillboardPreference: (key, value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        signalBillboard: normalizeSignalBillboardPreferences({
          ...state.uiPreferences.signalBillboard,
          [key]: value
        })
      }
    })),
  setSelectedSignalSoundId: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        selectedSignalSoundId: value
      }
    })),
  setVoiceProfile: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        voiceProfile: value
      }
    })),
  setSpeechProvider: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        speechProvider: value
      }
    })),
  setSelectedSpeechVoiceUri: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        selectedSpeechVoiceUri: value
      }
    })),
  setSelectedTtsModelId: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        selectedTtsModelId: value
      }
    })),
  setNotificationPreference: (key, value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        notifications: {
          ...state.uiPreferences.notifications,
          [key]: value
        }
      }
    })),
  setSectionVisibility: (section, value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        visibleSections: {
          ...state.uiPreferences.visibleSections,
          [section]: value
        }
      }
    })),
  setDashboardLayoutMode: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        dashboardLayoutMode: value === "free" ? "free" : "grid",
        dashboardLayoutModePinned: true
      }
    })),
  setDashboardPanelOrder: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        dashboardPanelOrder: normalizeDashboardPanelOrder(value)
      }
    })),
  setDashboardPanelLayout: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        dashboardPanelLayout: normalizeDashboardPanelLayout(value)
      }
    })),
  setDashboardPanelSpan: (panel, colSpan) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        dashboardPanelLayout: {
          ...normalizeDashboardPanelLayout(state.uiPreferences.dashboardPanelLayout),
          [panel]: {
            ...normalizeDashboardPanelLayout(state.uiPreferences.dashboardPanelLayout)[panel],
            colSpan: normalizeDashboardPanelSpan(panel, colSpan)
          }
        }
      }
    })),
  setDashboardPanelSize: (panel, value) =>
    set((state) => {
      const currentLayout = normalizeDashboardPanelLayout(
        state.uiPreferences.dashboardPanelLayout
      );
      const currentPanelLayout = currentLayout[panel];

      return {
        uiPreferences: {
          ...state.uiPreferences,
          dashboardPanelLayout: {
            ...currentLayout,
            [panel]: {
              colSpan: normalizeDashboardPanelSpan(
                panel,
                value.colSpan ?? currentPanelLayout?.colSpan
              ),
              minHeightPx: normalizeDashboardPanelHeight(
                panel,
                value.minHeightPx ?? currentPanelLayout?.minHeightPx
              ),
              x: normalizeDashboardPanelCoordinate(
                value.x,
                currentPanelLayout?.x ?? 0
              ),
              y: normalizeDashboardPanelCoordinate(
                value.y,
                currentPanelLayout?.y ?? 0
              ),
              widthPx:
                value.widthPx === undefined
                  ? currentPanelLayout?.widthPx
                  : normalizeDashboardPanelWidth(panel, value.widthPx),
              heightPx: normalizeDashboardPanelFreeHeight(
                panel,
                value.heightPx ?? currentPanelLayout?.heightPx
              )
            }
          }
        }
      };
    }),
  setProfileNotes: (value) => set({ profileNotes: value }),
  hydratePersistedState: (state) => {
    const defaultUiPreferences = createDefaultUiPreferences();

    if (!state) {
      set({
        backendWsUrl: getDefaultBackendWsUrl(),
        settings: defaultDashboardSettings,
        watchlist: [],
        activeTrades: [],
        profileNotes: "",
        uiPreferences: defaultUiPreferences
      });
      return;
    }

    const soundEnabled =
      state.uiPreferences?.soundEnabled ??
      state.uiPreferences?.voiceAlertsEnabled ??
      defaultUiPreferences.soundEnabled;
    const signalAnimationEnabled =
      state.uiPreferences?.signalAnimationEnabled ??
      defaultUiPreferences.signalAnimationEnabled;
    const signalSoundEnabled =
      state.uiPreferences?.signalSoundEnabled ??
      defaultUiPreferences.signalSoundEnabled;
    const signalBillboard = normalizeSignalBillboardPreferences(
      state.uiPreferences?.signalBillboard
    );
    const selectedSignalSoundId = normalizeSignalSoundId(
      state.uiPreferences?.selectedSignalSoundId
    );
    const interfaceLanguage = normalizeInterfaceLanguage(state.uiPreferences?.interfaceLanguage);
    const voiceProfile = normalizeVoiceProfileId(state.uiPreferences?.voiceProfile);
    const speechProvider = normalizeSpeechProviderId(state.uiPreferences?.speechProvider);

    set({
      backendWsUrl: resolvePersistedBackendWsUrl(state.backendWsUrl),
      settings: normalizeDashboardSettings(state.settings),
      watchlist: state.watchlist,
      activeTrades: state.activeTrades ?? [],
      profileNotes: state.profileNotes ?? "",
      uiPreferences: {
        ...defaultUiPreferences,
        ...state.uiPreferences,
        interfaceLanguage,
        soundEnabled,
        signalAnimationEnabled,
        signalSoundEnabled,
        signalBillboard,
        selectedSignalSoundId,
        speechProvider,
        voiceProfile,
        selectedSpeechVoiceUri: state.uiPreferences?.selectedSpeechVoiceUri ?? null,
        selectedTtsModelId: state.uiPreferences?.selectedTtsModelId ?? null,
        notifications: {
          ...defaultUiPreferences.notifications,
          ...state.uiPreferences?.notifications
        },
        collapsedSections: {
          ...defaultUiPreferences.collapsedSections,
          ...state.uiPreferences?.collapsedSections
        },
        visibleSections: {
          ...defaultUiPreferences.visibleSections,
          ...state.uiPreferences?.visibleSections
        },
        dashboardLayoutMode: state.uiPreferences?.dashboardLayoutModePinned
          ? state.uiPreferences?.dashboardLayoutMode === "grid"
            ? "grid"
            : "free"
          : "free",
        dashboardLayoutModePinned: state.uiPreferences?.dashboardLayoutModePinned === true,
        dashboardPanelOrder: normalizeDashboardPanelOrder(
          state.uiPreferences?.dashboardPanelOrder
        ),
        dashboardPanelLayout: normalizeDashboardPanelLayout(
          state.uiPreferences?.dashboardPanelLayout
        )
      }
    });
  },
  setLatency: (value) => set({ latencyMs: value })
}));

export const getPersistableState = (): PersistedState => {
  const current = useScreenerStore.getState();
  return {
    backendWsUrl: current.backendWsUrl,
    settings: current.settings,
    watchlist: current.watchlist,
    activeTrades: current.activeTrades,
    uiPreferences: current.uiPreferences,
    profileNotes: current.profileNotes
  };
};
