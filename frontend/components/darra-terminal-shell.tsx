"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultDarraWorkspaceState,
  createWorkspaceTab,
  normalizeDarraWorkspaceState,
  type DarraWorkspaceState,
  type DarraWorkspaceTab,
  type TerminalWidgetId
} from "@/lib/darra-workspace";
import {
  getDesktopBridge,
  type DesktopManagedWindowKey,
  type DesktopShellState,
  type DesktopWindowSnapshot
} from "@/lib/desktop-shell";
import { localBackendWsUrl, normalizeLocalBackendWsUrl } from "@/lib/backend-url";
import { compactUsd, formatClock, formatPercent, formatPrice } from "@/lib/format";
import { defaultInterfaceLanguage, normalizeInterfaceLanguage } from "@/lib/interface-language";
import {
  defaultWorkspacePresetId,
  desktopModuleSections,
  desktopDashboardPanels,
  desktopManagedModuleSections,
  getWorkspacePreset,
  normalizeDashboardPanelLayout,
  normalizeDashboardPanelOrder
} from "@/lib/module-sections";
import { defaultDashboardSettings, normalizeDashboardSettings } from "@/lib/settings";
import {
  loadCabinetProfileRecord,
  loadCabinetSession,
  loadDarraWorkspace,
  loadPersistedState,
  saveCabinetProfileRecord,
  saveDarraWorkspace,
  savePersistedState
} from "@/lib/indexed-db";
import {
  createRuntimeSyncSourceId,
  runtimeSyncChannelName,
  type RuntimeSyncPayload
} from "@/lib/runtime-sync";
import type {
  Bias,
  CabinetProfile,
  CabinetSession,
  InterfaceLanguage,
  PersistedState,
  ScreenerAlert,
  ScreenerFrame,
  ScreenerRow,
  ServerMessage,
  UnifiedSignalEvent
} from "@/lib/types";

interface PricePoint {
  timestamp: number;
  price: number;
}

interface TerminalWidgetDefinition {
  id: TerminalWidgetId;
  label: string;
  detail: string;
  tone: string;
  bridgeWindowKey: DesktopManagedWindowKey;
}

interface OrderBookLevel {
  side: "bid" | "ask";
  price: number;
  size: number;
  cumulative: number;
  depthRatio: number;
}

interface CopyBlock {
  brand: string;
  workspace: string;
  desktopAttached: string;
  previewMode: string;
  feedLive: string;
  feedConnecting: string;
  feedClosed: string;
  addTab: string;
  emptyTitle: string;
  emptyDescription: string;
  liveSymbol: string;
  selectSymbol: string;
  actionFailed: string;
  tabLabel: string;
  widgetsTitle: string;
  workspaceStatusTitle: string;
  profileTitle: string;
  watchlistTitle: string;
  activeTradesTitle: string;
  recentSignalsTitle: string;
  recentSignalsEmpty: string;
  moduleWindowsTitle: string;
  noData: string;
  guestMode: string;
  authMode: string;
  guestProfile: string;
  openWindows: string;
  screens: string;
  backend: string;
  latency: string;
  marketPulse: string;
  watch: string;
  unwatch: string;
  markTrade: string;
  unmarkTrade: string;
  openWindow: string;
  focusWindow: string;
  launchWindow: string;
  windowStatusOpen: string;
  windowStatusClosed: string;
  orderbookHeader: string;
  orderbookSpread: string;
  orderbookImbalance: string;
  orderbookBid: string;
  orderbookAsk: string;
  chartHeader: string;
  chartNoHistory: string;
  chartChange24h: string;
  chartMomentum: string;
  chartFunding: string;
  quotesHeader: string;
  quotesEmpty: string;
  score: string;
  tape: string;
  tablesHeader: string;
  tablesWatchlistEmpty: string;
  tablesTradesEmpty: string;
  windowsRoute: string;
  savedLayout: string;
  syncedProfile: string;
  accountPositions: string;
}

const guestCabinetSession: CabinetSession = {
  mode: "guest",
  profileId: null
};

const reconnectDelayMs = 2_500;
const pingIntervalMs = 15_000;
const historyWindowMs = 18 * 60_000;
const maxHistoryPoints = 180;
const defaultBackendWsUrl = localBackendWsUrl;

const createDefaultVisibleSections = (): NonNullable<
  PersistedState["uiPreferences"]
>["visibleSections"] => {
  const preset = getWorkspacePreset(defaultWorkspacePresetId);
  const visibleSet = new Set(preset.visibleSections);

  return Object.fromEntries(
    desktopModuleSections.map((section) => [section, visibleSet.has(section)])
  ) as NonNullable<PersistedState["uiPreferences"]>["visibleSections"];
};

const defaultPersistedState: PersistedState = {
  backendWsUrl: defaultBackendWsUrl,
  settings: defaultDashboardSettings,
  watchlist: [],
  activeTrades: [],
  uiPreferences: {
    interfaceLanguage: defaultInterfaceLanguage,
    soundEnabled: true,
    signalAnimationEnabled: true,
    signalSoundEnabled: true,
    signalBillboard: {
      topBandSize: 16,
      bottomBandSize: 0,
      frameHeightPercent: 7,
      topBandOpacity: 88,
      bottomBandOpacity: 0
    },
    selectedSignalSoundId: "classic-chime",
    speechProvider: "system",
    voiceProfile: "default",
    selectedSpeechVoiceUri: null,
    selectedTtsModelId: null,
    notifications: {
      tradeSignals: true,
      liquidationSignals: true,
      systemStatus: true,
      pulseChanges: true
    },
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
  },
  profileNotes: ""
};

const defaultUiPreferences = defaultPersistedState.uiPreferences!;

const terminalWindowKeys: readonly DesktopManagedWindowKey[] = [
  "dashboard",
  ...desktopManagedModuleSections
];

const windowLabels: Record<InterfaceLanguage, Record<DesktopManagedWindowKey, string>> = {
  en: {
    dashboard: "Advanced Legacy Workspace",
    overview: "Overview",
    filters: "Filters",
    screener: "Signal",
    account: "Execution",
    activeTrades: "Positions",
    riskCenter: "Risk Center",
    correlationHeatmap: "Correlation Heatmap",
    varPanel: "VaR",
    fundingBasis: "Funding Rate",
    marketFlow: "Market Flow",
    chartPanel: "Context",
    decisionStack: "Decision Guide",
    symbolDetailRail: "Why It Matters",
    marketStory: "Signal Story",
    signalIntelligence: "Advanced Signal Intelligence",
    metaRegimeGovernor: "Advanced Meta Regime Governor",
    positionRiskOrchestrator: "Advanced Position Risk",
    regimeMemory: "Advanced Regime Memory",
    regimePrediction: "Advanced Regime Prediction",
    regimeFeedbackCalibration: "Advanced Regime Feedback Calibration",
    pnlAttribution: "PnL Attribution",
    signalStatistics: "Advanced Review Statistics",
    learningCenter: "Experimental Research",
    tradeJournal: "Review",
    knowledgeWorkspace: "Trading Lessons",
    watchlist: "Watchlist",
    volumeMilestones: "100M Volume",
    volumeThresholdMilestones: "1-100M Volume",
    frameTelemetry: "Experimental Frame Telemetry",
    renderTelemetry: "Experimental Render Telemetry",
    alerts: "Decision",
    health: "Feed Health",
    replay: "Replay"
  },
  ru: {
    frameTelemetry: "Experimental Frame Telemetry",
    renderTelemetry: "Experimental Render Telemetry",
    riskCenter: "Risk Center",
    correlationHeatmap: "Correlation Heatmap",
    varPanel: "VaR",
    fundingBasis: "Funding Rate",
    marketFlow: "Market Flow",
    chartPanel: "Context",
    decisionStack: "Decision Guide",
    symbolDetailRail: "Why It Matters",
    marketStory: "Market Story",
    signalIntelligence: "Advanced Signal Intelligence",
    metaRegimeGovernor: "Advanced Meta Regime Governor",
    positionRiskOrchestrator: "Advanced Position Risk",
    regimeMemory: "Advanced Regime Memory",
    regimePrediction: "Advanced Regime Prediction",
    regimeFeedbackCalibration: "Advanced Regime Feedback Calibration",
    pnlAttribution: "PnL Attribution",
    signalStatistics: "Advanced Review Statistics",
    learningCenter: "Experimental Research",
    tradeJournal: "Review",
    knowledgeWorkspace: "Trading Lessons",
    volumeMilestones: "100M Volume",
    volumeThresholdMilestones: "1-100M Volume",
    dashboard: "Advanced Legacy Workspace",
    overview: "Обзор",
    filters: "Фильтры",
    screener: "Signal",
    account: "Execution",
    activeTrades: "Positions",
    watchlist: "Лист наблюдения",
    alerts: "Decision",
    health: "Состояние фида",
    replay: "Replay"
  }
};

const terminalCopy: Record<InterfaceLanguage, CopyBlock> = {
  en: {
    brand: "Darra Terminal",
    workspace: "Experimental desktop workspace",
    desktopAttached: "Desktop shell attached",
    previewMode: "Browser preview",
    feedLive: "Feed live",
    feedConnecting: "Feed connecting",
    feedClosed: "Feed offline",
    addTab: "Add tab",
    emptyTitle: "Build your live desk",
    emptyDescription:
      "Add workflow widgets, bind the tab to a symbol, and keep a separate working layout for each scenario. Signal, decision, context, execution, positions, review and knowledge surfaces are driven by the real backend feed.",
    liveSymbol: "Live symbol",
    selectSymbol: "Select symbol",
    actionFailed: "Desktop action failed.",
    tabLabel: "Tab",
    widgetsTitle: "Widgets",
    workspaceStatusTitle: "Workspace status",
    profileTitle: "Profile",
    watchlistTitle: "Watchlist",
    activeTradesTitle: "Active trades",
    recentSignalsTitle: "Recent decision signals",
    recentSignalsEmpty: "Waiting for fresh signals from the feed.",
    moduleWindowsTitle: "Advanced workflow windows",
    noData: "No live data yet",
    guestMode: "Guest mode",
    authMode: "Authenticated",
    guestProfile: "Local guest",
    openWindows: "Open windows",
    screens: "Screens",
    backend: "Backend",
    latency: "Latency",
    marketPulse: "Market pulse",
    watch: "Watch",
    unwatch: "Unwatch",
    markTrade: "Mark trade",
    unmarkTrade: "Unmark trade",
    openWindow: "Open",
    focusWindow: "Focus",
    launchWindow: "Launch",
    windowStatusOpen: "open",
    windowStatusClosed: "closed",
    orderbookHeader: "Order book",
    orderbookSpread: "Spread",
    orderbookImbalance: "Imbalance",
    orderbookBid: "Bid ladder",
    orderbookAsk: "Ask ladder",
    chartHeader: "Momentum chart",
    chartNoHistory: "Waiting for enough ticks to build the live line.",
    chartChange24h: "24h change",
    chartMomentum: "Momentum",
    chartFunding: "Funding",
    quotesHeader: "Quotes",
    quotesEmpty: "No symbols in focus yet.",
    score: "Score",
    tape: "Decision",
    tablesHeader: "Tables",
    tablesWatchlistEmpty: "Nothing pinned to the watchlist yet.",
    tablesTradesEmpty: "No manual active trades yet.",
    windowsRoute: "Route",
    savedLayout: "Saved layout",
    syncedProfile: "Synced profile",
    accountPositions: "Account positions"
  },
  ru: {
    brand: "Darra Terminal",
    workspace: "Живой desktop workspace",
    desktopAttached: "Desktop shell подключен",
    previewMode: "Предпросмотр в браузере",
    feedLive: "Фид в сети",
    feedConnecting: "Подключаем фид",
    feedClosed: "Фид офлайн",
    addTab: "Добавить вкладку",
    emptyTitle: "Соберите живой стол",
    emptyDescription:
      "Добавляйте терминальные виджеты, привязывайте вкладку к символу и держите отдельную раскладку под каждый сценарий. Котировки, стакан, график, сигналы и управление окнами теперь питаются реальным backend-фидом.",
    liveSymbol: "Рабочий символ",
    selectSymbol: "Выбрать символ",
    actionFailed: "Не удалось выполнить действие в desktop shell.",
    tabLabel: "Вкладка",
    widgetsTitle: "Виджеты",
    workspaceStatusTitle: "Состояние workspace",
    profileTitle: "Профиль",
    watchlistTitle: "Watchlist",
    activeTradesTitle: "Активные сделки",
    recentSignalsTitle: "Свежие сигналы",
    recentSignalsEmpty: "Ждём новые сигналы из фида.",
    moduleWindowsTitle: "Окна модулей",
    noData: "Пока нет живых данных",
    guestMode: "Гостевой режим",
    authMode: "Авторизован",
    guestProfile: "Локальный гость",
    openWindows: "Открытые окна",
    screens: "Экраны",
    backend: "Backend",
    latency: "Задержка",
    marketPulse: "Пульс рынка",
    watch: "В watchlist",
    unwatch: "Убрать",
    markTrade: "В сделки",
    unmarkTrade: "Убрать",
    openWindow: "Открыть",
    focusWindow: "Фокус",
    launchWindow: "Запустить",
    windowStatusOpen: "открыто",
    windowStatusClosed: "закрыто",
    orderbookHeader: "Стакан",
    orderbookSpread: "Спред",
    orderbookImbalance: "Дисбаланс",
    orderbookBid: "Лестница bid",
    orderbookAsk: "Лестница ask",
    chartHeader: "График импульса",
    chartNoHistory: "Ждём достаточно тиков для построения живой линии.",
    chartChange24h: "Изменение 24ч",
    chartMomentum: "Импульс",
    chartFunding: "Фандинг",
    quotesHeader: "Котировки",
    quotesEmpty: "Пока нет символов в фокусе.",
    score: "Скор",
    tape: "Лента",
    tablesHeader: "Таблицы",
    tablesWatchlistEmpty: "В watchlist пока ничего не закреплено.",
    tablesTradesEmpty: "Пока нет ручных active trades.",
    windowsRoute: "Маршрут",
    savedLayout: "Сохранённая раскладка",
    syncedProfile: "Синхронизированный профиль",
    accountPositions: "Позиции аккаунта"
  }
};

const widgetCatalog: Record<InterfaceLanguage, TerminalWidgetDefinition[]> = {
  en: [
    {
      id: "orderbook",
      label: "Order book",
      detail: "Top-of-book ladder with real spread and queue pressure.",
      tone: "from-[#17324d] via-[#101f31] to-[#0a131f]",
      bridgeWindowKey: "overview"
    },
    {
      id: "chart",
      label: "Chart",
      detail: "Live micro-history for the selected symbol.",
      tone: "from-[#253a59] via-[#162437] to-[#101621]",
      bridgeWindowKey: "dashboard"
    },
    {
      id: "quotes",
      label: "Quotes",
      detail: "Focus symbols, momentum, flow, and spread at a glance.",
      tone: "from-[#1f403a] via-[#132a27] to-[#0d1819]",
      bridgeWindowKey: "screener"
    },
    {
      id: "tables",
      label: "Tables",
      detail: "Watchlists, active trades, and module windows in one block.",
      tone: "from-[#4b341f] via-[#281d15] to-[#14110f]",
      bridgeWindowKey: "watchlist"
    }
  ],
  ru: [
    {
      id: "orderbook",
      label: "Стакан",
      detail: "Живая лестница top-of-book со спредом и давлением очереди.",
      tone: "from-[#17324d] via-[#101f31] to-[#0a131f]",
      bridgeWindowKey: "overview"
    },
    {
      id: "chart",
      label: "График",
      detail: "Живая микро-история выбранного символа.",
      tone: "from-[#253a59] via-[#162437] to-[#101621]",
      bridgeWindowKey: "dashboard"
    },
    {
      id: "quotes",
      label: "Котировки",
      detail: "Фокусные символы, импульс, поток и спред в одном месте.",
      tone: "from-[#1f403a] via-[#132a27] to-[#0d1819]",
      bridgeWindowKey: "screener"
    },
    {
      id: "tables",
      label: "Таблицы",
      detail: "Watchlist, активные сделки и окна модулей в одном блоке.",
      tone: "from-[#4b341f] via-[#281d15] to-[#14110f]",
      bridgeWindowKey: "watchlist"
    }
  ]
};

const normalizeSymbolList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter(Boolean)
    .filter((symbol, index, array) => array.indexOf(symbol) === index);
};

const normalizeBackendWsUrl = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return defaultBackendWsUrl;
  }

  let normalized = trimmed;

  if (/^https:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^https:\/\//i, "wss://");
  } else if (/^http:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^http:\/\//i, "ws://");
  } else if (!/^wss?:\/\//i.test(normalized)) {
    normalized = `ws://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.pathname === "/" || parsed.pathname === "") {
      parsed.pathname = "/ws";
    }

    return normalizeLocalBackendWsUrl(parsed.toString());
  } catch {
    return defaultBackendWsUrl;
  }
};

const parseBackendLabel = (backendWsUrl: string | undefined): string => {
  if (!backendWsUrl) {
    return "--";
  }

  try {
    return new URL(backendWsUrl).host;
  } catch {
    return backendWsUrl;
  }
};

const biasPillClass = (bias: Bias): string => {
  if (bias === "LONG") {
    return "border-emerald-400/30 bg-emerald-500/12 text-emerald-200";
  }

  if (bias === "SHORT") {
    return "border-rose-400/30 bg-rose-500/12 text-rose-200";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const deltaClass = (value: number): string =>
  value >= 0 ? "text-emerald-200" : "text-rose-200";

const scoreClass = (score: number): string => {
  if (score >= 65) {
    return "text-emerald-200";
  }

  if (score <= 35) {
    return "text-rose-200";
  }

  return "text-slate-100";
};

const formatImbalance = (value: number | null): string =>
  value === null ? "--" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

const formatSpread = (value: number | null): string =>
  value === null ? "--" : `${value.toFixed(2)} bps`;

const getWindowLabel = (
  key: DesktopManagedWindowKey,
  language: InterfaceLanguage
): string => windowLabels[language][key];

const getWindowRoute = (key: DesktopManagedWindowKey): string =>
  key === "dashboard" ? "/" : `/module/${key}`;

const dedupeRows = (rows: ScreenerRow[]): ScreenerRow[] =>
  rows.filter((row, index, list) => list.findIndex((candidate) => candidate.symbol === row.symbol) === index);

const resolveWorkspaceProfileId = (
  session: CabinetSession,
  profile: CabinetProfile | null
): string | undefined => (session.mode === "authenticated" && profile ? profile.id : undefined);

const buildSnapshot = (
  baseState: PersistedState,
  backendWsUrl: string,
  watchlist: string[],
  activeTrades: string[],
  interfaceLanguage: InterfaceLanguage
): PersistedState => {
  const uiPreferences = {
    ...(baseState.uiPreferences ?? defaultUiPreferences),
    interfaceLanguage
  };

  return {
    ...baseState,
    backendWsUrl,
    watchlist,
    activeTrades,
    uiPreferences
  };
};

const normalizePersistedState = (value: PersistedState | null): PersistedState => {
  if (!value) {
    return defaultPersistedState;
  }

  const interfaceLanguage = normalizeInterfaceLanguage(value.uiPreferences?.interfaceLanguage);

  return {
    ...defaultPersistedState,
    ...value,
    backendWsUrl: normalizeBackendWsUrl(value.backendWsUrl),
    settings: normalizeDashboardSettings(value.settings),
    watchlist: normalizeSymbolList(value.watchlist),
    activeTrades: normalizeSymbolList(value.activeTrades),
    uiPreferences: {
      ...defaultUiPreferences,
      ...(value.uiPreferences ?? {}),
      interfaceLanguage,
      dashboardLayoutMode: value.uiPreferences?.dashboardLayoutModePinned
        ? value.uiPreferences?.dashboardLayoutMode === "grid"
          ? "grid"
          : "free"
        : "free",
      dashboardLayoutModePinned: value.uiPreferences?.dashboardLayoutModePinned === true,
      dashboardPanelOrder: normalizeDashboardPanelOrder(
        value.uiPreferences?.dashboardPanelOrder
      ),
      dashboardPanelLayout: normalizeDashboardPanelLayout(
        value.uiPreferences?.dashboardPanelLayout
      )
    }
  };
};

const getActiveTab = (
  workspaceState: DarraWorkspaceState
): DarraWorkspaceTab => workspaceState.tabs.find((tab) => tab.id === workspaceState.activeTabId) ?? workspaceState.tabs[0];

const resolveTabSymbol = (
  tab: DarraWorkspaceTab | null,
  rows: ScreenerRow[],
  watchlist: string[],
  activeTrades: string[]
): string | null => {
  if (tab?.symbol && rows.some((row) => row.symbol === tab.symbol)) {
    return tab.symbol;
  }

  const candidateSymbols = [
    ...(tab?.symbol ? [tab.symbol] : []),
    ...activeTrades,
    ...watchlist,
    ...rows.filter((row) => row.isFocus).map((row) => row.symbol),
    ...rows.map((row) => row.symbol)
  ];
  const nextSymbol = candidateSymbols.find((symbol, index) => {
    return candidateSymbols.indexOf(symbol) === index && rows.some((row) => row.symbol === symbol);
  });

  return nextSymbol ?? null;
};

const buildOrderBookLevels = (row: ScreenerRow | null): {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
} => {
  if (!row || row.lastPrice <= 0) {
    return { bids: [], asks: [] };
  }

  const bestBid = row.bestBid ?? row.lastPrice;
  const bestAsk = row.bestAsk ?? row.lastPrice;
  const inferredStep =
    row.bestBid !== null && row.bestAsk !== null
      ? Math.max(row.bestAsk - row.bestBid, row.lastPrice * 0.00002)
      : Math.max((row.lastPrice * Math.max(row.spreadBps ?? 1.5, 0.8)) / 10_000, row.lastPrice * 0.00003);
  const sizeSeed = Math.max(row.tradeNotional5s / Math.max(row.lastPrice, 1) / 6, 0.1);
  const bidSeed =
    row.bestBidQty ?? sizeSeed * (1 + Math.max(row.orderBookImbalance ?? 0, 0) * 2.4);
  const askSeed =
    row.bestAskQty ?? sizeSeed * (1 + Math.max(-(row.orderBookImbalance ?? 0), 0) * 2.4);

  const buildSide = (side: "bid" | "ask", basePrice: number, baseSize: number): OrderBookLevel[] => {
    const levels = Array.from({ length: 6 }, (_, index) => {
      const sizeMultiplier =
        side === "bid"
          ? 1.22 - index * 0.1 + Math.max(row.orderBookImbalance ?? 0, 0) * 0.22
          : 1.22 - index * 0.1 + Math.max(-(row.orderBookImbalance ?? 0), 0) * 0.22;
      const size = Math.max(baseSize * sizeMultiplier, 0.01);
      const price =
        side === "bid" ? basePrice - inferredStep * index : basePrice + inferredStep * index;

      return {
        side,
        price,
        size,
        cumulative: 0,
        depthRatio: 0
      };
    });

    let runningTotal = 0;
    for (const level of levels) {
      runningTotal += level.size;
      level.cumulative = runningTotal;
    }

    const maxDepth = levels[levels.length - 1]?.cumulative ?? 1;

    for (const level of levels) {
      level.depthRatio = level.cumulative / maxDepth;
    }

    return levels;
  };

  return {
    bids: buildSide("bid", bestBid, bidSeed).reverse(),
    asks: buildSide("ask", bestAsk, askSeed)
  };
};

const buildSparklinePath = (history: PricePoint[], width: number, height: number): string => {
  if (history.length < 2) {
    return "";
  }

  const minPrice = Math.min(...history.map((point) => point.price));
  const maxPrice = Math.max(...history.map((point) => point.price));
  const range = Math.max(maxPrice - minPrice, maxPrice * 0.00001, 1e-9);
  const lastTimestamp = history[history.length - 1]?.timestamp ?? history[0].timestamp;
  const firstTimestamp = history[0]?.timestamp ?? lastTimestamp;
  const timeRange = Math.max(lastTimestamp - firstTimestamp, 1);

  return history
    .map((point, index) => {
      const x = ((point.timestamp - firstTimestamp) / timeRange) * width;
      const y = height - ((point.price - minPrice) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

const getAlertSeverityClass = (alert: ScreenerAlert): string => {
  if (alert.severity === "critical") {
    return "border-rose-400/30 bg-rose-500/12 text-rose-100";
  }

  if (alert.severity === "high") {
    return "border-amber-400/30 bg-amber-500/12 text-amber-100";
  }

  return "border-sky-400/30 bg-sky-500/12 text-sky-100";
};

const normalizeUnifiedSignalBias = (
  value: string | null | undefined,
  fallback: Bias | null | undefined
): Bias => {
  if (value === "LONG" || value === "SHORT" || value === "NEUTRAL") {
    return value;
  }

  return fallback ?? "NEUTRAL";
};

const normalizeUnifiedSignalSeverity = (
  value: string | null | undefined,
  fallback: ScreenerAlert["severity"] | null | undefined,
  priority: string | null | undefined
): ScreenerAlert["severity"] => {
  if (value === "critical" || value === "high" || value === "info") {
    return value;
  }

  if (fallback) {
    return fallback;
  }

  if (priority === "CRITICAL") {
    return "critical";
  }

  if (priority === "HIGH") {
    return "high";
  }

  return "info";
};

const mapUnifiedSignalToRecentAlert = (
  signal: UnifiedSignalEvent,
  linkedAlert?: ScreenerAlert | null
): ScreenerAlert => ({
  id: signal.id,
  symbol: signal.symbol,
  kind: linkedAlert?.kind,
  baseAsset: linkedAlert?.baseAsset,
  bias: normalizeUnifiedSignalBias(signal.bias, linkedAlert?.bias),
  reason: signal.description || signal.title || linkedAlert?.reason || signal.symbol,
  severity: normalizeUnifiedSignalSeverity(signal.severity, linkedAlert?.severity, signal.priority),
  notionalUsd: linkedAlert?.notionalUsd ?? 0,
  quoteVolume24h: linkedAlert?.quoteVolume24h,
  averageDailyQuoteVolume: linkedAlert?.averageDailyQuoteVolume,
  volumeChangePct: linkedAlert?.volumeChangePct,
  alertPriority: signal.priority ?? linkedAlert?.alertPriority ?? null,
  alertRankScore: signal.rankScore ?? linkedAlert?.alertRankScore ?? null,
  alertSuppress: signal.suppress ?? linkedAlert?.alertSuppress ?? null,
  rankScore: signal.rankScore ?? linkedAlert?.rankScore,
  suppress: signal.suppress ?? linkedAlert?.suppress,
  suppressReason: signal.suppressReason ?? linkedAlert?.suppressReason,
  ttlSec: signal.ttlSec ?? linkedAlert?.ttlSec,
  tags: signal.tags ?? linkedAlert?.tags,
  liveVisibility: signal.liveVisibility ?? linkedAlert?.liveVisibility,
  noiseClass: signal.noiseClass ?? linkedAlert?.noiseClass,
  createdAt: signal.createdAt
});

const widgetSpanClass = (widgetId: TerminalWidgetId): string => {
  if (widgetId === "chart") {
    return "xl:col-span-7";
  }

  if (widgetId === "tables") {
    return "xl:col-span-5";
  }

  return "xl:col-span-6";
};

export function DarraTerminalShell() {
  const [bridge] = useState(() => getDesktopBridge());
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [workspaceState, setWorkspaceState] = useState<DarraWorkspaceState>(() =>
    createDefaultDarraWorkspaceState()
  );
  const [frame, setFrame] = useState<ScreenerFrame | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [backendWsUrl, setBackendWsUrl] = useState(defaultBackendWsUrl);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [activeTrades, setActiveTrades] = useState<string[]>([]);
  const [preferredLanguage, setPreferredLanguage] = useState<InterfaceLanguage>(
    defaultInterfaceLanguage
  );
  const [activeProfile, setActiveProfile] = useState<CabinetProfile | null>(null);
  const [cabinetSession, setCabinetSession] = useState<CabinetSession>(guestCabinetSession);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [pendingWindowKey, setPendingWindowKey] = useState<DesktopManagedWindowKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clock, setClock] = useState(() =>
    new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date())
  );

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const priceHistoryRef = useRef<Map<string, PricePoint[]>>(new Map());
  const persistedStateRef = useRef<PersistedState>(defaultPersistedState);
  const cabinetSessionRef = useRef<CabinetSession>(guestCabinetSession);
  const activeProfileRef = useRef<CabinetProfile | null>(null);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const syncSourceIdRef = useRef("");
  const skipNextStatePersistRef = useRef(false);
  const skipNextWorkspacePersistRef = useRef(false);

  const interfaceLanguage = shellState?.interfaceLanguage ?? preferredLanguage;
  const copy = terminalCopy[interfaceLanguage];
  const widgets = widgetCatalog[interfaceLanguage];
  const activeTab = getActiveTab(workspaceState);
  const rows = frame?.rows ?? [];
  const rowsBySymbol = useMemo(
    () => new Map(rows.map((row) => [row.symbol, row])),
    [rows]
  );
  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);
  const activeTradeSet = useMemo(() => new Set(activeTrades), [activeTrades]);
  const accountPositionSet = useMemo(
    () => new Set(frame?.status.accountStream.activePositions ?? []),
    [frame]
  );
  const windowStateByKey = useMemo(
    () => new Map(shellState?.windows.map((windowState) => [windowState.key, windowState]) ?? []),
    [shellState]
  );
  const focusRows = useMemo(() => rows.filter((row) => row.isFocus).slice(0, 10), [rows]);
  const watchlistRows = useMemo(
    () =>
      watchlist
        .map((symbol) => rowsBySymbol.get(symbol) ?? null)
        .filter((row): row is ScreenerRow => row !== null),
    [rowsBySymbol, watchlist]
  );
  const activeTradeRows = useMemo(
    () =>
      [...new Set([...activeTrades, ...Array.from(accountPositionSet)])]
        .map((symbol) => rowsBySymbol.get(symbol) ?? null)
        .filter((row): row is ScreenerRow => row !== null),
    [activeTrades, accountPositionSet, rowsBySymbol]
  );
  const symbolPool = useMemo(
    () =>
      dedupeRows([
        ...activeTradeRows,
        ...watchlistRows,
        ...focusRows,
        ...rows.slice(0, 16)
      ]),
    [activeTradeRows, focusRows, rows, watchlistRows]
  );
  const resolvedSymbol = resolveTabSymbol(activeTab ?? null, rows, watchlist, activeTrades);
  const selectedRow = resolvedSymbol ? rowsBySymbol.get(resolvedSymbol) ?? null : null;
  const selectedHistory = resolvedSymbol
    ? priceHistoryRef.current.get(resolvedSymbol) ?? []
    : [];
  const orderBook = useMemo(() => buildOrderBookLevels(selectedRow), [selectedRow]);
  const activeWidgets = activeTab.widgets
    .map((widgetId) => widgets.find((widget) => widget.id === widgetId) ?? null)
    .filter((widget): widget is TerminalWidgetDefinition => widget !== null);
  const openWindowCount = shellState?.windows.filter((windowState) => windowState.open).length ?? 0;
  const recentAlerts = useMemo(() => {
    const unifiedSignals = frame?.unifiedSignals ?? [];
    const legacyAlerts = frame?.alerts ?? [];

    if (unifiedSignals.length === 0) {
      return legacyAlerts.slice(0, 6);
    }

    const legacyAlertsById = new Map(legacyAlerts.map((alert) => [alert.id, alert]));

    return unifiedSignals.slice(0, 6).map((signal) =>
      mapUnifiedSignalToRecentAlert(
        signal,
        signal.rawRef.collection === "alerts" ? legacyAlertsById.get(signal.rawRef.id) : null
      )
    );
  }, [frame?.alerts, frame?.unifiedSignals]);
  const socketTargetUrl = shellState?.backendWsUrl ?? backendWsUrl;
  const profileModeLabel =
    cabinetSession.mode === "authenticated" ? copy.authMode : copy.guestMode;
  const profileLabel = activeProfile?.profileName ?? copy.guestProfile;
  const activeProfileId = resolveWorkspaceProfileId(cabinetSession, activeProfile);

  if (!syncSourceIdRef.current) {
    syncSourceIdRef.current = createRuntimeSyncSourceId();
  }

  useEffect(() => {
    cabinetSessionRef.current = cabinetSession;
  }, [cabinetSession]);

  useEffect(() => {
    activeProfileRef.current = activeProfile;
  }, [activeProfile]);

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const timer = window.setInterval(() => {
      setClock(formatter.format(new Date()));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!bridge) {
      return;
    }

    let active = true;

    bridge
      .getState()
      .then((state) => {
        if (active) {
          setShellState(state);
        }
      })
      .catch(() => {
        if (active) {
          setActionError(copy.actionFailed);
        }
      });

    const unsubscribe = bridge.onStateChanged((state) => {
      setShellState(state);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, copy.actionFailed]);

  useEffect(() => {
    let cancelled = false;

    const hydrateWorkspace = async (profileId?: string): Promise<void> => {
      const storedWorkspace = await loadDarraWorkspace(profileId);

      if (cancelled) {
        return;
      }

      skipNextWorkspacePersistRef.current = true;
      setWorkspaceState(
        normalizeDarraWorkspaceState(storedWorkspace ?? createDefaultDarraWorkspaceState())
      );
      setWorkspaceHydrated(true);
    };

    const hydrate = async (): Promise<void> => {
      const session = (await loadCabinetSession()) ?? guestCabinetSession;
      const record =
        session.mode === "authenticated" && session.profileId
          ? await loadCabinetProfileRecord(session.profileId)
          : null;
      const persistedState =
        record?.state ??
        (session.mode === "authenticated" && session.profileId ? null : await loadPersistedState());
      const normalizedState = normalizePersistedState(persistedState);

      if (cancelled) {
        return;
      }

      persistedStateRef.current = normalizedState;
      skipNextStatePersistRef.current = true;
      setCabinetSession(session);
      setActiveProfile(record?.profile ?? null);
      setWatchlist(normalizedState.watchlist);
      setActiveTrades(normalizedState.activeTrades ?? []);
      setBackendWsUrl(normalizedState.backendWsUrl ?? defaultBackendWsUrl);
      setPreferredLanguage(normalizedState.uiPreferences?.interfaceLanguage ?? defaultInterfaceLanguage);
      setStorageHydrated(true);

      await hydrateWorkspace(resolveWorkspaceProfileId(session, record?.profile ?? null));
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated || typeof window === "undefined" || !("BroadcastChannel" in window)) {
      return;
    }

    const hydrateWorkspace = async (
      session: CabinetSession,
      profile: CabinetProfile | null
    ): Promise<void> => {
      const storedWorkspace = await loadDarraWorkspace(resolveWorkspaceProfileId(session, profile));
      skipNextWorkspacePersistRef.current = true;
      setWorkspaceState(
        normalizeDarraWorkspaceState(storedWorkspace ?? createDefaultDarraWorkspaceState())
      );
      setWorkspaceHydrated(true);
    };

    const channel = new BroadcastChannel(runtimeSyncChannelName);
    syncChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<RuntimeSyncPayload>) => {
      const payload = event.data;

      if (
        payload?.type !== "state" ||
        payload.sourceId === syncSourceIdRef.current
      ) {
        return;
      }

      const normalizedState = normalizePersistedState(payload.state);
      persistedStateRef.current = normalizedState;
      skipNextStatePersistRef.current = true;
      setCabinetSession(payload.session);
      setActiveProfile(payload.profile);
      setWatchlist(normalizedState.watchlist);
      setActiveTrades(normalizedState.activeTrades ?? []);
      setBackendWsUrl(normalizedState.backendWsUrl ?? defaultBackendWsUrl);
      setPreferredLanguage(normalizedState.uiPreferences?.interfaceLanguage ?? defaultInterfaceLanguage);

      void hydrateWorkspace(payload.session, payload.profile);
    };

    return () => {
      channel.close();

      if (syncChannelRef.current === channel) {
        syncChannelRef.current = null;
      }
    };
  }, [storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    const persist = async (): Promise<void> => {
      if (skipNextStatePersistRef.current) {
        skipNextStatePersistRef.current = false;
        return;
      }

      const snapshot = buildSnapshot(
        persistedStateRef.current,
        socketTargetUrl,
        watchlist,
        activeTrades,
        interfaceLanguage
      );
      persistedStateRef.current = snapshot;

      if (cabinetSessionRef.current.mode === "authenticated" && activeProfileRef.current) {
        await saveCabinetProfileRecord({
          profile: {
            ...activeProfileRef.current,
            updatedAt: Date.now()
          },
          state: snapshot
        });
      } else {
        await savePersistedState(snapshot);
      }

      syncChannelRef.current?.postMessage({
        type: "state",
        sourceId: syncSourceIdRef.current,
        profile: activeProfileRef.current,
        session: cabinetSessionRef.current,
        state: snapshot
      } satisfies RuntimeSyncPayload);
    };

    const timer = window.setTimeout(() => {
      void persist().catch(() => undefined);
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeTrades, interfaceLanguage, socketTargetUrl, storageHydrated, watchlist]);

  useEffect(() => {
    if (!workspaceHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (skipNextWorkspacePersistRef.current) {
        skipNextWorkspacePersistRef.current = false;
        return;
      }

      void saveDarraWorkspace(workspaceState, activeProfileId).catch(() => undefined);
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeProfileId, workspaceHydrated, workspaceState]);

  useEffect(() => {
    if (!rows.length) {
      return;
    }

    const nextSymbol = resolveTabSymbol(activeTab, rows, watchlist, activeTrades);

    if (!nextSymbol || activeTab.symbol === nextSymbol) {
      return;
    }

    setWorkspaceState((currentState) => ({
      ...currentState,
      tabs: currentState.tabs.map((tab) =>
        tab.id === currentState.activeTabId ? { ...tab, symbol: nextSymbol } : tab
      )
    }));
  }, [activeTab, activeTrades, rows, watchlist]);

  useEffect(() => {
    if (!frame?.rows) {
      return;
    }

    const trackedSymbols = new Set<string>([
      ...workspaceState.tabs
        .map((tab) => tab.symbol)
        .filter((symbol): symbol is string => Boolean(symbol)),
      ...watchlist,
      ...activeTrades,
      ...frame.status.focusSymbols.slice(0, 20)
    ]);
    const nextHistory = priceHistoryRef.current;

    for (const row of frame.rows) {
      if (!trackedSymbols.has(row.symbol)) {
        continue;
      }

      const history = nextHistory.get(row.symbol) ?? [];
      const lastPoint = history[history.length - 1];

      if (!lastPoint || lastPoint.price !== row.lastPrice) {
        history.push({
          timestamp: frame.generatedAt,
          price: row.lastPrice
        });
      }

      const trimmedHistory = history.filter(
        (point) => frame.generatedAt - point.timestamp <= historyWindowMs
      );

      nextHistory.set(row.symbol, trimmedHistory.slice(-maxHistoryPoints));
    }

    for (const [symbol, history] of nextHistory.entries()) {
      if (trackedSymbols.has(symbol)) {
        continue;
      }

      const lastPoint = history[history.length - 1];
      if (!lastPoint || frame.generatedAt - lastPoint.timestamp > historyWindowMs) {
        nextHistory.delete(symbol);
      }
    }
  }, [activeTrades, frame, watchlist, workspaceState.tabs]);

  useEffect(() => {
    if (!socketTargetUrl) {
      return;
    }

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearPingTimer = () => {
      if (pingTimerRef.current !== null) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    };

    const processMessageText = (payloadText: string) => {
      try {
        const payload = JSON.parse(payloadText) as ServerMessage;

        if (payload.type === "pong") {
          setLatencyMs(Math.max(payload.receivedAt - payload.sentAt, 0));
          return;
        }

        if (payload.type === "snapshot") {
          setFrame(payload.frame);
          return;
        }

        if (payload.type === "frame_patch") {
          setFrame((currentFrame) =>
            currentFrame
              ? { ...currentFrame, ...payload.changed }
              : (payload.changed as ScreenerFrame)
          );
          return;
        }

        if (payload.type === "frame") {
          setFrame(payload);
        }
      } catch {
        // Ignore malformed payloads and keep the live feed running.
      }
    };

    const connect = () => {
      clearReconnectTimer();
      clearPingTimer();
      setConnectionState("connecting");

      let socket: WebSocket;

      try {
        socket = new WebSocket(socketTargetUrl);
      } catch {
        setConnectionState("closed");
        reconnectTimerRef.current = window.setTimeout(connect, reconnectDelayMs);
        return;
      }

      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) {
          return;
        }

        setConnectionState("open");
        socket.send(JSON.stringify({ type: "hello" }));
        socket.send(
          JSON.stringify({
            type: "visible_sections",
            sections: ["rows", "alerts", "status", "overview"]
          })
        );
        socket.send(JSON.stringify({ type: "request_snapshot" }));
        socket.send(JSON.stringify({ type: "set_watchlist", payload: { symbols: watchlist } }));
        socket.send(JSON.stringify({ type: "set_active_trades", payload: { symbols: activeTrades } }));
        clearPingTimer();
        pingTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "ping",
                payload: {
                  sentAt: Date.now()
                }
              })
            );
          }
        }, pingIntervalMs);
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          processMessageText(event.data);
          return;
        }

        if (event.data instanceof Blob) {
          void event.data.text().then(processMessageText).catch(() => undefined);
          return;
        }

        if (event.data instanceof ArrayBuffer) {
          processMessageText(new TextDecoder().decode(event.data));
        }
      };

      socket.onerror = () => {
        try {
          socket.close();
        } catch {
          // Ignore close failures after websocket errors.
        }
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        clearPingTimer();
        setConnectionState("closed");
        reconnectTimerRef.current = window.setTimeout(connect, reconnectDelayMs);
      };
    };

    connect();

    return () => {
      clearReconnectTimer();
      clearPingTimer();

      const socket = socketRef.current;
      socketRef.current = null;

      if (!socket) {
        return;
      }

      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      try {
        socket.close();
      } catch {
        // Ignore cleanup close failures.
      }
    };
  }, [activeTrades, socketTargetUrl, watchlist]);

  useEffect(() => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "set_watchlist",
        payload: {
          symbols: watchlist
        }
      })
    );
  }, [watchlist]);

  useEffect(() => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "set_active_trades",
        payload: {
          symbols: activeTrades
        }
      })
    );
  }, [activeTrades]);

  const addTab = () => {
    setWorkspaceState((currentState) => {
      const nextIndex =
        currentState.tabs.reduce((maxIndex, tab) => Math.max(maxIndex, tab.index), 0) + 1;
      const nextTab = createWorkspaceTab(nextIndex, resolvedSymbol);

      return {
        activeTabId: nextTab.id,
        tabs: [...currentState.tabs, nextTab]
      };
    });
  };

  const removeTab = (tabId: string) => {
    setWorkspaceState((currentState) => {
      if (currentState.tabs.length === 1) {
        return currentState;
      }

      const nextTabs = currentState.tabs.filter((tab) => tab.id !== tabId);

      return {
        activeTabId:
          currentState.activeTabId === tabId
            ? nextTabs[0]?.id ?? currentState.activeTabId
            : currentState.activeTabId,
        tabs: nextTabs
      };
    });
  };

  const addWidget = (widgetId: TerminalWidgetId) => {
    setWorkspaceState((currentState) => ({
      ...currentState,
      tabs: currentState.tabs.map((tab) =>
        tab.id === currentState.activeTabId && !tab.widgets.includes(widgetId)
          ? { ...tab, widgets: [...tab.widgets, widgetId] }
          : tab
      )
    }));
  };

  const removeWidget = (widgetId: TerminalWidgetId) => {
    setWorkspaceState((currentState) => ({
      ...currentState,
      tabs: currentState.tabs.map((tab) =>
        tab.id === currentState.activeTabId
          ? {
              ...tab,
              widgets: tab.widgets.filter((currentWidgetId) => currentWidgetId !== widgetId)
            }
          : tab
      )
    }));
  };

  const setActiveTabSymbol = (symbol: string) => {
    setWorkspaceState((currentState) => ({
      ...currentState,
      tabs: currentState.tabs.map((tab) =>
        tab.id === currentState.activeTabId ? { ...tab, symbol } : tab
      )
    }));
  };

  const toggleWatchSymbol = (symbol: string) => {
    const normalizedSymbol = symbol.toUpperCase();

    setWatchlist((currentWatchlist) =>
      currentWatchlist.includes(normalizedSymbol)
        ? currentWatchlist.filter((item) => item !== normalizedSymbol)
        : [...currentWatchlist, normalizedSymbol]
    );
  };

  const toggleActiveTradeSymbol = (symbol: string) => {
    const normalizedSymbol = symbol.toUpperCase();

    setActiveTrades((currentActiveTrades) =>
      currentActiveTrades.includes(normalizedSymbol)
        ? currentActiveTrades.filter((item) => item !== normalizedSymbol)
        : [...currentActiveTrades, normalizedSymbol]
    );
  };

  const runWindowAction = async (
    windowKey: DesktopManagedWindowKey,
    action: "open" | "focus"
  ) => {
    if (!bridge) {
      return;
    }

    setActionError(null);
    setPendingWindowKey(windowKey);

    try {
      const nextState =
        action === "open"
          ? await bridge.openWindow(windowKey)
          : await bridge.focusWindow(windowKey);
      setShellState(nextState);
    } catch {
      setActionError(copy.actionFailed);
    } finally {
      setPendingWindowKey(null);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#0b1016] text-slate-100">
      <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,_rgba(42,129,255,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(9,166,121,0.12),_transparent_28%),linear-gradient(180deg,#111823_0%,#0d141e_52%,#0b1016_100%)]">
        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:28px_28px]" />

        <div className="relative flex min-h-screen flex-col">
          <header className="border-b border-white/10 bg-[#101722]/90 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2d8cff]/15 text-[#74b7ff]">
                  <BrandGlyph />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                    {copy.workspace}
                  </div>
                  <div className="text-xl font-semibold text-white">{copy.brand}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge>{bridge ? copy.desktopAttached : copy.previewMode}</StatusBadge>
                <StatusBadge>
                  {connectionState === "open"
                    ? copy.feedLive
                    : connectionState === "connecting"
                      ? copy.feedConnecting
                      : copy.feedClosed}
                </StatusBadge>
                <StatusBadge>
                  {copy.openWindows}: {openWindowCount}
                </StatusBadge>
                <StatusBadge>
                  {copy.screens}: {shellState?.displays.length ?? 1}
                </StatusBadge>
                <StatusBadge>
                  {copy.backend}: {parseBackendLabel(socketTargetUrl)}
                </StatusBadge>
                <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 font-semibold text-white">
                  {clock}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/6 px-4 py-3">
              {widgets.map((widget) => {
                const active = activeTab.widgets.includes(widget.id);

                return (
                  <button
                    key={widget.id}
                    type="button"
                    onClick={() => addWidget(widget.id)}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                      active
                        ? "border-[#2d8cff]/70 bg-[#2d8cff]/15 text-white"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:bg-white/[0.08]"
                    }`}
                  >
                    <WidgetGlyph widgetId={widget.id} />
                    <span>{widget.label}</span>
                  </button>
                );
              })}

              <div className="mx-2 hidden h-6 w-px bg-white/10 lg:block" />

              <div className="flex flex-wrap items-center gap-2">
                {workspaceState.tabs.map((tab) => {
                  const active = tab.id === workspaceState.activeTabId;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        setWorkspaceState((currentState) => ({
                          ...currentState,
                          activeTabId: tab.id
                        }))
                      }
                      className={`group flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                        active
                          ? "border-[#2d8cff] bg-[#1b2432] text-white"
                          : "border-transparent bg-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.05]"
                      }`}
                    >
                      <span>
                        {copy.tabLabel} {tab.index}
                      </span>
                      {workspaceState.tabs.length > 1 ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeTab(tab.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              removeTab(tab.id);
                            }
                          }}
                          className="text-slate-500 transition group-hover:text-slate-200"
                        >
                          x
                        </span>
                      ) : null}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={addTab}
                  aria-label={copy.addTab}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                >
                  <PlusGlyph />
                </button>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  {copy.liveSymbol}
                </span>
                <select
                  value={resolvedSymbol ?? ""}
                  onChange={(event) => setActiveTabSymbol(event.target.value)}
                  className="min-w-[180px] rounded-md border border-white/10 bg-[#0b121b] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#2d8cff]/60"
                >
                  {symbolPool.length === 0 ? (
                    <option value="">{copy.selectSymbol}</option>
                  ) : null}
                  {symbolPool.map((row) => (
                    <option key={row.symbol} value={row.symbol}>
                      {row.symbol}
                    </option>
                  ))}
                </select>

                {selectedRow ? (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleWatchSymbol(selectedRow.symbol)}
                      className="rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-200 transition hover:border-white/20 hover:text-white"
                    >
                      {watchlistSet.has(selectedRow.symbol) ? copy.unwatch : copy.watch}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActiveTradeSymbol(selectedRow.symbol)}
                      className="rounded-md border border-[#f0b90b]/25 bg-[#f0b90b]/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#f0d27b] transition hover:border-[#f0b90b]/45 hover:text-white"
                    >
                      {activeTradeSet.has(selectedRow.symbol)
                        ? copy.unmarkTrade
                        : copy.markTrade}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </header>

          <section className="relative flex-1 px-4 py-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-[22px] border border-[#2d8cff]/35 bg-[#101722]/80 shadow-[0_0_0_1px_rgba(45,140,255,0.08)] backdrop-blur">
                {activeWidgets.length === 0 ? (
                  <div className="flex min-h-[calc(100vh-220px)] flex-col items-center justify-center px-6 py-10 text-center">
                    <div className="mb-8 flex items-center gap-6 opacity-40">
                      <DirectionalGlyph direction="up" />
                      <DirectionalGlyph direction="left" />
                      <div className="h-14 w-14 rounded-2xl border border-white/10 bg-white/[0.04]" />
                      <DirectionalGlyph direction="right" highlight />
                      <DirectionalGlyph direction="down" />
                    </div>

                    <div className="text-xs uppercase tracking-[0.26em] text-slate-500">
                      {copy.widgetsTitle}
                    </div>
                    <h1 className="mt-3 text-2xl font-semibold text-white">{copy.emptyTitle}</h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                      {copy.emptyDescription}
                    </p>

                    <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {widgets.map((widget) => (
                        <button
                          key={widget.id}
                          type="button"
                          onClick={() => addWidget(widget.id)}
                          className={`rounded-2xl border border-white/10 bg-gradient-to-br ${widget.tone} p-5 text-left transition hover:-translate-y-0.5 hover:border-white/20`}
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-slate-100">
                            <WidgetGlyph widgetId={widget.id} />
                          </div>
                          <div className="mt-4 text-base font-semibold text-white">{widget.label}</div>
                          <div className="mt-1 text-sm text-slate-300">{widget.detail}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid items-start gap-4 p-4 xl:grid-cols-12">
                    {activeWidgets.map((widget) => (
                      <section
                        key={widget.id}
                        className={`${widgetSpanClass(widget.id)} overflow-hidden rounded-[20px] border border-white/10 bg-gradient-to-br ${widget.tone} shadow-[0_20px_50px_rgba(0,0,0,0.28)]`}
                      >
                        <div className="border-b border-white/10 bg-black/20 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-white">
                                <WidgetGlyph widgetId={widget.id} />
                                <h2 className="text-sm font-semibold uppercase tracking-[0.18em]">
                                  {widget.label}
                                </h2>
                              </div>
                              <p className="mt-1 text-sm text-slate-300">{widget.detail}</p>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void runWindowAction(
                                    widget.bridgeWindowKey,
                                    windowStateByKey.get(widget.bridgeWindowKey)?.open
                                      ? "focus"
                                      : "open"
                                  )
                                }
                                disabled={pendingWindowKey === widget.bridgeWindowKey || !bridge}
                                className="rounded-md border border-[#2d8cff]/40 bg-[#2d8cff]/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#9eceff] transition hover:border-[#2d8cff]/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {windowStateByKey.get(widget.bridgeWindowKey)?.open
                                  ? copy.focusWindow
                                  : copy.openWindow}
                              </button>

                              <button
                                type="button"
                                onClick={() => removeWidget(widget.id)}
                                className="rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-xs uppercase tracking-[0.16em] text-slate-300 transition hover:border-white/20 hover:text-white"
                              >
                                x
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="p-4">
                          {widget.id === "orderbook" ? (
                            <div className="space-y-4">
                              <div className="grid gap-3 md:grid-cols-3">
                                <MetricCard
                                  label={copy.orderbookSpread}
                                  value={selectedRow ? formatSpread(selectedRow.spreadBps) : "--"}
                                />
                                <MetricCard
                                  label={copy.orderbookImbalance}
                                  value={
                                    selectedRow
                                      ? formatImbalance(selectedRow.orderBookImbalance)
                                      : "--"
                                  }
                                />
                                <MetricCard
                                  label={copy.marketPulse}
                                  value={frame ? frame.overview.marketPulse.toFixed(1) : "--"}
                                />
                              </div>

                              {selectedRow ? (
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <BookSideColumn
                                    title={copy.orderbookBid}
                                    levels={orderBook.bids}
                                    accent="bg-emerald-500/22"
                                    textTone="text-emerald-200"
                                  />
                                  <BookSideColumn
                                    title={copy.orderbookAsk}
                                    levels={orderBook.asks}
                                    accent="bg-rose-500/22"
                                    textTone="text-rose-200"
                                  />
                                </div>
                              ) : (
                                <EmptyWidgetState label={copy.noData} />
                              )}
                            </div>
                          ) : null}

                          {widget.id === "chart" ? (
                            <div className="space-y-4">
                              {selectedRow ? (
                                <>
                                  <div className="grid gap-3 md:grid-cols-4">
                                    <MetricCard
                                      label={copy.chartChange24h}
                                      value={formatPercent(selectedRow.change24hPct, 2)}
                                      className={deltaClass(selectedRow.change24hPct)}
                                    />
                                    <MetricCard
                                      label={copy.chartMomentum}
                                      value={`${formatPercent(selectedRow.momentum30sPct, 2)} / ${formatPercent(
                                        selectedRow.momentum2mPct,
                                        2
                                      )}`}
                                      className={deltaClass(selectedRow.momentum30sPct)}
                                    />
                                    <MetricCard
                                      label={copy.chartFunding}
                                      value={`${(selectedRow.fundingRate * 100).toFixed(4)}%`}
                                      className={deltaClass(selectedRow.fundingRate)}
                                    />
                                    <MetricCard
                                      label={copy.score}
                                      value={selectedRow.score.toFixed(1)}
                                      className={scoreClass(selectedRow.score)}
                                    />
                                  </div>

                                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-4">
                                    <div className="flex flex-wrap items-end justify-between gap-3">
                                      <div>
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                          {copy.chartHeader}
                                        </div>
                                        <div className="mt-2 text-3xl font-semibold text-white">
                                          {formatPrice(selectedRow.lastPrice)}
                                        </div>
                                      </div>
                                      <div
                                        className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${biasPillClass(
                                          selectedRow.bias
                                        )}`}
                                      >
                                        {selectedRow.bias}
                                      </div>
                                    </div>

                                    {selectedHistory.length >= 2 ? (
                                      <SparklineChart
                                        history={selectedHistory}
                                        tone={
                                          selectedRow.bias === "SHORT" ? "#fb7185" : "#38bdf8"
                                        }
                                      />
                                    ) : (
                                      <div className="mt-6 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
                                        {copy.chartNoHistory}
                                      </div>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <EmptyWidgetState label={copy.noData} />
                              )}
                            </div>
                          ) : null}

                          {widget.id === "quotes" ? (
                            <div className="space-y-3">
                              {symbolPool.length > 0 ? (
                                symbolPool.slice(0, 10).map((row) => (
                                  <button
                                    key={row.symbol}
                                    type="button"
                                    onClick={() => setActiveTabSymbol(row.symbol)}
                                    className={`grid w-full grid-cols-[minmax(0,1.2fr)_auto_auto_auto] items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                                      row.symbol === resolvedSymbol
                                        ? "border-[#2d8cff]/45 bg-[#2d8cff]/10"
                                        : "border-white/8 bg-black/20 hover:border-white/20"
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="truncate font-semibold text-white">
                                          {row.symbol}
                                        </span>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${biasPillClass(
                                            row.bias
                                          )}`}
                                        >
                                          {row.bias}
                                        </span>
                                      </div>
                                      <div className="mt-1 truncate text-xs text-slate-500">
                                        {formatPrice(row.lastPrice)} | {copy.tape}:{" "}
                                        {compactUsd(row.tradeNotional60s)}
                                      </div>
                                    </div>
                                    <div className={`text-sm font-semibold ${scoreClass(row.score)}`}>
                                      {row.score.toFixed(1)}
                                    </div>
                                    <div className={`text-sm font-semibold ${deltaClass(row.momentum30sPct)}`}>
                                      {formatPercent(row.momentum30sPct, 2)}
                                    </div>
                                    <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
                                      {formatSpread(row.spreadBps)}
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <EmptyWidgetState label={copy.quotesEmpty} />
                              )}
                            </div>
                          ) : null}

                          {widget.id === "tables" ? (
                            <div className="grid gap-4 lg:grid-cols-3">
                              <TableBlock title={copy.watchlistTitle}>
                                {watchlistRows.length > 0 ? (
                                  watchlistRows.slice(0, 6).map((row) => (
                                    <MiniSymbolRow
                                      key={row.symbol}
                                      row={row}
                                      active={row.symbol === resolvedSymbol}
                                      actionLabel={copy.unwatch}
                                      onSelect={() => setActiveTabSymbol(row.symbol)}
                                      onAction={() => toggleWatchSymbol(row.symbol)}
                                    />
                                  ))
                                ) : (
                                  <EmptyListText label={copy.tablesWatchlistEmpty} />
                                )}
                              </TableBlock>

                              <TableBlock title={copy.activeTradesTitle}>
                                {activeTradeRows.length > 0 ? (
                                  activeTradeRows.slice(0, 6).map((row) => (
                                    <MiniSymbolRow
                                      key={row.symbol}
                                      row={row}
                                      active={row.symbol === resolvedSymbol}
                                      actionLabel={copy.unmarkTrade}
                                      onSelect={() => setActiveTabSymbol(row.symbol)}
                                      onAction={() => toggleActiveTradeSymbol(row.symbol)}
                                      showAccountBadge={accountPositionSet.has(row.symbol)}
                                      accountLabel={copy.accountPositions}
                                    />
                                  ))
                                ) : (
                                  <EmptyListText label={copy.tablesTradesEmpty} />
                                )}
                              </TableBlock>

                              <TableBlock title={copy.moduleWindowsTitle}>
                                {terminalWindowKeys.map((windowKey) => {
                                  const windowState =
                                    windowStateByKey.get(windowKey) ??
                                    ({
                                      key: windowKey,
                                      title: getWindowLabel(windowKey, interfaceLanguage),
                                      route: getWindowRoute(windowKey),
                                      open: false,
                                      alwaysOnTop: false,
                                      opacity: 1,
                                      displayId: null,
                                      bounds: null
                                    } satisfies DesktopWindowSnapshot);

                                  const isBusy = pendingWindowKey === windowKey;

                                  return (
                                    <div
                                      key={windowKey}
                                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-3"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div>
                                          <div className="font-medium text-white">
                                            {getWindowLabel(windowKey, interfaceLanguage)}
                                          </div>
                                          <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                                            {copy.windowsRoute}: {windowState.route}
                                          </div>
                                        </div>
                                        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                          {windowState.open
                                            ? copy.windowStatusOpen
                                            : copy.windowStatusClosed}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void runWindowAction(
                                            windowKey,
                                            windowState.open ? "focus" : "open"
                                          )
                                        }
                                        disabled={isBusy || !bridge}
                                        className="mt-3 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-200 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {windowState.open ? copy.focusWindow : copy.launchWindow}
                                      </button>
                                    </div>
                                  );
                                })}
                              </TableBlock>
                            </div>
                          ) : null}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>

              <aside className="space-y-4">
                <div className="rounded-[22px] border border-white/10 bg-[#101722]/85 p-4 shadow-lg shadow-black/20">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                    {copy.profileTitle}
                  </div>
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-medium text-white">{profileLabel}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                      {profileModeLabel}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <MetricCard label={copy.openWindows} value={String(openWindowCount)} />
                      <MetricCard
                        label={copy.latency}
                        value={latencyMs !== null ? `${latencyMs} ms` : "--"}
                      />
                      <MetricCard
                        label={copy.marketPulse}
                        value={frame ? frame.overview.marketPulse.toFixed(1) : "--"}
                      />
                      <MetricCard label={copy.backend} value={parseBackendLabel(socketTargetUrl)} />
                    </div>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-[#101722]/85 p-4 shadow-lg shadow-black/20">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                    {copy.workspaceStatusTitle}
                  </div>
                  <div className="mt-3 space-y-3">
                    <MetricCard label={copy.savedLayout} value={workspaceHydrated ? "ready" : "loading"} />
                    <MetricCard label={copy.syncedProfile} value={profileLabel} />
                    <MetricCard label={copy.screens} value={String(shellState?.displays.length ?? 1)} />
                    <MetricCard label={copy.openWindows} value={String(openWindowCount)} />
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-[#101722]/85 p-4 shadow-lg shadow-black/20">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                    {copy.watchlistTitle}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {watchlistRows.length > 0 ? (
                      watchlistRows.slice(0, 10).map((row) => (
                        <SymbolChip
                          key={row.symbol}
                          label={row.symbol}
                          active={row.symbol === resolvedSymbol}
                          onClick={() => setActiveTabSymbol(row.symbol)}
                        />
                      ))
                    ) : (
                      <EmptyListText label={copy.tablesWatchlistEmpty} />
                    )}
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-[#101722]/85 p-4 shadow-lg shadow-black/20">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                    {copy.recentSignalsTitle}
                  </div>
                  <div className="mt-3 space-y-3">
                    {recentAlerts.length > 0 ? (
                      recentAlerts.map((alert) => (
                        <button
                          key={alert.id}
                          type="button"
                          onClick={() => setActiveTabSymbol(alert.symbol)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left ${getAlertSeverityClass(
                            alert
                          )}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold">{alert.symbol}</div>
                            <div className="text-[11px] uppercase tracking-[0.16em]">
                              {alert.severity}
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-slate-200">{alert.reason}</div>
                          <div className="mt-2 text-xs text-slate-300">
                            {formatClock(alert.createdAt)} | {compactUsd(alert.notionalUsd)}
                          </div>
                        </button>
                      ))
                    ) : (
                      <EmptyListText label={copy.recentSignalsEmpty} />
                    )}
                  </div>
                </div>

                {actionError ? (
                  <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    {actionError}
                  </div>
                ) : null}
              </aside>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.05] px-3 py-1.5 text-slate-300">
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  className
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 break-all text-lg font-semibold text-white ${className ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyWidgetState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
      {label}
    </div>
  );
}

function EmptyListText({ label }: { label: string }) {
  return <div className="text-sm text-slate-500">{label}</div>;
}

function TableBlock({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function MiniSymbolRow({
  row,
  active,
  actionLabel,
  onSelect,
  onAction,
  showAccountBadge = false,
  accountLabel
}: {
  row: ScreenerRow;
  active: boolean;
  actionLabel: string;
  onSelect: () => void;
  onAction: () => void;
  showAccountBadge?: boolean;
  accountLabel?: string;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        active ? "border-[#2d8cff]/35 bg-[#2d8cff]/10" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onSelect} className="text-left">
          <div className="font-medium text-white">{row.symbol}</div>
          <div className={`mt-1 text-xs ${deltaClass(row.momentum30sPct)}`}>
            {formatPercent(row.momentum30sPct, 2)} | {formatPrice(row.lastPrice)}
          </div>
        </button>

        <button
          type="button"
          onClick={onAction}
          className="rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-200 transition hover:border-white/20 hover:text-white"
        >
          {actionLabel}
        </button>
      </div>

      {showAccountBadge && accountLabel ? (
        <div className="mt-2 inline-flex rounded-full border border-[#f0b90b]/20 bg-[#f0b90b]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#f2d786]">
          {accountLabel}
        </div>
      ) : null}
    </div>
  );
}

function SymbolChip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] transition ${
        active
          ? "border-[#2d8cff]/45 bg-[#2d8cff]/10 text-white"
          : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function BookSideColumn({
  title,
  levels,
  accent,
  textTone
}: {
  title: string;
  levels: OrderBookLevel[];
  accent: string;
  textTone: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="space-y-2">
        {levels.map((level) => (
          <div
            key={`${level.side}-${level.price.toFixed(8)}`}
            className="relative overflow-hidden rounded-xl border border-white/8 bg-black/20 px-3 py-2"
          >
            <div
              className={`absolute inset-y-0 right-0 ${accent}`}
              style={{ width: `${Math.max(level.depthRatio * 100, 8)}%` }}
            />
            <div className="relative grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
              <span className={textTone}>{formatPrice(level.price)}</span>
              <span className="text-slate-200">{level.size.toFixed(3)}</span>
              <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                {level.cumulative.toFixed(3)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SparklineChart({
  history,
  tone
}: {
  history: PricePoint[];
  tone: string;
}) {
  const width = 760;
  const height = 240;
  const path = buildSparklinePath(history, width, height);
  const startPrice = history[0]?.price ?? 0;
  const endPrice = history[history.length - 1]?.price ?? 0;
  const deltaPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-400">
        <span>{history.length} pts</span>
        <span className={deltaClass(deltaPct)}>{formatPercent(deltaPct, 2)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full overflow-visible">
        <defs>
          <linearGradient id="sparkline-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={tone} stopOpacity="0.45" />
            <stop offset="100%" stopColor={tone} stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          d={path}
          fill="none"
          stroke="url(#sparkline-stroke)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function BrandGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6.5 9.4 4l4 6.1L8.2 20 4 6.5Z" />
      <path d="m13.4 10.1 2.8-4.1L20 8.2 16.8 20l-3.7-9.9Z" />
    </svg>
  );
}

function WidgetGlyph({ widgetId }: { widgetId: TerminalWidgetId }) {
  if (widgetId === "orderbook") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 5v14" />
        <path d="M12 8h7" />
        <path d="M12 12h5" />
        <path d="M12 16h7" />
        <path d="M5 8h1" />
        <path d="M5 12h1" />
        <path d="M5 16h1" />
      </svg>
    );
  }

  if (widgetId === "chart") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 18V6" />
        <path d="M4 18h16" />
        <path d="m7 15 3-4 3 2 4-6" />
      </svg>
    );
  }

  if (widgetId === "quotes") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 7h14" />
        <path d="M5 12h14" />
        <path d="M5 17h14" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.2" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function DirectionalGlyph({
  direction,
  highlight = false
}: {
  direction: "up" | "right" | "down" | "left";
  highlight?: boolean;
}) {
  const rotation =
    direction === "up"
      ? "-rotate-90"
      : direction === "down"
        ? "rotate-90"
        : direction === "left"
          ? "rotate-180"
          : "";

  return (
    <div
      className={`flex h-16 w-16 items-center justify-center rounded-2xl border ${
        highlight
          ? "border-[#2d8cff] bg-[#2d8cff]/10 text-[#7fc0ff]"
          : "border-white/8 bg-white/[0.02] text-slate-600"
      } ${rotation}`}
    >
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 7h8.2" />
        <path d="m11.5 4.5 5 2.5-5 2.5" />
      </svg>
    </div>
  );
}
