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
  "chartPanel",
  "decisionStack",
  "symbolDetailRail",
  "marketStory",
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
  "knowledgeWorkspace",
  "watchlist",
  "volumeMilestones",
  "volumeThresholdMilestones",
  "alerts",
  "frameTelemetry",
  "renderTelemetry",
  "health",
  "replay"
];

// Keep in sync with Electron's managedWindowDefinitions in desktop/main.cjs.
// desktopModuleSections may grow with routable dashboard-only modules; this list is the
// desktop shell guard for module IDs that Electron is expected to open as managed windows.
export const desktopManagedModuleSections = [
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
  "chartPanel",
  "decisionStack",
  "symbolDetailRail",
  "marketStory",
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
  "health",
  "replay"
] as const satisfies readonly CollapsibleSectionId[];

export type DesktopManagedModuleSectionId = (typeof desktopManagedModuleSections)[number];

export type WorkspacePresetId =
  | "primary"
  | "chartFirst"
  | "trading"
  | "review"
  | "knowledge"
  | "risk";

export interface WorkspacePreset {
  id: WorkspacePresetId;
  label: string;
  description: string;
  visibleSections: CollapsibleSectionId[];
  windowSections?: CollapsibleSectionId[];
}

export const defaultWorkspacePresetId: WorkspacePresetId = "primary";

export const workspacePresetIds: WorkspacePresetId[] = [
  "primary",
  "chartFirst",
  "trading",
  "review",
  "knowledge",
  "risk"
];

export const workspacePresets: Record<WorkspacePresetId, WorkspacePreset> = {
  primary: {
    id: "primary",
    label: "Live Workspace",
    description: "Decision Dashboard first, then Signal -> Decision -> Execution -> Positions -> Review -> Knowledge for the live decision pipeline.",
    visibleSections: [
      "alerts",
      "screener",
      "decisionStack",
      "symbolDetailRail",
      "account",
      "activeTrades",
      "riskCenter"
    ],
    windowSections: [
      "alerts",
      "screener",
      "decisionStack",
      "symbolDetailRail",
      "account",
      "activeTrades",
      "riskCenter"
    ]
  },
  trading: {
    id: "trading",
    label: "Execution Workspace",
    description: "Execution Ticket, Preflight, Safe-To-Add and Execution Readiness as a standalone workflow stage.",
    visibleSections: [
      "alerts",
      "decisionStack",
      "symbolDetailRail",
      "account",
      "activeTrades",
      "screener",
      "watchlist",
      "riskCenter",
      "positionRiskOrchestrator",
      "marketFlow",
      "fundingBasis"
    ],
    windowSections: [
      "account",
      "activeTrades",
      "screener",
      "alerts",
      "watchlist",
      "riskCenter",
      "positionRiskOrchestrator"
    ]
  },
  risk: {
    id: "risk",
    label: "Risk Workspace",
    description: "Portfolio and position risk view with funding, flow, VaR and correlation context.",
    visibleSections: [
      "riskCenter",
      "positionRiskOrchestrator",
      "correlationHeatmap",
      "varPanel",
      "pnlAttribution",
      "fundingBasis",
      "marketFlow",
      "health"
    ],
    windowSections: [
      "riskCenter",
      "positionRiskOrchestrator",
      "correlationHeatmap",
      "varPanel",
      "pnlAttribution",
      "fundingBasis",
      "marketFlow",
      "health"
    ]
  },
  review: {
    id: "review",
    label: "Review Workspace",
    description: "Decision Review first, with Decision Replay and Trader Knowledge as review tools.",
    visibleSections: [
      "tradeJournal",
      "replay",
      "knowledgeWorkspace",
      "signalStatistics",
      "learningCenter",
      "pnlAttribution",
      "signalIntelligence",
      "regimeMemory",
      "regimePrediction",
      "regimeFeedbackCalibration",
      "volumeThresholdMilestones"
    ],
    windowSections: [
      "tradeJournal",
      "replay",
      "signalStatistics",
      "learningCenter",
      "pnlAttribution",
      "signalIntelligence",
      "regimeMemory",
      "regimePrediction",
      "regimeFeedbackCalibration",
      "volumeThresholdMilestones"
    ]
  },
  knowledge: {
    id: "knowledge",
    label: "Trader Knowledge",
    description: "System memory home for known links, unknown gaps and reconstruction coverage.",
    visibleSections: [
      "knowledgeWorkspace",
      "tradeJournal",
      "replay",
      "signalStatistics",
      "learningCenter",
      "pnlAttribution"
    ],
    windowSections: [
      "tradeJournal",
      "replay",
      "signalStatistics",
      "learningCenter",
      "pnlAttribution"
    ]
  },
  chartFirst: {
    id: "chartFirst",
    label: "Signal Workspace",
    description: "Signal-first symbol focus with Decision Inbox, why-now context, chart, flow and risk.",
    visibleSections: [
      "screener",
      "alerts",
      "watchlist",
      "chartPanel",
      "decisionStack",
      "symbolDetailRail",
      "marketStory",
      "marketFlow",
      "fundingBasis",
      "riskCenter",
      "positionRiskOrchestrator",
      "account",
      "activeTrades",
      "health"
    ],
    windowSections: [
      "screener",
      "alerts",
      "watchlist",
      "chartPanel",
      "decisionStack",
      "symbolDetailRail",
      "marketStory",
      "riskCenter",
      "positionRiskOrchestrator",
      "account",
      "activeTrades",
      "health"
    ]
  }
};

export const getWorkspacePreset = (
  id: WorkspacePresetId | string | null | undefined
): WorkspacePreset => {
  if (id && workspacePresetIds.includes(id as WorkspacePresetId)) {
    return workspacePresets[id as WorkspacePresetId];
  }

  return workspacePresets[defaultWorkspacePresetId];
};

export const desktopDashboardPanels: DashboardPanelId[] = [
  "alerts",
  "screener",
  "decisionStack",
  "symbolDetailRail",
  "chartPanel",
  "account",
  "activeTrades",
  "riskCenter",
  "positionRiskOrchestrator",
  "tradeJournal",
  "replay",
  "knowledgeWorkspace",
  "overview",
  "filters",
  "watchlist",
  "marketStory",
  "marketFlow",
  "fundingBasis",
  "correlationHeatmap",
  "varPanel",
  "pnlAttribution",
  "signalStatistics",
  "learningCenter",
  "signalIntelligence",
  "metaRegimeGovernor",
  "regimeMemory",
  "regimePrediction",
  "regimeFeedbackCalibration",
  "volumeMilestones",
  "volumeThresholdMilestones",
  "frameTelemetry",
  "renderTelemetry",
  "health",
  "socialAuth",
  "cabinet"
];

export const defaultDashboardPanelLayout: Record<
  DashboardPanelId,
  { colSpan: number; minHeightPx: number; x: number; y: number; widthPx: number; heightPx: number }
> = {
  filters: { colSpan: 3, minHeightPx: 260, x: 12, y: 1220, widthPx: 390, heightPx: 360 },
  screener: { colSpan: 6, minHeightPx: 520, x: 12, y: 112, widthPx: 780, heightPx: 540 },
  overview: { colSpan: 4, minHeightPx: 180, x: 12, y: 690, widthPx: 500, heightPx: 220 },
  alerts: { colSpan: 2, minHeightPx: 260, x: 12, y: 896, widthPx: 260, heightPx: 320 },
  socialAuth: { colSpan: 4, minHeightPx: 260, x: 1036, y: 690, widthPx: 528, heightPx: 300 },
  cabinet: { colSpan: 4, minHeightPx: 360, x: 12, y: 1030, widthPx: 500, heightPx: 540 },
  account: { colSpan: 3, minHeightPx: 320, x: 926, y: 774, widthPx: 360, heightPx: 260 },
  activeTrades: { colSpan: 4, minHeightPx: 240, x: 414, y: 774, widthPx: 500, heightPx: 260 },
  riskCenter: { colSpan: 3, minHeightPx: 240, x: 1406, y: 716, widthPx: 380, heightPx: 320 },
  correlationHeatmap: { colSpan: 4, minHeightPx: 260, x: 12, y: 1360, widthPx: 500, heightPx: 320 },
  varPanel: { colSpan: 4, minHeightPx: 220, x: 524, y: 1360, widthPx: 380, heightPx: 260 },
  fundingBasis: { colSpan: 4, minHeightPx: 220, x: 12, y: 1710, widthPx: 500, heightPx: 280 },
  marketFlow: { colSpan: 4, minHeightPx: 260, x: 524, y: 1710, widthPx: 500, heightPx: 320 },
  chartPanel: { colSpan: 7, minHeightPx: 560, x: 414, y: 112, widthPx: 980, heightPx: 650 },
  decisionStack: { colSpan: 2, minHeightPx: 420, x: 1406, y: 112, widthPx: 260, heightPx: 360 },
  symbolDetailRail: { colSpan: 2, minHeightPx: 420, x: 1406, y: 484, widthPx: 260, heightPx: 430 },
  marketStory: { colSpan: 3, minHeightPx: 220, x: 1406, y: 926, widthPx: 380, heightPx: 220 },
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
  knowledgeWorkspace: {
    colSpan: 6,
    minHeightPx: 420,
    x: 924,
    y: 4310,
    widthPx: 640,
    heightPx: 620
  },
  pnlAttribution: { colSpan: 4, minHeightPx: 220, x: 1036, y: 1710, widthPx: 528, heightPx: 280 },
  watchlist: { colSpan: 3, minHeightPx: 180, x: 12, y: 664, widthPx: 390, heightPx: 220 },
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
  health: { colSpan: 3, minHeightPx: 220, x: 1298, y: 774, widthPx: 488, heightPx: 260 },
  replay: { colSpan: 6, minHeightPx: 420, x: 12, y: 4950, widthPx: 900, heightPx: 620 }
};

export const chartFirstDashboardPanelLayout: DashboardPanelLayout = {
  ...defaultDashboardPanelLayout,
  screener: { colSpan: 6, minHeightPx: 520, x: 12, y: 112, widthPx: 780, heightPx: 540 },
  watchlist: { colSpan: 3, minHeightPx: 180, x: 12, y: 664, widthPx: 390, heightPx: 220 },
  alerts: { colSpan: 2, minHeightPx: 260, x: 12, y: 896, widthPx: 260, heightPx: 320 },
  chartPanel: { colSpan: 6, minHeightPx: 560, x: 414, y: 112, widthPx: 610, heightPx: 760 },
  decisionStack: { colSpan: 2, minHeightPx: 300, x: 1036, y: 112, widthPx: 260, heightPx: 250 },
  symbolDetailRail: { colSpan: 2, minHeightPx: 340, x: 1036, y: 374, widthPx: 260, heightPx: 330 },
  marketStory: { colSpan: 3, minHeightPx: 200, x: 1036, y: 716, widthPx: 392, heightPx: 210 },
  marketFlow: { colSpan: 4, minHeightPx: 240, x: 414, y: 884, widthPx: 610, heightPx: 300 },
  fundingBasis: { colSpan: 3, minHeightPx: 220, x: 1036, y: 938, widthPx: 392, heightPx: 246 },
  riskCenter: { colSpan: 4, minHeightPx: 260, x: 12, y: 1232, widthPx: 650, heightPx: 320 },
  positionRiskOrchestrator: {
    colSpan: 5,
    minHeightPx: 300,
    x: 674,
    y: 1232,
    widthPx: 754,
    heightPx: 320
  },
  activeTrades: { colSpan: 5, minHeightPx: 240, x: 12, y: 1584, widthPx: 650, heightPx: 260 },
  account: { colSpan: 5, minHeightPx: 900, x: 674, y: 1584, widthPx: 754, heightPx: 1400 },
  health: { colSpan: 4, minHeightPx: 220, x: 12, y: 2860, widthPx: 650, heightPx: 260 },
  socialAuth: { colSpan: 4, minHeightPx: 260, x: 12, y: 4200, widthPx: 650, heightPx: 300 },
  cabinet: { colSpan: 4, minHeightPx: 360, x: 674, y: 4200, widthPx: 754, heightPx: 420 }
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
  screener: "Signal",
  account: "Execution Workspace",
  activeTrades: "Positions",
  riskCenter: "Risk Center",
  correlationHeatmap: "Correlation Heatmap",
  varPanel: "VaR",
  fundingBasis: "Funding/Basis",
  marketFlow: "Market Flow",
  chartPanel: "Signal Context",
  decisionStack: "Decision Pipeline",
  symbolDetailRail: "Why This Matters Now",
  marketStory: "Signal Story",
  signalIntelligence: "Signal Intelligence",
  metaRegimeGovernor: "Meta Regime Governor",
  positionRiskOrchestrator: "Position Risk",
  regimeMemory: "Regime Memory",
  regimePrediction: "Regime Prediction",
  regimeFeedbackCalibration: "Regime Feedback Calibration",
  pnlAttribution: "PnL Attribution",
  signalStatistics: "Review Statistics",
  learningCenter: "Research",
  tradeJournal: "Decision Review",
  knowledgeWorkspace: "Trader Knowledge",
  watchlist: "Watchlist",
  volumeMilestones: "100M Volume",
  volumeThresholdMilestones: "1-100M Volume",
  alerts: "Decision Inbox",
  frameTelemetry: "Frame Telemetry",
  renderTelemetry: "Render Telemetry",
  health: "Feed Health",
  replay: "Decision Replay"
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
    screener: "Signal",
    account: "Execution Workspace",
    activeTrades: "Positions",
    riskCenter: "Risk Center",
    correlationHeatmap: "Correlation Heatmap",
    varPanel: "VaR",
    fundingBasis: "Funding/Basis",
    marketFlow: "Market Flow",
    symbolDetailRail: "Symbol Detail Rail",
    signalIntelligence: "Signal Intelligence",
    metaRegimeGovernor: "Meta Regime Governor",
    positionRiskOrchestrator: "Position Risk",
    regimeMemory: "Regime Memory",
    regimePrediction: "Regime Prediction",
    regimeFeedbackCalibration: "Regime Feedback Calibration",
    pnlAttribution: "PnL Attribution",
    learningCenter: "Learning Center",
    tradeJournal: "Decision Review",
    knowledgeWorkspace: "Trader Knowledge",
    watchlist: "Р›РёСЃС‚ РЅР°Р±Р»СЋРґРµРЅРёСЏ",
    alerts: "Decision Inbox",
    health: "РЎРѕСЃС‚РѕСЏРЅРёРµ С„РёРґР°",
    replay: "Decision Replay"
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
  chartPanel: "chart-panel",
  decisionStack: "decision-stack",
  symbolDetailRail: "symbol-detail-rail",
  marketStory: "market-story",
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
  knowledgeWorkspace: "knowledge-workspace",
  watchlist: "watchlist",
  volumeMilestones: "volume-milestones",
  volumeThresholdMilestones: "volume-threshold-milestones",
  alerts: "alerts",
  frameTelemetry: "frame-telemetry",
  renderTelemetry: "render-telemetry",
  health: "health",
  replay: "replay"
};

export const isCollapsibleSectionId = (value: string): value is CollapsibleSectionId =>
  desktopModuleSections.includes(value as CollapsibleSectionId);

export const isDesktopManagedModuleSectionId = (
  value: string
): value is DesktopManagedModuleSectionId =>
  desktopManagedModuleSections.includes(value as DesktopManagedModuleSectionId);

export const isDashboardPanelId = (value: string): value is DashboardPanelId =>
  desktopDashboardPanels.includes(value as DashboardPanelId);

export interface WorkspacePresetWindowSectionIssue {
  presetId: WorkspacePresetId;
  section: string;
  reason: "unknown_desktop_module" | "not_electron_openable";
}

export const getWorkspacePresetWindowSectionIssues = (): WorkspacePresetWindowSectionIssue[] => {
  const issues: WorkspacePresetWindowSectionIssue[] = [];

  for (const presetId of workspacePresetIds) {
    const preset = workspacePresets[presetId];
    const windowSections = preset.windowSections ?? preset.visibleSections;

    for (const section of windowSections as readonly string[]) {
      if (!isCollapsibleSectionId(section)) {
        issues.push({ presetId, section, reason: "unknown_desktop_module" });
        continue;
      }

      if (!isDesktopManagedModuleSectionId(section)) {
        issues.push({ presetId, section, reason: "not_electron_openable" });
      }
    }
  }

  return issues;
};

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
