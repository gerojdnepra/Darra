export type Bias = "LONG" | "SHORT" | "NEUTRAL";
export type ActiveTradeSource = "none" | "manual" | "account" | "both";
export type AccountCredentialSource = "none" | "env" | "session";
export type ScreenerAlertKind = "tape" | "liquidation" | "reviving_coin" | "risk";
export type AlertPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "IGNORE";

export type SortKey =
  | "score"
  | "momentum30sPct"
  | "momentum2mPct"
  | "volumeImpulse"
  | "liquidation5m"
  | "quoteVolume24h";

export interface BackendSettings {
  focusUniverseSize: number;
  revivingCoins: RevivingCoinAlertSettings;
  volumeMilestones: VolumeMilestoneSettings;
}

export interface VolumeMilestoneSettings {
  enabled: boolean;
  minQuoteVolume24h: number;
}

export interface RevivingCoinAlertSettings {
  enabled: boolean;
  scanIntervalMinutes: number;
  minCurrentQuoteVolume24h: number;
  liquidityLookbackDays: number;
  maxAverageDailyQuoteVolume: number;
  noSignalLookbackDays: number;
  useAverageVolumeCriterion: boolean;
  useNoSignalCriterion: boolean;
  requireAllDeadCriteria: boolean;
  alertCooldownHours: number;
  soundEnabled: boolean;
  soundRepeatSeconds: number;
}

export interface DashboardSettings extends BackendSettings {
  minimumQuoteVolume: number;
  sortBy: SortKey;
  biasFilter: "ALL" | Bias;
  showOnlyWatchlist: boolean;
}

export type CollapsibleSectionId =
  | "overview"
  | "filters"
  | "screener"
  | "account"
  | "activeTrades"
  | "riskCenter"
  | "correlationHeatmap"
  | "varPanel"
  | "fundingBasis"
  | "marketFlow"
  | "signalIntelligence"
  | "metaRegimeGovernor"
  | "positionRiskOrchestrator"
  | "regimeMemory"
  | "regimePrediction"
  | "regimeFeedbackCalibration"
  | "pnlAttribution"
  | "signalStatistics"
  | "learningCenter"
  | "tradeJournal"
  | "watchlist"
  | "volumeMilestones"
  | "volumeThresholdMilestones"
  | "alerts"
  | "frameTelemetry"
  | "renderTelemetry"
  | "health";

export type DashboardPanelId = CollapsibleSectionId | "socialAuth" | "cabinet";
export type DashboardLayoutMode = "grid" | "free";
export interface DashboardPanelLayoutItem {
  colSpan?: number;
  minHeightPx?: number;
  x?: number;
  y?: number;
  widthPx?: number;
  heightPx?: number;
}
export type DashboardPanelLayout = Partial<Record<DashboardPanelId, DashboardPanelLayoutItem>>;

export type CollapsedSectionsState = Record<CollapsibleSectionId, boolean>;
export type SectionVisibilityState = Record<CollapsibleSectionId, boolean>;

export interface NotificationPreferences {
  tradeSignals: boolean;
  liquidationSignals: boolean;
  systemStatus: boolean;
  pulseChanges: boolean;
}

export type InterfaceLanguage = "en" | "ru";
export type SignalSoundId = "classic-chime" | "radar-ping" | "market-sweep";
export type SpeechProviderId = "system" | "edge";

export interface SignalBillboardPreferences {
  topBandSize: number;
  bottomBandSize: number;
  frameHeightPercent: number;
  topBandOpacity: number;
  bottomBandOpacity: number;
}

export type VoiceProfileId =
  | "default"
  | "russian"
  | "analyst"
  | "builder"
  | "announcer"
  | "engineer";
export type LegacyVoiceProfileId = "satoshi" | "vitalik" | "trump" | "elon";

export interface UiPreferences {
  interfaceLanguage: InterfaceLanguage;
  soundEnabled: boolean;
  signalAnimationEnabled: boolean;
  signalSoundEnabled: boolean;
  signalBillboard: SignalBillboardPreferences;
  selectedSignalSoundId: SignalSoundId;
  voiceAlertsEnabled?: boolean;
  speechProvider?: SpeechProviderId;
  voiceProfile: VoiceProfileId;
  selectedSpeechVoiceUri?: string | null;
  selectedTtsModelId?: string | null;
  notifications: NotificationPreferences;
  collapsedSections: CollapsedSectionsState;
  visibleSections: SectionVisibilityState;
  dashboardLayoutMode: DashboardLayoutMode;
  dashboardLayoutModePinned?: boolean;
  dashboardPanelOrder: DashboardPanelId[];
  dashboardPanelLayout: DashboardPanelLayout;
}

export interface CabinetProfile {
  id: string;
  profileName: string;
  binanceHandle: string;
  loginMethod: "binance-qr";
  qrSeed: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number;
}

export interface CabinetSession {
  mode: "guest" | "authenticated";
  profileId: string | null;
}

export interface CabinetProfileRecord {
  profile: CabinetProfile;
  state: PersistedState;
}

export interface ScreenerAlert {
  id: string;
  symbol: string;
  kind?: ScreenerAlertKind;
  baseAsset?: string;
  bias: Bias;
  reason: string;
  severity: "info" | "high" | "critical";
  notionalUsd: number;
  quoteVolume24h?: number;
  averageDailyQuoteVolume?: number | null;
  volumeChangePct?: number | null;
  alertPriority?: AlertPriority | string | null;
  alertRankScore?: number | null;
  alertSuppress?: boolean | null;
  createdAt: number;
}

export interface VolumeMilestoneEvent {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  direction: "above" | "below";
  quoteVolume24h: number;
  thresholdQuoteVolume24h: number;
  change24hPct: number;
  lastPrice: number;
  detectedAt: number;
}

export interface ScreenerRow {
  symbol: string;
  baseAsset: string;
  lastPrice: number;
  markPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  bestBidQty: number | null;
  bestAskQty: number | null;
  change24hPct: number;
  quoteVolume24h: number;
  volume24h: number;
  momentum30sPct: number;
  momentum2mPct: number;
  buyRatio60s: number;
  tradeNotional5s: number;
  tradeNotional60s: number;
  volumeImpulse: number;
  spreadBps: number | null;
  orderBookImbalance: number | null;
  fundingRate: number;
  liquidation5m: number;
  liquidationBias: "LONGS_HIT" | "SHORTS_HIT" | "BALANCED";
  score: number;
  bias: Bias;
  riskScore: number;
  riskLevel: RiskLevel;
  risk: RiskSymbolPayload;
  tags: string[];
  isFocus: boolean;
  isWatchlist: boolean;
  isActiveTrade: boolean;
  activeTradeSource: ActiveTradeSource;
  updatedAt: number;
}

export type FundingSortMode = "highest" | "lowest" | "basis";

export interface FundingSymbolState {
  symbol: string;
  fundingRate: number;
  annualizedFunding: number;
  basisPct: number;
  premiumPct: number;
  markPrice: number;
  indexPrice: number;
}

export interface FundingSortedViews {
  highest: FundingSymbolState[];
  lowest: FundingSymbolState[];
  basis: FundingSymbolState[];
}

export type CvdDivergence = "bullish" | "bearish" | "none";

export interface MarketFlowState {
  symbol: string;
  openInterest: {
    currentOI: number;
    oiChange5m: number;
    oiChange15m: number;
    oiChange1h: number;
  };
  cvd: {
    value: number;
    slope: number;
    divergence: CvdDivergence;
  };
}

export type PositionRiskStressLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
export type PositionRiskKillSwitchState =
  | "NORMAL"
  | "CAUTION"
  | "STOP_ADDING"
  | "REDUCE_RISK"
  | "EMERGENCY";

export interface MarginStressState {
  marginUsagePct: number;
  maintenanceMarginRatio: number;
  availableBalancePct: number;
  stressLevel: PositionRiskStressLevel;
}

export interface LiquidationStressState {
  minDistancePct: number | null;
  avgDistancePct: number | null;
  criticalPositions: number;
  warningPositions: number;
  stressLevel: PositionRiskStressLevel;
}

export interface PositionCapacityState {
  symbol: string;
  bias: Bias;
  capacityScore: number;
  recommendedSizeMultiplier: number;
  safeToAdd: boolean;
  reason: string;
  constraints: {
    accountRisk: number;
    marginStress: number;
    liquidationStress: number;
    conflictPenalty: number;
    governorPenalty: number;
  };
}

export interface PositionRiskOrchestratorState {
  accountRiskLoad: number;
  riskBudgetLeft: number;
  marginStress: MarginStressState;
  liquidationStress: LiquidationStressState;
  killSwitchState: PositionRiskKillSwitchState;
  safeToAddPosition: boolean;
  globalRiskMultiplier: number;
  positionCapacity: PositionCapacityState[];
}

export type LiquidationHeat = "low" | "medium" | "high" | "extreme";

export interface LiquidationState {
  symbol: string;
  liquidations1m: number;
  liquidations5m: number;
  liquidations15m: number;
  liquidations1h: number;
  longLiquidations: number;
  shortLiquidations: number;
}

export interface LiquidationHeatEntry {
  symbol: string;
  heat: LiquidationHeat;
  value: number;
}

export interface LiquidationsDashboardPayload {
  bySymbol: Record<string, LiquidationState>;
  topLiquidationSymbols: string[];
  heatRanking: LiquidationHeatEntry[];
}

export interface PortfolioVarState {
  windowDays: number;
  sampleSize: number;
  var95: number | null;
  var99: number | null;
}

export interface PortfolioExpectedShortfallState {
  windowDays: number;
  sampleSize: number;
  es95: number | null;
  es99: number | null;
}

export interface PortfolioCorrelationHeatmapPair {
  symbolA: string;
  symbolB: string;
  correlation: number;
  intensity: number;
}

export interface PortfolioCorrelationState {
  symbols: string[];
  sampleSize: number;
  correlationMatrix: Record<string, Record<string, number>>;
  correlationHeatmap: {
    pairs: PortfolioCorrelationHeatmapPair[];
  };
}

export interface PortfolioPnlState {
  realized: number;
  unrealized: number;
  funding: number;
  fees: number;
  net: number;
}

export interface PortfolioAnalyticsGroupState {
  symbols: string[];
  var: PortfolioVarState;
  expectedShortfall: PortfolioExpectedShortfallState;
  correlation: PortfolioCorrelationState;
  pnl: PortfolioPnlState;
  updatedAt: number;
}

export interface PortfolioAnalyticsState {
  updatedAt: number;
  bySymbol: Record<string, PortfolioAnalyticsGroupState>;
  byStrategy: Record<string, PortfolioAnalyticsGroupState>;
  byPortfolio: Record<string, PortfolioAnalyticsGroupState>;
}

export interface RegimeComponents {
  riskScore: number;
  fundingScore: number;
  flowScore: number;
  liquidationScore: number;
}

export interface RegimeState {
  symbol: string;
  bias: "LONG" | "SHORT" | "NEUTRAL";
  finalScore: number;
  confidence: number;
  components: RegimeComponents;
}

export interface RegimeLearningState {
  symbol: string;
  accuracy: number;
  directionalAccuracy: {
    long: number;
    short: number;
  };
  stability: number;
  expectancy: number;
  confidence: number;
}

export interface RegimeLearningPayload {
  symbols: RegimeLearningState[];
  adaptiveWeights: {
    risk: number;
    funding: number;
    flow: number;
    liquidations: number;
  };
}

export type ExecutionTier = "A_TIER" | "B_TIER" | "IGNORE";

export interface ExecutionState {
  symbol: string;
  bias: "LONG" | "SHORT" | "NEUTRAL";
  executionScore: number;
  priorityScore: number;
  tier: ExecutionTier;
  suggestedSizeMultiplier: number;
  reasoning: {
    regimeWeight: number;
    learningWeight: number;
    expectancyWeight: number;
  };
}

export interface ConflictState {
  symbol: string;
  conflictIndex: number;
  consensusScore: number;
  alignmentScore: number;
  signalAgreement: {
    risk: number;
    funding: number;
    flow: number;
    liquidation: number;
    regime: number;
  };
  adjustedConfidence: number;
}

export type AllocationTier = "A" | "B" | "C";

export interface AllocationState {
  symbol: string;
  allocationScore: number;
  weight: number;
  suggestedSize: number;
  tier: AllocationTier;
  reasoning: {
    execution: number;
    confidence: number;
    expectancy: number;
    consensus: number;
  };
}

export type MarketState = "STABLE_TREND" | "TRANSITIONAL" | "CHOP" | "DISORDER";

export interface SignalIntelligenceState {
  symbol: string;
  ssi: number;
  mrs: number;
  sdp: number;
  shs: number;
  marketState: MarketState;
  adjustedSystemConfidence: number;
}

export type TradePermission = "ALLOWED" | "REDUCED" | "BLOCKED";
export type MarketMode = "NORMAL" | "RISK_OFF" | "DEGRADED" | "EXTREME_UNCERTAINTY";
export type OverrideState = "NONE" | "FORCED_NEUTRAL";

export interface MetaRegimeGovernorExecutionOverlay {
  symbol: string;
  bias: Bias;
  tier: ExecutionTier;
  executionScore: number;
  dampenedExecutionScore: number;
  suggestedSizeMultiplier: number;
  dampenedSuggestedSizeMultiplier: number;
}

export interface MetaRegimeGovernorAllocationOverlay {
  symbol: string;
  tier: AllocationTier;
  weight: number;
  dampenedWeight: number;
  suggestedSize: number;
  dampenedSuggestedSize: number;
}

export interface MetaRegimeGovernorDiagnostics {
  leadRegimeBias: Bias;
  effectiveRegimeBias: Bias;
  signalHealthScore: number;
  signalDecayPressure: number;
  regimeConfidence: number;
  regimeLearningAccuracy: number;
  regimeLearningStability: number;
  executionScore: number;
  conflictIndex: number;
  allocationConcentration: number;
  riskStress: number;
  fundingPressure: number;
  fundingExtremeRatio: number;
  marketFlowInstability: number;
  liquidationStress: number;
}

export interface MetaRegimeGovernorState {
  generatedAt: number;
  sts: number;
  tradePermission: TradePermission;
  marketMode: MarketMode;
  overrideMode: OverrideState;
  systemDampener: number;
  overlayMultiplier: number;
  diagnostics: MetaRegimeGovernorDiagnostics;
  overlays: {
    execution: MetaRegimeGovernorExecutionOverlay[];
    allocation: MetaRegimeGovernorAllocationOverlay[];
  };
}

export type ContinuityState = "ECHOING" | "STABLE_LOOP" | "DRIFTING" | "UNSTRUCTURED";
export type RegimeFingerprint = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
];

export interface RegimeEcho {
  timestamp: number;
  similarity: number;
  marketState: MarketState;
}

export interface RegimeMemorySymbolState {
  symbol: string;
  marketState: MarketState;
  continuityState: ContinuityState;
  rrs: number;
  rdi: number;
  memoryConfidence: number;
  learningConfidence: number;
  fingerprint: RegimeFingerprint;
  regimeEchoes: RegimeEcho[];
}

export interface RegimeMemoryState {
  generatedAt: number;
  symbol: string | null;
  marketState: MarketState | null;
  continuityState: ContinuityState;
  rrs: number;
  rdi: number;
  memoryConfidence: number;
  tradePermission: TradePermission;
  marketMode: MarketMode;
  topRegimeEchoes: RegimeEcho[];
  symbols: RegimeMemorySymbolState[];
}

export type ForecastBias = "LONG_BIASED" | "SHORT_BIASED" | "NEUTRAL";
export type StabilityHorizonBucket = "LOW" | "MODERATE" | "STABLE";

export interface StabilityHorizon {
  candles: number;
  bucket: StabilityHorizonBucket;
}

export interface RegimeTransitionProbabilities {
  STABLE_TREND: number;
  TRANSITIONAL: number;
  CHOP: number;
  DISORDER: number;
}

export interface RegimePredictionState {
  generatedAt: number;
  symbol: string | null;
  currentRegime: MarketState | null;
  predictedRegime: MarketState;
  transitionProbabilities: RegimeTransitionProbabilities;
  rtr: number;
  stabilityHorizon: StabilityHorizon;
  forecastBias: ForecastBias;
  predictionConfidence: number;
}

export type RealizedBias = "LONG" | "SHORT" | "NEUTRAL";

export interface PredictionMetrics {
  "5m": number;
  "15m": number;
  "1h": number;
}

export interface CalibrationAdjustment {
  regimeWeightAdjustment: number;
  confidenceAdjustment: number;
  flowWeightBias: number;
  riskPenaltyAdjustment: number;
}

export interface RegimeFeedbackCalibrationState {
  generatedAt: number;
  symbol: string | null;
  phr: PredictionMetrics;
  directionalAccuracy: PredictionMetrics;
  stabilityScore: number;
  calibrationError: number;
  realizedBiasDistribution: Record<RealizedBias, number>;
  calibrationAdjustment: CalibrationAdjustment;
}

export interface ScreenerOverview {
  advancingCount: number;
  decliningCount: number;
  focusSymbols: number;
  trackedSymbols: number;
  hotLiquidationsUsd: number;
  topLongSymbol: string | null;
  topShortSymbol: string | null;
  dominantRegime: "risk-on" | "risk-off" | "balanced";
  marketPulse: number;
}

export interface ConnectionHealth {
  connected: boolean;
  url: string;
  lastMessageAt: number | null;
  reconnectAttempts: number;
}

export interface AccountStreamStatus extends ConnectionHealth {
  enabled: boolean;
  credentialSource: AccountCredentialSource;
  keyLabel: string | null;
  message: string;
  error: string | null;
  activePositions: string[];
  lastSyncAt: number | null;
}

export type PayloadBudgetState = "SAFE" | "WARNING" | "CRITICAL";
export type PerformanceState = "HEALTHY" | "STRESSED" | "DEGRADED";

export interface FrameSectionSize {
  section: string;
  bytes: number;
  kb: number;
}

export interface PersistenceQueueTelemetry {
  queueSize: number;
  queueCapacity: number;
  queueUsageRatio: number;
  droppedEventsCount: number;
  lastDroppedEventAt: number | null;
  lastFlushAt: number | null;
  flushErrorsCount: number;
  lastFlushErrorMessage: string | null;
  lastFlushErrorAt: number | null;
}

export interface FrameTelemetryState {
  frameSizeBytes: number;
  frameSizeKb: number;
  fullFrameSizeBytes: number;
  fullFrameSizeKb: number;
  suppressedFrameSizeBytes: number;
  suppressedFrameSizeKb: number;
  savedBytes: number;
  savedKb: number;
  suppressionRatio: number;
  deltaEnabled: boolean;
  snapshotFramesSent: number;
  patchFramesSent: number;
  averagePatchSizeKb: number;
  savedByDeltaKb: number;
  deltaRatio: number;
  payloadBudgetState: PayloadBudgetState;
  performanceState: PerformanceState;
  clientsConnected: number;
  sendIntervalMs: number;
  averageFrameSizeKb: number;
  largestFrameObservedKb: number;
  persistenceQueue: PersistenceQueueTelemetry;
  sectionSizes: FrameSectionSize[];
  largestSections: FrameSectionSize[];
}

export interface ScreenerFrame {
  type: "frame";
  generatedAt: number;
  settings: BackendSettings;
  status: {
    phase: "booting" | "live" | "degraded";
    message: string;
    universeSize: number;
    focusSymbols: string[];
    marketStream: ConnectionHealth;
    publicStream: ConnectionHealth;
    accountStream: AccountStreamStatus;
  };
  overview: ScreenerOverview;
  risk?: RiskState;
  funding?: FundingSymbolState[];
  fundingSorted?: FundingSortedViews;
  marketFlow?: MarketFlowState[];
  liquidations?: LiquidationsDashboardPayload;
  portfolioAnalytics?: PortfolioAnalyticsState;
  regime?: RegimeState[];
  regimeLearning?: RegimeLearningPayload;
  execution?: ExecutionState[];
  conflict?: ConflictState[];
  allocation?: AllocationState[];
  signalIntelligence?: SignalIntelligenceState[];
  metaRegimeGovernor?: MetaRegimeGovernorState;
  positionRiskOrchestrator?: PositionRiskOrchestratorState;
  regimeMemory?: RegimeMemoryState;
  regimePrediction?: RegimePredictionState;
  regimeFeedbackCalibration?: RegimeFeedbackCalibrationState;
  frameTelemetry?: FrameTelemetryState;
  rows?: ScreenerRow[];
  alerts?: ScreenerAlert[];
  volumeMilestones?: VolumeMilestoneEvent[];
  volumeThresholdMilestones?: VolumeMilestoneEvent[];
}

export interface WelcomeMessage {
  type: "welcome";
  message: string;
  generatedAt: number;
}

export interface PongMessage {
  type: "pong";
  sentAt: number;
  receivedAt: number;
}

export type RiskEngineMode = "live";
export type RiskEngineStatus = "disabled" | "syncing" | "live" | "stale";
export type RiskUpdateReason = "bootstrap" | "sync";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type FlowDirectionalBias = "LONG" | "SHORT" | "NEUTRAL";
export type PositionLiquidationRiskLevel = "critical" | "warning" | "safe";
export type RiskAlertCode =
  | "var_breach"
  | "liquidation_distance"
  | "correlation_spike"
  | "funding_extreme"
  | "flow_divergence";

export interface RiskMetricValue {
  value: number | null;
  updatedAt: number | null;
}

export interface RiskLimitValue {
  enabled: boolean;
  value: number | null;
}

export interface RiskAlertEntry {
  id: string;
  code: RiskAlertCode;
  severity: "info" | "high" | "critical";
  message: string;
  symbol: string | null;
  value: number | null;
  createdAt: number;
}

export interface RiskLiquidationDistancePayload {
  distanceToLongPct: number | null;
  distanceToShortPct: number | null;
  nearestDistancePct: number | null;
  liquidationPressureIndex: number;
  marginBufferUtilization: number | null;
}

export interface RiskVarPayload {
  var95_5m: number | null;
  var99_5m: number | null;
  var95_1h: number | null;
  var99_1h: number | null;
  volatility5m: number | null;
  volatility1h: number | null;
  sampleSize5m: number;
  sampleSize1h: number;
}

export interface RiskCorrelationValue {
  symbol: string;
  correlation: number;
}

export interface RiskCorrelationRowPayload {
  strongestPositive: RiskCorrelationValue[];
  strongestNegative: RiskCorrelationValue[];
}

export interface RiskFundingPayload {
  fundingRate: number;
  basisUsd: number;
  basisPct: number;
  annualizedFundingPressureScore: number;
}

export interface RiskFlowPayload {
  openInterestUsd: number | null;
  openInterestDelta5mUsd: number | null;
  openInterestDelta1hUsd: number | null;
  cvd5mUsd: number;
  cvd1hUsd: number;
  liquidationNet5mUsd: number;
  liquidationNet1hUsd: number;
  flowPressureScore: number;
  directionalBias: FlowDirectionalBias;
}

export interface RiskPnlAttributionPayload {
  momentumContribution: number;
  flowContribution: number;
  fundingCarry: number;
  residual: number;
  total: number;
}

export interface RiskSymbolPayload {
  liquidationDistance: RiskLiquidationDistancePayload;
  var: RiskVarPayload;
  correlationRow: RiskCorrelationRowPayload;
  funding: RiskFundingPayload;
  flow: RiskFlowPayload;
  pnlAttribution: RiskPnlAttributionPayload;
}

export interface RiskCorrelationCluster {
  symbols: string[];
  averageCorrelation: number;
}

export interface RiskHeatmapCell {
  x: number;
  y: number;
  value: number;
}

export interface RiskState {
  generatedAt: number;
  status: RiskEngineStatus;
  mode: RiskEngineMode;
  account: {
    enabled: boolean;
    connected: boolean;
    credentialSource: "none" | "env" | "session";
    balanceAsset: string;
    lastSyncAt: number | null;
    positionCount: number;
    longCount: number;
    shortCount: number;
  };
  summary: {
    grossExposureUsd: RiskMetricValue;
    netExposureUsd: RiskMetricValue;
    longExposureUsd: RiskMetricValue;
    shortExposureUsd: RiskMetricValue;
    largestPositionUsd: RiskMetricValue;
    concentrationPct: RiskMetricValue;
    walletBalanceUsd: RiskMetricValue;
    availableBalanceUsd: RiskMetricValue;
    marginBalanceUsd: RiskMetricValue;
    unrealizedPnlUsd: RiskMetricValue;
    openRiskUsd: RiskMetricValue;
    marginUsagePct: RiskMetricValue;
  };
  limits: {
    maxPositionUsd: RiskLimitValue;
    maxLossPerTradeUsd: RiskLimitValue;
    maxDailyLossUsd: RiskLimitValue;
  };
  positions: Array<{
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    entryPrice: number;
    markPrice: number;
    notionalUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number | null;
    liquidationPrice: number | null;
    distancePct: number | null;
    distanceToLiquidationPct: number | null;
    initialMarginUsd: number;
    maintMarginUsd: number;
    openOrderMarginUsd: number;
    isolatedWalletUsd: number;
    quoteVolume24h: number | null;
    change24hPct: number | null;
    score: number | null;
    bias: "LONG" | "SHORT" | "NEUTRAL" | null;
    riskScore: number;
    portfolioRiskLevel: RiskLevel;
    riskLevel: PositionLiquidationRiskLevel;
    risk: RiskSymbolPayload;
    updatedAt: number;
  }>;
  topRiskSymbols: Array<{
    symbol: string;
    riskScore: number;
    riskLevel: RiskLevel;
  }>;
  riskScore: number;
  riskLevel: RiskLevel;
  liquidationDistance: {
    averageNearestDistancePct: number | null;
    averagePressureIndex: number;
    averageMarginBufferUtilization: number | null;
    criticalSymbols: string[];
  };
  var: {
    method: "positions" | "focus_proxy";
    var95_5mUsd: number | null;
    var99_5mUsd: number | null;
    var95_1hUsd: number | null;
    var99_1hUsd: number | null;
    volatilityProxy: number | null;
    sampleSize: number;
    breach: boolean;
  };
  correlation: {
    symbols: string[];
    matrix: number[][];
    heatmap: RiskHeatmapCell[];
    maxAbsCorrelation: number;
    clusters: RiskCorrelationCluster[];
  };
  funding: {
    averageFundingRate: number;
    averageBasisPct: number;
    annualizedPressureScore: number;
    extremeSymbols: string[];
  };
  flow: {
    aggregatePressureScore: number;
    directionalBias: FlowDirectionalBias;
    totalOpenInterestDelta5mUsd: number;
    totalOpenInterestDelta1hUsd: number;
    totalCvd5mUsd: number;
    totalCvd1hUsd: number;
    totalLiquidationNet5mUsd: number;
    totalLiquidationNet1hUsd: number;
    leaders: Array<{
      symbol: string;
      flowPressureScore: number;
      directionalBias: FlowDirectionalBias;
    }>;
  };
  pnlAttribution: {
    momentumContribution: number;
    flowContribution: number;
    fundingCarry: number;
    residual: number;
    total: number;
  };
  alerts: RiskAlertEntry[];
}

export interface RiskSnapshotPayload {
  version: number;
  state: RiskState;
}

export interface RiskUpdatePayload {
  version: number;
  reason: RiskUpdateReason;
  state: RiskState;
}

export interface RiskSnapshotMessage {
  type: "risk_snapshot";
  generatedAt: number;
  payload: RiskSnapshotPayload;
}

export interface RiskUpdateMessage {
  type: "risk_update";
  generatedAt: number;
  payload: RiskUpdatePayload;
}

export interface SignalStatisticsBucket {
  key: string;
  total_signals: number;
  total_outcomes: number;
  confidence?: "low" | "normal";
  avg_favorable_pct: number;
  avg_adverse_pct: number;
  avg_end_move_pct: number;
  win_rate_pct: number;
  best_move_pct: number;
  worst_move_pct: number;
}

export interface SignalStatisticsRecentOutcome {
  signalId: string;
  symbol: string;
  type: string;
  setupType: string | null;
  opportunityVerdict: string | null;
  doNotTradeAllowed?: boolean | null;
  doNotTradeSeverity?: string | null;
  doNotTradeAction?: string | null;
  alertPriority?: AlertPriority | string | null;
  alertRankScore?: number | null;
  alertSuppress?: boolean | null;
  source: string | null;
  severity: string | null;
  signalCreatedAt: number;
  outcomeCreatedAt: number;
  horizonSec: number;
  direction: "long" | "short" | "unknown";
  startPrice: number | null;
  endPrice: number | null;
  endMovePct: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  recommendedNotional: number | null;
  recommendedQty: number | null;
  normalizedQty: number | null;
  rawQty: number | null;
  suggestedLeverage: number | null;
  riskPerTradePct: number | null;
  stopDistancePct: number | null;
  win: boolean;
}

export interface SignalStatisticsPayload {
  summary: SignalStatisticsBucket;
  byType: SignalStatisticsBucket[];
  bySetupType: SignalStatisticsBucket[];
  byOpportunityVerdict: SignalStatisticsBucket[];
  byDoNotTradeAction?: SignalStatisticsBucket[];
  byDoNotTradeSeverity?: SignalStatisticsBucket[];
  byAlertPriority?: SignalStatisticsBucket[];
  bySymbol: SignalStatisticsBucket[];
  bySource: SignalStatisticsBucket[];
  recentOutcomes: SignalStatisticsRecentOutcome[];
}

export interface JournalAnalyticsBucket {
  key: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  total_pnl: number;
  avg_pnl: number;
  best_trade_pnl: number;
  worst_trade_pnl: number;
  avg_size: number;
  long_trades: number;
  short_trades: number;
}

export interface JournalAnalyticsPayload {
  summary: JournalAnalyticsBucket;
  bySetupType: JournalAnalyticsBucket[];
  byOpportunityVerdict: JournalAnalyticsBucket[];
  bySymbol: JournalAnalyticsBucket[];
  bySide: JournalAnalyticsBucket[];
}

export interface LearningPerformanceBucket {
  key: string;
  total_signals: number;
  total_outcomes: number;
  win_rate: number;
  avg_move: number;
  avg_favorable: number;
  avg_adverse: number;
  avg_pnl: number;
  confidence_score: number;
}

export interface LearningReportPayload {
  generatedAt: number;
  filters: {
    sinceMs: number | null;
    horizonSec: number | null;
    limit: number;
  };
  setupPerformance: LearningPerformanceBucket[];
  opportunityPerformance: LearningPerformanceBucket[];
  alertPriorityPerformance: LearningPerformanceBucket[];
  symbolPerformance: LearningPerformanceBucket[];
  directionPerformance: LearningPerformanceBucket[];
  recommendations: {
    preferredSetups: string[];
    weakSetups: string[];
    setupsToAvoid: string[];
    symbolsToAvoid: string[];
    symbolsPerformingBest: string[];
  };
  insights: {
    bestSetup: string | null;
    bestOpportunityVerdict: string | null;
    bestAlertPriority: string | null;
    overestimatedVerdicts: string[];
    uselessAlertPriorities: string[];
  };
}

export interface SignalRecord {
  id: string;
  symbol: string;
  createdAt: number;
  type: string;
  severity: string | null;
  source: string | null;
  price: number | null;
  score: number | null;
  setupType: string | null;
  setupConfidence: number | null;
  setupDirection: string | null;
  opportunityVerdict: string | null;
  opportunityScore: number | null;
  opportunityConfidence: number | null;
  opportunityRiskLevel: string | null;
  dntAllowed?: boolean | null;
  dntSeverity?: string | null;
  dntAction?: string | null;
  alertPriority?: AlertPriority | string | null;
  alertRankScore?: number | null;
  alertSuppress?: boolean | null;
  recommendedNotional: number | null;
  recommendedQty: number | null;
  normalizedQty: number | null;
  rawQty: number | null;
  suggestedLeverage: number | null;
  riskPerTradePct: number | null;
  stopDistancePct: number | null;
  payload: unknown;
}

export interface SignalOutcomeRecord {
  id: string;
  signalId: string;
  createdAt: number;
  horizonSec: number;
  startPrice: number | null;
  endPrice: number | null;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
  outcome: unknown;
}

export interface SignalReplayTimelineEntry {
  label: "T0" | "+1m" | "+5m" | "+15m" | "+1h";
  timestamp: number | null;
  horizonSec: number | null;
  type: "signal" | "outcome";
  outcome: SignalOutcomeRecord | null;
}

export interface SignalReplayPayload {
  signalId: string;
  signal: SignalRecord;
  features: unknown;
  outcomes: SignalOutcomeRecord[];
  setupClassification: unknown;
  opportunityScore: unknown;
  positionSizing: unknown;
  doNotTrade?: unknown;
  alertRanking?: unknown;
  timeline: SignalReplayTimelineEntry[];
}

export type JournalEntrySide = "long" | "short";

export interface JournalEntryRecord {
  id: string;
  signalId: string | null;
  symbol: string;
  createdAt: number;
  side: JournalEntrySide | null;
  entryPrice: number | null;
  exitPrice: number | null;
  size: number | null;
  pnl: number | null;
  notes: string | null;
  tags: string[];
}

export interface CreateJournalEntryInput {
  signalId?: string | null;
  symbol: string;
  side?: JournalEntrySide | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  size?: number | null;
  pnl?: number | null;
  notes?: string | null;
  tags?: string[];
}

export interface UpdateJournalEntryPatch {
  signalId?: string | null;
  symbol?: string;
  side?: JournalEntrySide | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  size?: number | null;
  pnl?: number | null;
  notes?: string | null;
  tags?: string[];
}

export interface JournalEntryFilters {
  symbol?: string;
  side?: JournalEntrySide | "all";
  sinceMs?: number;
  limit?: number;
}

export interface JournalAnalyticsFilters extends JournalEntryFilters {
  setupType?: string;
  opportunityVerdict?: string;
}

export interface SignalStatisticsMessage {
  type: "signal_statistics";
  generatedAt: number;
  payload: SignalStatisticsPayload;
}

export interface SignalReplayMessage {
  type: "signal_replay";
  generatedAt: number;
  payload: SignalReplayPayload | null;
  error?: string;
}

export interface JournalEntriesMessage {
  type: "journal_entries";
  generatedAt: number;
  payload: JournalEntryRecord[];
}

export interface JournalAnalyticsMessage {
  type: "journal_analytics";
  generatedAt: number;
  payload: JournalAnalyticsPayload;
}

export interface LearningReportMessage {
  type: "learning_report";
  generatedAt: number;
  payload: LearningReportPayload;
}

export interface JournalErrorMessage {
  type: "journal_error";
  generatedAt: number;
  error: string;
}

export interface JournalAutoEventMessage {
  type: "journal_auto_event";
  generatedAt: number;
  payload: {
    event: "created" | "updated" | "closed";
    journalEntry: JournalEntryRecord;
  };
}

export interface PositionSizingResult {
  symbol: string;
  direction: "long" | "short" | "unknown";
  recommendedNotional: number;
  maxNotional: number;
  recommendedQty: number;
  rawQty: number;
  normalizedQty: number;
  minQty: number | null;
  stepSize: number | null;
  minNotional: number | null;
  suggestedLeverage: number;
  riskPerTradePct: number;
  stopDistancePct: number;
  liquidationBufferPct: number | null;
  confidence: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  reasons: string[];
  warnings: string[];
  exchangeFilterWarnings: string[];
  constraints: string[];
  doNotTrade?: DoNotTradeResult | null;
}

export interface DoNotTradeResult {
  allowed: boolean;
  severity: "OK" | "CAUTION" | "BLOCKED" | "EMERGENCY";
  action: "ALLOW" | "REDUCE_SIZE" | "WAIT" | "BLOCK";
  reasons: string[];
  blockers: string[];
  warnings: string[];
  cooldownSec: number;
  tags: string[];
}

export interface PositionSizingMessage {
  type: "position_sizing";
  generatedAt: number;
  payload: PositionSizingResult;
}

export interface SignalStatisticsFilters {
  horizonSec?: number;
  sinceMs?: number;
  limit?: number;
  doNotTradeAction?: string;
  doNotTradeSeverity?: string;
  alertPriority?: AlertPriority | string;
}

export interface LearningReportFilters {
  horizonSec?: number;
  sinceMs?: number;
  limit?: number;
}

export interface RequestSignalStatisticsMessage {
  type: "request_signal_statistics";
  filters: SignalStatisticsFilters;
}

export interface RequestLearningReportMessage {
  type: "request_learning_report";
  filters?: LearningReportFilters;
}

export type ServerMessage =
  | WelcomeMessage
  | PongMessage
  | ScreenerFrame
  | FrameSnapshotMessage
  | FramePatchMessage
  | RiskSnapshotMessage
  | RiskUpdateMessage
  | SignalStatisticsMessage
  | SignalReplayMessage
  | JournalEntriesMessage
  | JournalAnalyticsMessage
  | LearningReportMessage
  | JournalErrorMessage
  | JournalAutoEventMessage
  | PositionSizingMessage;

export interface FrameSnapshotMessage {
  type: "snapshot";
  frame: ScreenerFrame;
}

export interface FramePatchMessage {
  type: "frame_patch";
  changed: Partial<ScreenerFrame>;
}

export interface VisibleSectionsMessage {
  type: "visible_sections";
  sections: string[];
}

export interface PersistedState {
  backendWsUrl?: string;
  settings: DashboardSettings;
  watchlist: string[];
  activeTrades?: string[];
  uiPreferences?: UiPreferences;
  profileNotes?: string;
}
