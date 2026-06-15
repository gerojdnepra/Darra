"use client";

import { Capacitor } from "@capacitor/core";
import { create } from "zustand";
import {
  defaultInterfaceLanguage,
  normalizeInterfaceLanguage
} from "@/lib/interface-language";
import {
  defaultWorkspacePresetId,
  desktopDashboardPanels,
  desktopModuleSections,
  getWorkspacePreset,
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
import {
  applyRealtimeFrameMessage,
  createRealtimeFrameTransportState
} from "@/lib/realtime-frame-recovery";
import { renderTelemetry } from "@/lib/render-telemetry";
import {
  isLoopbackHost,
  localBackendWsUrl,
  normalizeBackendPath,
  normalizeLocalBackendWsUrl
} from "@/lib/backend-url";
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
  DecisionContextResponse,
  DecisionReplayPayload,
  InterfaceLanguage,
  JournalAnalyticsFilters,
  JournalAnalyticsPayload,
  JournalEntryFilters,
  JournalEntryRecord,
  KnowledgeLayerSnapshot,
  LearningReportFilters,
  LearningReportPayload,
  LiveSafetyStateMessage,
  NotificationPreferences,
  OrderAckMessage,
  OrderAuditEventPayload,
  OrderErrorMessage,
  OrderIntentMessage,
  PaperTradingStateMessage,
  OrderRejectedMessage,
  OrderSide,
  PaperPositionState,
  OrderStatePayload,
  OrderStatusMessage,
  OrderType,
  PersistedState,
  ScreenerFrame,
  SignalReplayPayload,
  SignalStatisticsPayload,
  SignalBillboardPreferences,
  SignalSoundId,
  SpeechProviderId,
  TradeDecisionContext,
  UpdateJournalEntryPatch,
  ServerMessage,
  UiPreferences,
  VoiceProfileId
} from "@/lib/types";
import { defaultVoiceProfileId, normalizeVoiceProfileId } from "@/lib/voice-profiles";

const configuredBackendWsUrl =
  process.env.NEXT_PUBLIC_BACKEND_WS_URL?.trim() || "";

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

const resolveConfiguredBackendWsUrl = (): string => {
  if (!configuredBackendWsUrl) {
    return "";
  }

  if (typeof window === "undefined") {
    return normalizeLocalBackendWsUrl(configuredBackendWsUrl);
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

  return isNativePlatform()
    ? configuredBackendWsUrl
    : normalizeLocalBackendWsUrl(configuredBackendWsUrl);
};

const getDefaultBackendWsUrl = (): string => {
  const resolvedConfiguredUrl = resolveConfiguredBackendWsUrl();

  if (resolvedConfiguredUrl) {
    return resolvedConfiguredUrl;
  }

  if (typeof window !== "undefined") {
    const { hostname } = window.location;

    if (hostname && !isLoopbackHost(hostname)) {
      return `ws://${hostname}:3001/ws`;
    }
  }

  return isNativePlatform() ? "ws://localhost:3001/ws" : localBackendWsUrl;
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

  if (shouldUseDefaultNativeBackendUrl(persistedBackendWsUrl, defaultBackendWsUrl)) {
    return defaultBackendWsUrl;
  }

  return isNativePlatform()
    ? persistedBackendWsUrl
    : normalizeLocalBackendWsUrl(persistedBackendWsUrl);
};

const createDefaultNotificationPreferences = (): NotificationPreferences => ({
  tradeSignals: true,
  liquidationSignals: true,
  systemStatus: true,
  pulseChanges: true
});

const createAllSectionsVisibleState = (): UiPreferences["visibleSections"] =>
  Object.fromEntries(
    desktopModuleSections.map((section) => [section, true])
  ) as UiPreferences["visibleSections"];

const createDefaultVisibleSections = (): UiPreferences["visibleSections"] => {
  const fallback = createAllSectionsVisibleState();
  const preset = getWorkspacePreset(defaultWorkspacePresetId);

  if (!preset?.visibleSections.length) {
    return fallback;
  }

  const visibleSet = new Set(preset.visibleSections);

  return Object.fromEntries(
    desktopModuleSections.map((section) => [section, visibleSet.has(section)])
  ) as UiPreferences["visibleSections"];
};

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
    chartPanel: false,
    decisionStack: false,
    symbolDetailRail: false,
    marketStory: false,
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
    knowledgeWorkspace: false,
    watchlist: false,
    volumeMilestones: false,
    volumeThresholdMilestones: false,
    alerts: false,
    frameTelemetry: false,
    renderTelemetry: false,
    health: false,
    replay: false
  },
  visibleSections: createDefaultVisibleSections(),
  dashboardLayoutMode: "free",
  dashboardLayoutModePinned: false,
  dashboardPanelOrder: desktopDashboardPanels,
  dashboardPanelLayout: normalizeDashboardPanelLayout(null),
  learningMode: false
});

let liveFrameTransport = createRealtimeFrameTransportState();

const maxRecentOrderEvents = 50;
const maxRecentOrderAuditEvents = 50;
const maxRecentPaperPositions = 20;
const maxKnownOrderIntents = 100;

type OrderEventDisplayStatus = "ACK" | "ERROR" | OrderStatePayload["status"];

interface LocalOrderIntentSummary {
  intentId: string;
  createdAt: number;
  symbol: string | null;
  side: OrderSide | null;
  orderType: OrderType | null;
  quantity: number | null;
  price: number | null;
  stopPrice: number | null;
  paperMode: boolean;
  reduceOnly: boolean;
  sourceWindowId: string | null;
}

export interface OrderHistoryEvent {
  id: string;
  eventType: "order_ack" | "order_rejected" | "order_error" | "order_status";
  time: number;
  intentId: string | null;
  orderId: string | null;
  clientOrderId: string | null;
  symbol: string | null;
  side: OrderSide | null;
  orderType: OrderType | null;
  quantity: number | null;
  price: number | null;
  avgPrice: number | null;
  executedQty: number | null;
  commission: number | null;
  commissionAsset: string | null;
  status: OrderEventDisplayStatus;
  paperMode: boolean | null;
  message: string | null;
  errorCode: string | null;
  duplicate: boolean;
}

const prependWithLimit = <T>(items: T[], nextItem: T, limit: number): T[] =>
  [nextItem, ...items].slice(0, limit);

const upsertByPaperPositionId = (
  items: PaperPositionState[],
  position: PaperPositionState
): PaperPositionState[] => {
  const existingIndex = items.findIndex(
    (item) => item.paperPositionId === position.paperPositionId
  );

  if (existingIndex === -1) {
    return [position, ...items];
  }

  return items.map((item, index) => (index === existingIndex ? position : item));
};

const upsertRecentPaperPosition = (
  items: PaperPositionState[],
  position: PaperPositionState
): PaperPositionState[] =>
  upsertByPaperPositionId(items, position)
    .filter((item) => item.status === "CLOSED")
    .sort((left, right) => (right.closedAt ?? right.openedAt) - (left.closedAt ?? left.openedAt))
    .slice(0, maxRecentPaperPositions);

const normalizeKnownOrderIntents = (
  nextMap: Record<string, LocalOrderIntentSummary>
): Record<string, LocalOrderIntentSummary> => {
  const entries = Object.entries(nextMap);

  if (entries.length <= maxKnownOrderIntents) {
    return nextMap;
  }

  return Object.fromEntries(
    entries
      .sort((left, right) => right[1].createdAt - left[1].createdAt)
      .slice(0, maxKnownOrderIntents)
  );
};

const replayRecordString = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
};

const summarizeIntentPayload = (
  payload: OrderIntentMessage["payload"]
): LocalOrderIntentSummary => ({
  intentId: payload.intentId,
  createdAt: payload.createdAt,
  symbol: payload.symbol?.trim().toUpperCase() || null,
  side: payload.side ?? null,
  orderType: payload.orderType ?? null,
  quantity: typeof payload.quantity === "number" ? payload.quantity : null,
  price: typeof payload.price === "number" ? payload.price : null,
  stopPrice: typeof payload.stopPrice === "number" ? payload.stopPrice : null,
  paperMode: payload.paperMode ?? true,
  reduceOnly: payload.reduceOnly ?? false,
  sourceWindowId: payload.sourceWindowId?.trim() || null
});

const summarizeOrderState = (order: OrderStatePayload): LocalOrderIntentSummary => ({
  intentId: order.intentId ?? order.clientOrderId,
  createdAt: order.createdAt,
  symbol: order.symbol,
  side: order.side,
  orderType: order.orderType,
  quantity: order.quantity,
  price: order.price,
  stopPrice: order.stopPrice,
  paperMode: order.dryRun,
  reduceOnly: order.reduceOnly,
  sourceWindowId: order.sourceWindowId
});

const buildOrderHistoryEventFromOrder = (
  message:
    | OrderAckMessage
    | OrderRejectedMessage
    | OrderStatusMessage,
  status: OrderEventDisplayStatus,
  extra: {
    eventType: OrderHistoryEvent["eventType"];
    message?: string | null;
    duplicate?: boolean;
  }
): OrderHistoryEvent => {
  const order = message.type === "order_status" ? message.payload : message.payload.order;

  return {
    id: [
      extra.eventType,
      message.generatedAt,
      order.intentId ?? order.clientOrderId,
      order.status
    ].join(":"),
    eventType: extra.eventType,
    time: message.generatedAt,
    intentId: order.intentId,
    orderId: order.orderId,
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType,
    quantity: order.quantity,
    price: order.price ?? order.avgPrice,
    avgPrice: order.avgPrice,
    executedQty: order.executedQty,
    commission: order.commission,
    commissionAsset: order.commissionAsset,
    status,
    paperMode: order.dryRun,
    message: extra.message ?? order.rejectReason,
    errorCode: null,
    duplicate: extra.duplicate ?? false
  };
};

const buildOrderHistoryEventFromError = (
  message: OrderErrorMessage,
  knownOrderIntents: Record<string, LocalOrderIntentSummary>
): OrderHistoryEvent => {
  const knownIntent =
    message.payload.intentId ? knownOrderIntents[message.payload.intentId] ?? null : null;

  return {
    id: [
      "order_error",
      message.generatedAt,
      message.payload.intentId ?? message.payload.code
    ].join(":"),
    eventType: "order_error",
    time: message.generatedAt,
    intentId: message.payload.intentId,
    orderId: null,
    clientOrderId: null,
    symbol: knownIntent?.symbol ?? null,
    side: knownIntent?.side ?? null,
    orderType: knownIntent?.orderType ?? null,
    quantity: knownIntent?.quantity ?? null,
    price: knownIntent?.price ?? null,
    avgPrice: null,
    executedQty: null,
    commission: null,
    commissionAsset: null,
    status: "ERROR",
    paperMode: knownIntent?.paperMode ?? null,
    message: message.payload.message,
    errorCode: message.payload.code,
    duplicate: false
  };
};

const buildOrderHistoryEventFromRestoredOrder = (order: OrderStatePayload): OrderHistoryEvent => ({
  id: ["restored_order", order.updatedAt, order.orderId, order.status].join(":"),
  eventType: "order_status",
  time: order.updatedAt,
  intentId: order.intentId,
  orderId: order.orderId,
  clientOrderId: order.clientOrderId,
  symbol: order.symbol,
  side: order.side,
  orderType: order.orderType,
  quantity: order.quantity,
  price: order.avgPrice ?? order.price,
  avgPrice: order.avgPrice,
  executedQty: order.executedQty,
  commission: order.commission,
  commissionAsset: order.commissionAsset,
  status: order.status,
  paperMode: order.dryRun,
  message: order.rejectReason,
  errorCode: null,
  duplicate: false
});

const hydratePaperTradingStatePayload = (
  payload: PaperTradingStateMessage["payload"]
): Pick<
  ScreenerState,
  | "openPaperPositions"
  | "recentPaperPositions"
  | "recentOrderEvents"
  | "recentOrderAuditEvents"
  | "knownOrderIntents"
> => {
  const recentOrderEvents = payload.recentOrders
    .filter((order) => order.dryRun)
    .map(buildOrderHistoryEventFromRestoredOrder)
    .sort((left, right) => right.time - left.time)
    .slice(0, maxRecentOrderEvents);

  const knownOrderIntents = normalizeKnownOrderIntents(
    Object.fromEntries(
      payload.recentOrders
        .filter((order) => order.dryRun && order.intentId)
        .map((order) => [order.intentId as string, summarizeOrderState(order)])
    )
  );

  return {
    openPaperPositions: payload.openPaperPositions
      .filter((position) => position.paperMode && position.status === "OPEN")
      .sort((left, right) => left.openedAt - right.openedAt),
    recentPaperPositions: payload.recentPaperPositions
      .filter((position) => position.paperMode && position.status === "CLOSED")
      .sort((left, right) => (right.closedAt ?? right.openedAt) - (left.closedAt ?? left.openedAt))
      .slice(0, maxRecentPaperPositions),
    recentOrderEvents,
    recentOrderAuditEvents: payload.recentAuditEvents
      .filter((event) => event.dryRun)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, maxRecentOrderAuditEvents),
    knownOrderIntents
  };
};

interface ScreenerState {
  connectionState: "connecting" | "open" | "closed";
  latencyMs: number | null;
  frame: ScreenerFrame | null;
  signalStatistics: SignalStatisticsPayload | null;
  signalStatisticsUpdatedAt: number | null;
  signalReplay: SignalReplayPayload | null;
  signalReplayLoading: boolean;
  signalReplayError: string | null;
  decisionReplay: DecisionReplayPayload | null;
  decisionReplayLoading: boolean;
  decisionReplayError: string | null;
  journalEntries: JournalEntryRecord[];
  journalAnalytics: JournalAnalyticsPayload | null;
  journalAnalyticsLoading: boolean;
  journalAnalyticsUpdatedAt: number | null;
  knowledgeLayer: KnowledgeLayerSnapshot | null;
  knowledgeLayerLoading: boolean;
  knowledgeLayerError: string | null;
  knowledgeLayerUpdatedAt: number | null;
  learningReport: LearningReportPayload | null;
  learningReportLoading: boolean;
  learningReportUpdatedAt: number | null;
  liveSafetyState: LiveSafetyStateMessage["payload"] | null;
  journalLoading: boolean;
  journalError: string | null;
  selectedJournalEntry: JournalEntryRecord | null;
  recentOrderEvents: OrderHistoryEvent[];
  recentOrderAuditEvents: OrderAuditEventPayload[];
  openPaperPositions: PaperPositionState[];
  recentPaperPositions: PaperPositionState[];
  paperPositionLifecycleIds: Record<string, string>;
  knownOrderIntents: Record<string, LocalOrderIntentSummary>;
  backendWsUrl: string;
  settings: DashboardSettings;
  watchlist: string[];
  activeTrades: string[];
  selectedSymbol: string | null;
  uiPreferences: UiPreferences;
  profileNotes: string;
  search: string;
  lastNotice: string;
  latestTradeDecisionContext: TradeDecisionContext | null;
  latestDecisionContextResponse: DecisionContextResponse | null;
  pendingTradeDecisionContextId: string | null;
  tradeDecisionContextError: { id?: string | null; message: string } | null;
  setConnectionState: (value: ScreenerState["connectionState"]) => void;
  applyServerMessage: (
    message: ServerMessage,
    sendMessage?: (payload: Record<string, unknown>) => boolean
  ) => void;
  setSignalReplayLoading: (value: boolean) => void;
  clearSignalReplay: () => void;
  setDecisionReplayLoading: (value: boolean) => void;
  setDecisionReplayError: (value: string | null) => void;
  clearDecisionReplay: () => void;
  setKnowledgeLayerLoading: (value: boolean) => void;
  setKnowledgeLayerError: (value: string | null) => void;
  setSelectedJournalEntry: (entry: JournalEntryRecord | null) => void;
  registerPendingOrderIntent: (payload: OrderIntentMessage["payload"]) => void;
  hydratePaperTradingState: (payload: PaperTradingStateMessage["payload"]) => void;
  upsertPaperPosition: (position: PaperPositionState) => void;
  closePaperPosition: (position: PaperPositionState) => void;
  clearPaperPositions: () => void;
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
  setSelectedSymbol: (symbol: string | null) => void;
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
  setVisibleSections: (value: UiPreferences["visibleSections"]) => void;
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
  setLearningMode: (value: boolean) => void;
  setPendingTradeDecisionContextId: (id: string | null) => void;
  clearTradeDecisionContextError: () => void;
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
  decisionReplay: null,
  decisionReplayLoading: false,
  decisionReplayError: null,
  journalEntries: [],
  journalAnalytics: null,
  journalAnalyticsLoading: false,
  journalAnalyticsUpdatedAt: null,
  knowledgeLayer: null,
  knowledgeLayerLoading: false,
  knowledgeLayerError: null,
  knowledgeLayerUpdatedAt: null,
  learningReport: null,
  learningReportLoading: false,
  learningReportUpdatedAt: null,
  liveSafetyState: null,
  journalLoading: false,
  journalError: null,
  selectedJournalEntry: null,
  recentOrderEvents: [],
  recentOrderAuditEvents: [],
  openPaperPositions: [],
  recentPaperPositions: [],
  paperPositionLifecycleIds: {},
  knownOrderIntents: {},
  backendWsUrl: getDefaultBackendWsUrl(),
  settings: defaultDashboardSettings,
  watchlist: [],
  activeTrades: [],
  selectedSymbol: null,
  uiPreferences: createDefaultUiPreferences(),
  profileNotes: "",
  search: "",
  lastNotice: "waiting for backend",
  latestTradeDecisionContext: null,
  latestDecisionContextResponse: null,
  pendingTradeDecisionContextId: null,
  tradeDecisionContextError: null,
  setConnectionState: (value) => {
    if (value !== "open") {
      liveFrameTransport = createRealtimeFrameTransportState();
    }

    set({ connectionState: value });
  },
  applyServerMessage: (message, sendMessage) => {
    let snapshotRequest: Record<string, unknown> | null = null;

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

      if (message.type === "paper_trading_state") {
        return hydratePaperTradingStatePayload(message.payload);
      }

      if (message.type === "live_safety_state") {
        return {
          liveSafetyState: message.payload
        };
      }

      if (message.type === "order_ack") {
        const nextKnownOrderIntents = message.payload.order.intentId
          ? normalizeKnownOrderIntents({
              ...state.knownOrderIntents,
              [message.payload.order.intentId]: summarizeOrderState(message.payload.order)
            })
          : state.knownOrderIntents;

        return {
          knownOrderIntents: nextKnownOrderIntents,
          recentOrderEvents: prependWithLimit(
            state.recentOrderEvents,
            buildOrderHistoryEventFromOrder(message, "ACK", {
              eventType: "order_ack",
              message: message.payload.message,
              duplicate: message.payload.duplicate
            }),
            maxRecentOrderEvents
          ),
          lastNotice: message.payload.message || state.lastNotice
        };
      }

      if (message.type === "order_rejected") {
        const nextKnownOrderIntents = message.payload.order.intentId
          ? normalizeKnownOrderIntents({
              ...state.knownOrderIntents,
              [message.payload.order.intentId]: summarizeOrderState(message.payload.order)
            })
          : state.knownOrderIntents;

        return {
          knownOrderIntents: nextKnownOrderIntents,
          recentOrderEvents: prependWithLimit(
            state.recentOrderEvents,
            buildOrderHistoryEventFromOrder(message, "REJECTED", {
              eventType: "order_rejected",
              message: message.payload.message,
              duplicate: message.payload.duplicate
            }),
            maxRecentOrderEvents
          ),
          lastNotice: message.payload.message || state.lastNotice
        };
      }

      if (message.type === "order_error") {
        return {
          recentOrderEvents: prependWithLimit(
            state.recentOrderEvents,
            buildOrderHistoryEventFromError(message, state.knownOrderIntents),
            maxRecentOrderEvents
          ),
          lastNotice: message.payload.message || state.lastNotice
        };
      }

      if (message.type === "order_status") {
        const nextKnownOrderIntents = message.payload.intentId
          ? normalizeKnownOrderIntents({
              ...state.knownOrderIntents,
              [message.payload.intentId]: summarizeOrderState(message.payload)
            })
          : state.knownOrderIntents;

        return {
          knownOrderIntents: nextKnownOrderIntents,
          recentOrderEvents: prependWithLimit(
            state.recentOrderEvents,
            buildOrderHistoryEventFromOrder(message, message.payload.status, {
              eventType: "order_status"
            }),
            maxRecentOrderEvents
          )
        };
      }

      if (message.type === "order_audit_event") {
        return {
          recentOrderAuditEvents: prependWithLimit(
            state.recentOrderAuditEvents,
            message.payload,
            maxRecentOrderAuditEvents
          )
        };
      }

      if (message.type === "paper_position_opened" || message.type === "paper_position_updated") {
        return {
          openPaperPositions: upsertByPaperPositionId(
            state.openPaperPositions,
            message.payload
          ).filter((position) => position.status === "OPEN"),
          recentPaperPositions:
            message.payload.status === "CLOSED"
              ? upsertRecentPaperPosition(state.recentPaperPositions, message.payload)
              : state.recentPaperPositions
        };
      }

      if (message.type === "paper_position_closed") {
        return {
          openPaperPositions: state.openPaperPositions.filter(
            (position) => position.paperPositionId !== message.payload.paperPositionId
          ),
          recentPaperPositions: upsertRecentPaperPosition(
            state.recentPaperPositions,
            message.payload
          )
        };
      }

      if (message.type === "position_lifecycle_event") {
        const paperPositionId = replayRecordString(message.payload.payload, "paperPositionId");

        if (!paperPositionId) {
          return state;
        }

        return {
          paperPositionLifecycleIds: {
            ...state.paperPositionLifecycleIds,
            [paperPositionId]: message.payload.lifecycleId
          }
        };
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

      if (message.type === "decision_replay_payload") {
        return {
          decisionReplay: message.payload,
          decisionReplayLoading: false,
          decisionReplayError: null
        };
      }

      if (message.type === "decision_replay_error") {
        return {
          decisionReplayLoading: false,
          decisionReplayError: message.payload.message || message.payload.code
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

      if (message.type === "knowledge_layer_snapshot") {
        return {
          knowledgeLayer: message.payload,
          knowledgeLayerLoading: false,
          knowledgeLayerError: null,
          knowledgeLayerUpdatedAt: message.generatedAt
        };
      }

      if (message.type === "knowledge_layer_error") {
        return {
          knowledgeLayerLoading: false,
          knowledgeLayerError: message.payload.message || message.payload.code
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

      if (message.type === "trade_decision_context_created") {
        return {
          lastNotice: message.payload.legacy
            ? "Legacy decision context event ignored. Waiting for protocol response."
            : state.lastNotice
        };
      }

      if (message.type === "decision_context_response") {
        if (message.payload.status === "REJECTED") {
          return {
            latestDecisionContextResponse: message.payload,
            pendingTradeDecisionContextId: null,
            tradeDecisionContextError: {
              message:
                message.payload.validationErrors[0] ??
                message.payload.reason ??
                "Decision context request rejected."
            },
            lastNotice:
              message.payload.reason ??
              message.payload.validationErrors[0] ??
              "Decision context request rejected."
          };
        }

        return {
          latestDecisionContextResponse: message.payload,
          latestTradeDecisionContext: message.payload.decisionContext ?? state.latestTradeDecisionContext,
          pendingTradeDecisionContextId: null,
          tradeDecisionContextError: null,
          lastNotice:
            message.payload.status === "FORCED_WAIT"
              ? `Decision forced to WAIT: ${message.payload.reason ?? message.payload.signalState}.`
              : message.payload.decisionContext
                ? `Decision context ${message.payload.decisionContext.decision} saved for ${message.payload.decisionContext.symbol}.`
                : "Decision context response received."
        };
      }

      if (message.type === "trade_decision_context_error") {
        return {
          pendingTradeDecisionContextId:
            message.payload.id && state.pendingTradeDecisionContextId === message.payload.id
              ? null
              : state.pendingTradeDecisionContextId,
          tradeDecisionContextError: {
            id: message.payload.id,
            message: message.payload.message
          },
          lastNotice: message.payload.message
        };
      }

      if (
        message.type === "snapshot" ||
        message.type === "frame_patch" ||
        message.type === "frame"
      ) {
        const mergeStartedAt =
          message.type === "frame_patch" && typeof performance !== "undefined"
            ? performance.now()
            : null;
        const frameUpdate = applyRealtimeFrameMessage(liveFrameTransport, state.frame, message);
        if (!frameUpdate) {
          return state;
        }

        liveFrameTransport = frameUpdate.nextState;
        snapshotRequest = frameUpdate.requestSnapshot as Record<string, unknown> | null;

        if (!frameUpdate.applied || !frameUpdate.nextFrame) {
          return state;
        }

        if (mergeStartedAt !== null) {
          renderTelemetry.recordPatchMerge(performance.now() - mergeStartedAt);
        }

        renderTelemetry.markFrameUpdateStarted(frameUpdate.nextFrame.generatedAt ?? null);

        return {
          frame: frameUpdate.nextFrame,
          lastNotice: frameUpdate.nextFrame.status?.message ?? state.lastNotice
        };
      }

      return state;
    });

    if (snapshotRequest && sendMessage) {
      sendMessage(snapshotRequest);
    }
  },
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
  setDecisionReplayLoading: (value) =>
    set((state) => ({
      decisionReplay: value ? null : state.decisionReplay,
      decisionReplayLoading: value,
      decisionReplayError: value ? null : state.decisionReplayError
    })),
  setDecisionReplayError: (value) =>
    set({
      decisionReplay: null,
      decisionReplayLoading: false,
      decisionReplayError: value
    }),
  clearDecisionReplay: () =>
    set({
      decisionReplay: null,
      decisionReplayLoading: false,
      decisionReplayError: null
    }),
  setKnowledgeLayerLoading: (value) =>
    set((state) => ({
      knowledgeLayerLoading: value,
      knowledgeLayerError: value ? null : state.knowledgeLayerError
    })),
  setKnowledgeLayerError: (value) =>
    set({
      knowledgeLayerLoading: false,
      knowledgeLayerError: value
    }),
  setSelectedJournalEntry: (entry) => set({ selectedJournalEntry: entry }),
  registerPendingOrderIntent: (payload) =>
    set((state) => ({
      knownOrderIntents: normalizeKnownOrderIntents({
        ...state.knownOrderIntents,
        [payload.intentId]: summarizeIntentPayload(payload)
      })
    })),
  hydratePaperTradingState: (payload) => set(hydratePaperTradingStatePayload(payload)),
  upsertPaperPosition: (position) =>
    set((state) => ({
      openPaperPositions: upsertByPaperPositionId(
        state.openPaperPositions,
        position
      ).filter((item) => item.status === "OPEN"),
      recentPaperPositions:
        position.status === "CLOSED"
          ? upsertRecentPaperPosition(state.recentPaperPositions, position)
          : state.recentPaperPositions
    })),
  closePaperPosition: (position) =>
    set((state) => ({
      openPaperPositions: state.openPaperPositions.filter(
        (item) => item.paperPositionId !== position.paperPositionId
      ),
      recentPaperPositions: upsertRecentPaperPosition(state.recentPaperPositions, position)
    })),
  clearPaperPositions: () =>
    set({
      openPaperPositions: [],
      recentPaperPositions: []
    }),
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
      backendWsUrl: isNativePlatform() ? value.trim() : normalizeLocalBackendWsUrl(value)
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
  setSelectedSymbol: (symbol) =>
    set({
      selectedSymbol: symbol?.trim() ? symbol.trim().toUpperCase() : null
    }),
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
  setVisibleSections: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        visibleSections: value
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
  setLearningMode: (value) =>
    set((state) => ({
      uiPreferences: {
        ...state.uiPreferences,
        learningMode: value
      }
    })),
  setPendingTradeDecisionContextId: (id) =>
    set({
      pendingTradeDecisionContextId: id,
      tradeDecisionContextError: null
    }),
  clearTradeDecisionContextError: () =>
    set({
      tradeDecisionContextError: null
    }),
  hydratePersistedState: (state) => {
    const defaultUiPreferences = createDefaultUiPreferences();

    if (!state) {
      set({
        backendWsUrl: getDefaultBackendWsUrl(),
        settings: defaultDashboardSettings,
        watchlist: [],
        activeTrades: [],
        selectedSymbol: null,
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
      selectedSymbol: state.selectedSymbol?.trim()
        ? state.selectedSymbol.trim().toUpperCase()
        : null,
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
    selectedSymbol: current.selectedSymbol,
    uiPreferences: current.uiPreferences,
    profileNotes: current.profileNotes
  };
};
