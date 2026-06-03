import type {
  CollapsibleSectionId,
  DashboardPanelId,
  DashboardPanelLayout,
  InterfaceLanguage
} from "./types";

export const desktopModuleSections: CollapsibleSectionId[] = [
  "overview",
  "filters",
  "screener",
  "account",
  "activeTrades",
  "riskCenter",
  "correlationHeatmap",
  "varPanel",
  "fundingBasis",
  "marketFlow",
  "signalIntelligence",
  "metaRegimeGovernor",
  "positionRiskOrchestrator",
  "regimeMemory",
  "regimePrediction",
  "regimeFeedbackCalibration",
  "pnlAttribution",
  "signalStatistics",
  "learningCenter",
  "tradeJournal",
  "watchlist",
  "volumeMilestones",
  "volumeThresholdMilestones",
  "alerts",
  "frameTelemetry",
  "renderTelemetry",
  "health"
];

export const desktopDashboardPanels: DashboardPanelId[] = [
  "filters",
  "screener",
  "overview",
  "alerts",
  "socialAuth",
  "cabinet",
  "account",
  "activeTrades",
  "riskCenter",
  "correlationHeatmap",
  "varPanel",
  "fundingBasis",
  "marketFlow",
  "signalIntelligence",
  "metaRegimeGovernor",
  "positionRiskOrchestrator",
  "regimeMemory",
  "regimePrediction",
  "regimeFeedbackCalibration",
  "pnlAttribution",
  "signalStatistics",
  "learningCenter",
  "tradeJournal",
  "watchlist",
  "volumeMilestones",
  "volumeThresholdMilestones",
  "frameTelemetry",
  "renderTelemetry",
  "health"
];

export const defaultDashboardPanelLayout: Record<
  DashboardPanelId,
  { colSpan: number; minHeightPx: number; x: number; y: number; widthPx: number; heightPx: number }
> = {
  filters: { colSpan: 3, minHeightPx: 260, x: 12, y: 112, widthPx: 390, heightPx: 520 },
  screener: { colSpan: 9, minHeightPx: 520, x: 414, y: 112, widthPx: 1150, heightPx: 560 },
  overview: { colSpan: 4, minHeightPx: 180, x: 12, y: 690, widthPx: 500, heightPx: 220 },
  alerts: { colSpan: 4, minHeightPx: 260, x: 524, y: 690, widthPx: 500, heightPx: 320 },
  socialAuth: { colSpan: 4, minHeightPx: 260, x: 1036, y: 690, widthPx: 528, heightPx: 300 },
  cabinet: { colSpan: 4, minHeightPx: 360, x: 12, y: 1030, widthPx: 500, heightPx: 540 },
  account: { colSpan: 3, minHeightPx: 320, x: 524, y: 1030, widthPx: 380, heightPx: 420 },
  activeTrades: { colSpan: 3, minHeightPx: 240, x: 916, y: 1030, widthPx: 320, heightPx: 300 },
  riskCenter: { colSpan: 5, minHeightPx: 240, x: 916, y: 1360, widthPx: 648, heightPx: 280 },
  correlationHeatmap: { colSpan: 4, minHeightPx: 260, x: 12, y: 1360, widthPx: 500, heightPx: 320 },
  varPanel: { colSpan: 4, minHeightPx: 220, x: 524, y: 1360, widthPx: 380, heightPx: 260 },
  fundingBasis: { colSpan: 4, minHeightPx: 220, x: 12, y: 1710, widthPx: 500, heightPx: 280 },
  marketFlow: { colSpan: 4, minHeightPx: 260, x: 524, y: 1710, widthPx: 500, heightPx: 320 },
  signalIntelligence: { colSpan: 4, minHeightPx: 260, x: 1036, y: 2360, widthPx: 528, heightPx: 320 },
  metaRegimeGovernor: {
    colSpan: 4,
    minHeightPx: 240,
    x: 1036,
    y: 2710,
    widthPx: 528,
    heightPx: 280
  },
  positionRiskOrchestrator: {
    colSpan: 5,
    minHeightPx: 300,
    x: 12,
    y: 2360,
    widthPx: 720,
    heightPx: 420
  },
  regimeMemory: {
    colSpan: 4,
    minHeightPx: 260,
    x: 1036,
    y: 3020,
    widthPx: 528,
    heightPx: 320
  },
  regimePrediction: {
    colSpan: 4,
    minHeightPx: 260,
    x: 1036,
    y: 3350,
    widthPx: 528,
    heightPx: 320
  },
  regimeFeedbackCalibration: {
    colSpan: 4,
    minHeightPx: 280,
    x: 1036,
    y: 3680,
    widthPx: 528,
    heightPx: 340
  },
  signalStatistics: {
    colSpan: 6,
    minHeightPx: 420,
    x: 12,
    y: 3680,
    widthPx: 900,
    heightPx: 620
  },
  learningCenter: {
    colSpan: 6,
    minHeightPx: 420,
    x: 12,
    y: 4310,
    widthPx: 900,
    heightPx: 620
  },
  tradeJournal: {
    colSpan: 6,
    minHeightPx: 420,
    x: 924,
    y: 3680,
    widthPx: 640,
    heightPx: 620
  },
  pnlAttribution: { colSpan: 4, minHeightPx: 220, x: 1036, y: 1710, widthPx: 528, heightPx: 280 },
  watchlist: { colSpan: 3, minHeightPx: 180, x: 1248, y: 1030, widthPx: 316, heightPx: 260 },
  volumeMilestones: { colSpan: 4, minHeightPx: 260, x: 12, y: 2020, widthPx: 500, heightPx: 340 },
  volumeThresholdMilestones: {
    colSpan: 4,
    minHeightPx: 260,
    x: 524,
    y: 2020,
    widthPx: 500,
    heightPx: 340
  },
  frameTelemetry: { colSpan: 3, minHeightPx: 260, x: 1036, y: 2020, widthPx: 528, heightPx: 360 },
  renderTelemetry: { colSpan: 3, minHeightPx: 240, x: 1036, y: 2390, widthPx: 528, heightPx: 320 },
  health: { colSpan: 3, minHeightPx: 220, x: 1036, y: 2720, widthPx: 528, heightPx: 300 }
};

export const dashboardPanelColumnRange = {
  min: 3,
  max: 12
};

export const dashboardPanelHeightRange = {
  min: 140,
  max: 1100
};

export const dashboardPanelFreeBoundsRange = {
  maxPosition: 10000,
  minWidth: 260,
  maxWidth: 2000,
  minHeight: 140,
  maxHeight: 1400
};

export const desktopModuleLabels: Record<CollapsibleSectionId, string> = {
  overview: "Overview",
  filters: "Filters",
  screener: "Darra Terminal",
  account: "Binance Account",
  activeTrades: "Active Trades",
  riskCenter: "Risk Center",
  correlationHeatmap: "Correlation Heatmap",
  varPanel: "VaR",
  fundingBasis: "Funding/Basis",
  marketFlow: "Market Flow",
  signalIntelligence: "Signal Intelligence",
  metaRegimeGovernor: "Meta Regime Governor",
  positionRiskOrchestrator: "Position Risk Orchestrator",
  regimeMemory: "Regime Memory",
  regimePrediction: "Regime Prediction",
  regimeFeedbackCalibration: "Regime Feedback Calibration",
  pnlAttribution: "PnL Attribution",
  signalStatistics: "Signal Statistics",
  learningCenter: "Learning Center",
  tradeJournal: "Trade Journal",
  watchlist: "Watchlist",
  volumeMilestones: "100M Volume",
  volumeThresholdMilestones: "1-100M Volume",
  alerts: "Signal Tape",
  frameTelemetry: "Frame Telemetry",
  renderTelemetry: "Render Telemetry",
  health: "Feed Health"
};

export const desktopModuleLabelsByLanguage: Record<
  InterfaceLanguage,
  Record<CollapsibleSectionId, string>
> = {
  en: desktopModuleLabels,
  ru: {
    ...desktopModuleLabels,
    volumeMilestones: "100M Volume",
    volumeThresholdMilestones: "1-100M Volume",
    overview: "РћР±Р·РѕСЂ",
    filters: "Р¤РёР»СЊС‚СЂС‹",
    screener: "Darra Terminal",
    account: "РђРєРєР°СѓРЅС‚ Binance",
    activeTrades: "РђРєС‚РёРІРЅС‹Рµ СЃРґРµР»РєРё",
    riskCenter: "Risk Center",
    correlationHeatmap: "Correlation Heatmap",
    varPanel: "VaR",
    fundingBasis: "Funding/Basis",
    marketFlow: "Market Flow",
    signalIntelligence: "Signal Intelligence",
    metaRegimeGovernor: "Meta Regime Governor",
    positionRiskOrchestrator: "Position Risk Orchestrator",
    regimeMemory: "Regime Memory",
    regimePrediction: "Regime Prediction",
    regimeFeedbackCalibration: "Regime Feedback Calibration",
    pnlAttribution: "PnL Attribution",
    learningCenter: "Learning Center",
    tradeJournal: "Trade Journal",
    watchlist: "Р›РёСЃС‚ РЅР°Р±Р»СЋРґРµРЅРёСЏ",
    alerts: "Р›РµРЅС‚Р° СЃРёРіРЅР°Р»РѕРІ",
    health: "РЎРѕСЃС‚РѕСЏРЅРёРµ С„РёРґР°"
  }
};

export const getDesktopModuleLabel = (
  section: CollapsibleSectionId,
  language: InterfaceLanguage = "en"
): string => desktopModuleLabelsByLanguage[language][section];

export const desktopSectionDomIds: Record<CollapsibleSectionId, string> = {
  overview: "overview",
  filters: "filters",
  screener: "screener",
  account: "account",
  activeTrades: "active-trades",
  riskCenter: "risk-center",
  correlationHeatmap: "correlation-heatmap",
  varPanel: "var-panel",
  fundingBasis: "funding-basis",
  marketFlow: "market-flow",
  signalIntelligence: "signal-intelligence",
  metaRegimeGovernor: "meta-regime-governor",
  positionRiskOrchestrator: "position-risk-orchestrator",
  regimeMemory: "regime-memory",
  regimePrediction: "regime-prediction",
  regimeFeedbackCalibration: "regime-feedback-calibration",
  pnlAttribution: "pnl-attribution",
  signalStatistics: "signal-statistics",
  learningCenter: "learning-center",
  tradeJournal: "trade-journal",
  watchlist: "watchlist",
  volumeMilestones: "volume-milestones",
  volumeThresholdMilestones: "volume-threshold-milestones",
  alerts: "alerts",
  frameTelemetry: "frame-telemetry",
  renderTelemetry: "render-telemetry",
  health: "health"
};

export const isCollapsibleSectionId = (value: string): value is CollapsibleSectionId =>
  desktopModuleSections.includes(value as CollapsibleSectionId);

export const isDashboardPanelId = (value: string): value is DashboardPanelId =>
  desktopDashboardPanels.includes(value as DashboardPanelId);

export const normalizeDashboardPanelOrder = (
  value: DashboardPanelId[] | readonly string[] | null | undefined
): DashboardPanelId[] => {
  const seen = new Set<DashboardPanelId>();
  const normalized: DashboardPanelId[] = [];

  for (const item of Array.isArray(value) ? value : []) {
    if (!isDashboardPanelId(item) || seen.has(item)) {
      continue;
    }

    seen.add(item);
    normalized.push(item);
  }

  for (const item of desktopDashboardPanels) {
    if (!seen.has(item)) {
      normalized.push(item);
    }
  }

  return normalized;
};

export const normalizeDashboardPanelSpan = (
  panel: DashboardPanelId,
  value: number | null | undefined
): number => {
  const fallback = defaultDashboardPanelLayout[panel].colSpan;
  const numericValue = Number(value);
  const nextValue = Number.isFinite(numericValue) ? numericValue : fallback;

  return Math.min(
    Math.max(Math.round(nextValue), dashboardPanelColumnRange.min),
    dashboardPanelColumnRange.max
  );
};

export const normalizeDashboardPanelHeight = (
  panel: DashboardPanelId,
  value: number | null | undefined
): number => {
  const fallback = defaultDashboardPanelLayout[panel].minHeightPx;
  const numericValue = Number(value);
  const nextValue = Number.isFinite(numericValue) ? numericValue : fallback;

  return Math.min(
    Math.max(Math.round(nextValue), dashboardPanelHeightRange.min),
    dashboardPanelHeightRange.max
  );
};

export const normalizeDashboardPanelCoordinate = (
  value: number | null | undefined,
  fallback: number
): number => {
  const numericValue = Number(value);
  const nextValue = Number.isFinite(numericValue) ? numericValue : fallback;

  return Math.min(
    Math.max(Math.round(nextValue), 0),
    dashboardPanelFreeBoundsRange.maxPosition
  );
};

export const normalizeDashboardPanelWidth = (
  panel: DashboardPanelId,
  value: number | null | undefined
): number => {
  const fallback = defaultDashboardPanelLayout[panel].widthPx;
  const numericValue = Number(value);
  const nextValue = Number.isFinite(numericValue) ? numericValue : fallback;

  return Math.min(
    Math.max(Math.round(nextValue), dashboardPanelFreeBoundsRange.minWidth),
    dashboardPanelFreeBoundsRange.maxWidth
  );
};

export const normalizeDashboardPanelFreeHeight = (
  panel: DashboardPanelId,
  value: number | null | undefined
): number => {
  const fallback = defaultDashboardPanelLayout[panel].heightPx;
  const numericValue = Number(value);
  const nextValue = Number.isFinite(numericValue) ? numericValue : fallback;

  return Math.min(
    Math.max(Math.round(nextValue), dashboardPanelFreeBoundsRange.minHeight),
    dashboardPanelFreeBoundsRange.maxHeight
  );
};

export const normalizeDashboardPanelLayout = (
  value: DashboardPanelLayout | null | undefined
): DashboardPanelLayout => {
  const nextLayout: DashboardPanelLayout = {};

  for (const panel of desktopDashboardPanels) {
    nextLayout[panel] = {
      colSpan: normalizeDashboardPanelSpan(panel, value?.[panel]?.colSpan),
      minHeightPx: normalizeDashboardPanelHeight(panel, value?.[panel]?.minHeightPx),
      x: normalizeDashboardPanelCoordinate(value?.[panel]?.x, defaultDashboardPanelLayout[panel].x),
      y: normalizeDashboardPanelCoordinate(value?.[panel]?.y, defaultDashboardPanelLayout[panel].y),
      widthPx: normalizeDashboardPanelWidth(panel, value?.[panel]?.widthPx),
      heightPx: normalizeDashboardPanelFreeHeight(panel, value?.[panel]?.heightPx)
    };
  }

  return nextLayout;
};
