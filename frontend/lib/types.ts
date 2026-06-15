export type Bias = "LONG" | "SHORT" | "NEUTRAL";
export type ActiveTradeSource = "none" | "manual" | "account" | "both";
export type AccountCredentialSource = "none" | "env" | "session";
export type ScreenerAlertKind = "tape" | "liquidation" | "reviving_coin" | "risk";
export type AlertPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "IGNORE";
export type ScreenerAlertLiveVisibility = "PRIMARY" | "REVIEW" | "HIDDEN";
export type ScreenerAlertNoiseClass = "ACTIONABLE" | "CONTEXT" | "NOISE";
export type SignalVolatilityClass = "LOW" | "MID" | "HIGH";
export type SignalDecayRate = "FAST" | "MEDIUM" | "SLOW";
export type MarketRegime = "TREND" | "CHOP" | "LIQUIDATION_SPIKE" | "BREAKOUT";
export type DecisionStrength = "WEAK" | "NORMAL" | "STRONG";

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
  | "chartPanel"
  | "decisionStack"
  | "symbolDetailRail"
  | "marketStory"
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
  | "knowledgeWorkspace"
  | "watchlist"
  | "volumeMilestones"
  | "volumeThresholdMilestones"
  | "alerts"
  | "frameTelemetry"
  | "renderTelemetry"
  | "health"
  | "replay";

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

type OptionalMigratedSectionId = "knowledgeWorkspace";
type RequiredCollapsibleSectionId = Exclude<CollapsibleSectionId, OptionalMigratedSectionId>;

export type CollapsedSectionsState = Record<RequiredCollapsibleSectionId, boolean> &
  Partial<Record<OptionalMigratedSectionId, boolean>>;
export type SectionVisibilityState = Record<RequiredCollapsibleSectionId, boolean> &
  Partial<Record<OptionalMigratedSectionId, boolean>>;

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
  learningMode: boolean;
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
  rankScore?: number;
  suppress?: boolean;
  suppressReason?: string;
  confidenceScore?: number;
  signalStabilityScore?: number;
  signalVolatilityClass?: SignalVolatilityClass;
  signalDecayRate?: SignalDecayRate;
  marketRegime?: MarketRegime;
  decisionQualityScore?: number;
  decisionStrength?: DecisionStrength;
  ttlSec?: number;
  tags?: string[];
  liveVisibility?: ScreenerAlertLiveVisibility;
  noiseClass?: ScreenerAlertNoiseClass;
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

export interface UnifiedSignalEvent {
  id: string;
  source: "alert" | "volume_milestone" | "volume_threshold_milestone";
  sourceId: string;
  symbol: string;
  kind?: string;
  bias?: string;
  direction?: string;
  title: string;
  description?: string;
  severity?: string;
  priority?: string;
  rankScore?: number;
  suppress?: boolean;
  suppressReason?: string;
  confidenceScore?: number;
  signalStabilityScore?: number;
  signalVolatilityClass?: SignalVolatilityClass;
  signalDecayRate?: SignalDecayRate;
  marketRegime?: MarketRegime;
  decisionQualityScore?: number;
  decisionStrength?: DecisionStrength;
  ttlSec?: number;
  tags?: string[];
  liveVisibility?: "PRIMARY" | "REVIEW" | "HIDDEN";
  noiseClass?: "ACTIONABLE" | "CONTEXT" | "NOISE";
  createdAt: number;
  expiresAt?: number;
  mergeKey: string;
  rawRef: {
    collection: "alerts" | "volumeMilestones" | "volumeThresholdMilestones";
    id: string;
  };
}

export type TradeDecisionAction = "ENTER" | "WAIT" | "SKIP";
export type TradeDecisionSource = "manual" | "signal_inbox" | "trading_ticket" | "system";
export type TradeDecisionStatus = "draft" | "committed" | "linked_to_order" | "reviewed";

export interface TradeDecisionContext {
  id: string;
  unifiedSignalId?: string | null;
  signalId?: string | null;
  symbol: string;
  signalScore?: number | null;
  signalReason?: string | null;
  marketRegime?: string | null;
  signalConfidence?: number;
  signalStability?: number;
  decisionStrength?: DecisionStrength;
  decisionQualityScore?: number;
  riskSnapshotRef?: string | null;
  preflightId?: string | null;
  preflightNonce?: string | null;
  orderIntentId?: string | null;
  reviewCorrelationId?: string | null;
  decision: TradeDecisionAction;
  decisionReason?: string | null;
  source: TradeDecisionSource;
  status: TradeDecisionStatus;
  createdAt: number;
  updatedAt?: number | null;
  payload?: unknown;
}

export interface PositionLifecycle {
  id: string;
  symbol: string;
  orderIntentId?: string | null;
  decisionContextId?: string | null;
  unifiedSignalId?: string | null;
  status: "OPENING" | "OPEN" | "MANAGING" | "CLOSING" | "CLOSED" | "REJECTED" | "ERROR";
  openedAt?: number | null;
  closedAt?: number | null;
  updatedAt: number;
  eventRefs?: string[];
}

export type PositionLifecycleEventType =
  | "CREATED"
  | "ORDER_SUBMITTED"
  | "ORDER_FILLED"
  | "POSITION_OPENED"
  | "POSITION_UPDATED"
  | "POSITION_REDUCED"
  | "POSITION_CLOSING"
  | "POSITION_CLOSED"
  | "PNL_REALIZED"
  | "POSITION_STOP_LOSS_TRIGGERED"
  | "POSITION_TAKE_PROFIT_TRIGGERED"
  | "MANUAL_CLOSE"
  | "ERROR";

export interface PositionLifecycleEvent {
  id: string;
  lifecycleId: string;
  eventType: PositionLifecycleEventType;
  timestamp: number;
  eventSeq?: number | null;
  payload?: unknown;
}

export interface PositionLifecycleCreatedMessage {
  type: "position_lifecycle_created";
  generatedAt: number;
  payload: PositionLifecycle;
}

export interface PositionLifecycleUpdatedMessage {
  type: "position_lifecycle_updated";
  generatedAt: number;
  payload: PositionLifecycle;
}

export interface PositionLifecycleClosedMessage {
  type: "position_lifecycle_closed";
  generatedAt: number;
  payload: PositionLifecycle;
}

export interface PositionLifecycleEventMessage {
  type: "position_lifecycle_event";
  generatedAt: number;
  payload: {
    lifecycleId: string;
    eventType: PositionLifecycleEventType;
    timestamp: number;
    payload?: unknown;
  };
}

export interface DecisionReviewObject {
  id: string;
  symbol: string;
  signalId?: string | null;
  unifiedSignalId?: string | null;
  decisionContextId?: string | null;
  orderIntentId?: string | null;
  positionLifecycleId?: string | null;
  journalEntryId?: string | null;
  outcomeId?: string | null;
  marketRegime?: string | null;
  tradeGrade?: "A" | "B" | "C" | "D" | "F" | null;
  ruleViolations?: string[];
  playbookTags?: string[];
  notes?: string | null;
  status?: "draft" | "reviewed" | "archived";
  generationSource?: "position_lifecycle" | "manual" | "system";
  generationVersion?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DecisionChainSnapshot {
  reviewId?: string;
  positionLifecycleId?: string;
  unifiedSignal?: UnifiedSignalEvent | null;
  tradeDecisionContext?: TradeDecisionContext | null;
  orderIntent?: unknown | null;
  orders: OrderStatePayload[];
  positionLifecycle?: PositionLifecycle | null;
  positionLifecycleEvents: PositionLifecycleEvent[];
  decisionReview?: DecisionReviewObject | null;
  missingLinks: string[];
  reconstructedAt: number;
}

export interface DecisionReplayEvent {
  id: string;
  type: "SIGNAL" | "DECISION" | "ORDER" | "POSITION_EVENT" | "REVIEW" | "MISSING_LINK";
  timestamp: number;
  title: string;
  description?: string;
  payload?: unknown;
}

export interface DecisionReplayPayload {
  reviewId?: string;
  positionLifecycleId?: string;
  symbol?: string;
  chain: DecisionChainSnapshot;
  timeline: DecisionReplayEvent[];
  summary: {
    signalPresent: boolean;
    decisionPresent: boolean;
    orderPresent: boolean;
    lifecyclePresent: boolean;
    reviewPresent: boolean;
    missingLinks: string[];
  };
  generatedAt: number;
}

export interface KnowledgeLayerSnapshot {
  generatedAt: number;
  scope: {
    symbol?: string;
    limit: number;
  };
  chainHealth: {
    totalReviews: number;
    completeChains: number;
    partialChains: number;
    missingLinkCounts: Record<string, number>;
    completenessPct: number;
  };
  decisionCoverage: {
    withDecisionContext: number;
    withoutDecisionContext: number;
    coveragePct: number;
  };
  signalLinkage: {
    withUnifiedSignal: number;
    withoutUnifiedSignal: number;
    coveragePct: number;
  };
  replayCoverage: {
    replayable: number;
    notReplayable: number;
    coveragePct: number;
  };
  reviewCompleteness: {
    averageScore: number;
    scoreByReviewId: Record<string, number>;
  };
  playbookReadiness: {
    reviewsWithPlaybookTags: number;
    reviewsWithRuleViolations: number;
    tagReadinessPct: number;
    violationReadinessPct: number;
  };
}

export interface ScreenerWhyTradeItem {
  code: string;
  label: string;
  value?: string | number;
  weight?: number;
}

export interface ScreenerWhyNotTradeItem {
  code: string;
  label: string;
  value?: string | number;
  severity?: "info" | "warning" | "critical";
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
  confidenceScore?: number;
  signalStabilityScore?: number;
  signalVolatilityClass?: SignalVolatilityClass;
  signalDecayRate?: SignalDecayRate;
  marketRegime?: MarketRegime;
  decisionQualityScore?: number;
  decisionStrength?: DecisionStrength;
  risk: RiskSymbolPayload;
  whyTrade?: ScreenerWhyTradeItem[];
  whyNotTrade?: ScreenerWhyNotTradeItem[];
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
export type OpenInterestStatus = "FRESH" | "STALE" | "UNAVAILABLE";

export interface MarketFlowState {
  symbol: string;
  openInterest: {
    value: number | null;
    currentOI: number | null;
    updatedAt: number | null;
    status: OpenInterestStatus;
    errorReason: string | null;
    ageMs: number | null;
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

export interface MiniCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVolume?: number;
  sellVolume?: number;
}

export interface MiniCandleSeries {
  symbol: string;
  interval: "15s" | "30s" | "1m";
  candles: MiniCandle[];
  source?: "kline" | "aggTradeSynthetic" | "frontendFallback";
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
  duplicateSignalCount: number;
  lastDuplicateSignalAt: number | null;
}

export interface FrameTelemetryState {
  frameBuildMs: number;
  frameBuildStagesMs?: {
    rawAssembly?: number;
    rowsProjection?: number;
    compactEncoding?: number;
    deltaDiff?: number;
    telemetryMeasurement?: number;
    postBuildObservers?: number;
    sendPrep?: number;
  };
  frameSerializeMs: number;
  patchSizeBytes: number;
  patchSizeKb: number;
  frameSizeBytes: number;
  frameSizeKb: number;
  fullFrameSizeBytes: number;
  fullFrameSizeKb: number;
  projectedFrameSizeBytes: number;
  projectedFrameSizeKb: number;
  suppressedFrameSizeBytes: number;
  suppressedFrameSizeKb: number;
  savedBytes: number;
  savedKb: number;
  suppressionRatio: number;
  requestedSections: string[];
  skippedSections: string[];
  computedSections: string[];
  skippedComputeSections: string[];
  sectionComputeMs: Record<string, number>;
  sectionCacheStatus?: Record<string, "hit" | "miss" | "uncached">;
  sectionCacheAgeMs?: Record<string, number>;
  sectionCacheTtlMs?: Record<string, number>;
  skippedByTtlSections?: string[];
  projectionMode: "none" | "default" | "visible_sections";
  deltaEnabled: boolean;
  snapshotFramesSent: number;
  patchFramesSent: number;
  averagePatchSizeKb: number;
  savedByDeltaKb: number;
  deltaRatio: number;
  payloadBudgetState: PayloadBudgetState;
  performanceState: PerformanceState;
  clientsConnected: number;
  enabledClients: number;
  sendIntervalMs: number;
  broadcastFrameTotalMs?: number;
  payloadSuppressionMs?: number;
  websocketSendMs?: number;
  sqliteQueryMs?: number;
  signalFlushMs?: number;
  deltaRowsMs?: number;
  deltaSectionCompareMs?: number;
  deltaPatchMeasureMs?: number;
  deltaFullMeasureMs?: number;
  deltaRowsFastPathHit?: boolean;
  deltaComparedSectionsCount?: number;
  deltaChangedSectionsCount?: number;
  rawRowsBuildMs?: number;
  rawTradeFlowMs?: number;
  rawLiquidationsMs?: number;
  rawReturnSeriesMs?: number;
  rawVarMs?: number;
  rawTagsMs?: number;
  rawPerSymbolOtherMs?: number;
  rawRowsSortMs?: number;
  rawCorrelationMs?: number;
  rawRiskScoreApplyMs?: number;
  rawOverviewMs?: number;
  rawAlertsMs?: number;
  rawMilestonesMs?: number;
  averageFrameSizeKb: number;
  largestFrameObservedKb: number;
  sectionSizesSampled?: boolean;
  sectionSizesAgeMs?: number;
  persistenceQueue: PersistenceQueueTelemetry;
  sectionSizes: FrameSectionSize[];
  largestSections: FrameSectionSize[];
}

export type FrameTransportCapability = "compact_frame_transport_v1";

export type CompactTransportScalar = string | number | boolean | null;

export interface CompactFrameTablePayload {
  __compact: "table_v1";
  columns: string[];
  rows: CompactTransportScalar[][];
}

export interface CompactFundingSortedPayload {
  __compact: "funding_sorted_order_v1";
  highest: string[];
  lowest: string[];
  basis: string[];
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
  chartCandles?: MiniCandleSeries[];
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
  unifiedSignals?: UnifiedSignalEvent[];
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

export type OrderIntentAction = "PLACE_ORDER" | "CANCEL_ORDER" | "CLOSE_PAPER_POSITION";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
export type OrderProtectiveKind = "STOP_LOSS" | "TAKE_PROFIT";
export type OrderLifecycleStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "EXPIRED"
  | "REJECTED";
export type OrderEventSource = "validation" | "paper_engine" | "binance_stream";
export type OrderValidationCode =
  | "preflight_payload"
  | "account_connection"
  | "execution_mode"
  | "exchange_filters"
  | "client_order_id"
  | "cancel_target_resolution"
  | "cancel_risk_classification"
  | "market_price"
  | "max_order_notional"
  | "max_position_notional"
  | "max_open_positions"
  | "max_daily_loss"
  | "max_leverage"
  | "margin_available"
  | "protective_price"
  | "protective_price_relation"
  | "reduce_only_position"
  | "min_qty"
  | "step_size"
  | "tick_size"
  | "notional";

export interface OrderRiskLimitValue {
  enabled: boolean;
  value: number | null;
}

export interface OrderRiskLimits {
  maxPositionSize: OrderRiskLimitValue;
  maxAccountExposure: OrderRiskLimitValue;
  maxLeverage: OrderRiskLimitValue;
  maxDailyLoss: OrderRiskLimitValue;
}

export interface OrderValidationCheck {
  code: OrderValidationCode;
  passed: boolean;
  blocking: boolean;
  message: string;
  projectedLeverage?: number | null;
  exchangeMaxLeverage?: number | null;
  effectiveMaxLeverage?: number | null;
  leverageSource?: "AUTHORITATIVE" | "MISSING" | "STALE" | "ERROR";
  leverageAuthoritative?: boolean;
  leverageBracket?: {
    bracket: number;
    initialLeverage: number;
    notionalFloor: number;
    notionalCap: number;
    maintMarginRatio: number;
    cum: number;
  } | null;
}

export interface OrderValidationPayload {
  accepted: boolean;
  paperMode: boolean;
  checks: OrderValidationCheck[];
  normalizedQuantity: number;
  normalizedPrice: number | null;
  notional: number | null;
  riskLimits: OrderRiskLimits;
}

export type SafeToAddStatus = "ALLOW" | "WAIT" | "STALE" | "BLOCK";
export type SafeToAddReasonSource = "order_validation" | "position_sizing" | "do_not_trade";
export type SafeToAddReasonSeverity = "info" | "warning" | "critical";

export interface SafeToAddReason {
  source: SafeToAddReasonSource;
  code: string;
  label: string;
  severity: SafeToAddReasonSeverity;
}

export interface SafeToAddResult {
  symbol: string;
  direction: "long" | "short" | "unknown";
  side: OrderSide | null;
  status: SafeToAddStatus;
  allowed: boolean;
  generatedAt: number;
  staleAfterMs: number;
  recommendedNotional?: number;
  maxNotional?: number;
  recommendedQty?: number;
  normalizedQty?: number;
  suggestedLeverage?: number;
  riskLevel?: PositionSizingResult["riskLevel"];
  liquidationBufferPct?: number | null;
  doNotTrade?: DoNotTradeResult | null;
  checks: OrderValidationCheck[];
  blockers: string[];
  warnings: string[];
  constraints: string[];
  reasons: string[];
  accountBlockers?: SafeToAddReason[];
  source: {
    sizing: boolean;
    orderSafety: boolean;
    doNotTrade: boolean;
  };
}

export interface OrderStatePayload {
  orderId: string;
  intentId: string | null;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price: number | null;
  stopPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  status: OrderLifecycleStatus;
  clientOrderId: string;
  exchangeOrderId: string | null;
  sourceWindowId: string | null;
  parentOrderId: string | null;
  protectiveKind: OrderProtectiveKind | null;
  dryRun: boolean;
  reduceOnly: boolean;
  executedQty: number;
  avgPrice: number | null;
  lastFilledQty: number | null;
  realizedPnl: number | null;
  commission: number | null;
  commissionAsset: string | null;
  lastExecutionType: string | null;
  lastTradeTime: number | null;
  rejectReason: string | null;
  createdAt: number;
  updatedAt: number;
  lastEventSource: OrderEventSource;
}

export interface OrderAuditEventPayload {
  auditId: string;
  orderId: string;
  intentId: string | null;
  timestamp: number;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price: number | null;
  clientOrderId: string;
  status: OrderLifecycleStatus;
  sourceWindowId: string | null;
  dryRun: boolean;
  eventType: string;
  message: string | null;
}

export interface OrderAckMessage {
  type: "order_ack";
  generatedAt: number;
  payload: {
    intentId: string;
    duplicate: boolean;
    order: OrderStatePayload;
    validation: OrderValidationPayload;
    message: string;
  };
}

export interface OrderRejectedMessage {
  type: "order_rejected";
  generatedAt: number;
  payload: {
    intentId: string;
    duplicate: boolean;
    order: OrderStatePayload;
    validation: OrderValidationPayload;
    message: string;
  };
}

export interface OrderErrorMessage {
  type: "order_error";
  generatedAt: number;
  payload: {
    intentId: string | null;
    code: string;
    message: string;
    retriable: boolean;
  };
}

export interface OrderStatusMessage {
  type: "order_status";
  generatedAt: number;
  payload: OrderStatePayload;
}

export interface OrderAuditEventMessage {
  type: "order_audit_event";
  generatedAt: number;
  payload: OrderAuditEventPayload;
}

export type PaperPositionSide = "LONG" | "SHORT";
export type PaperPositionStatus = "OPEN" | "CLOSED";
export type PaperPositionCloseReason = "TAKE_PROFIT" | "STOP_LOSS" | "MANUAL_CLOSE";

export interface PaperPositionState {
  paperPositionId: string;
  symbol: string;
  side: PaperPositionSide;
  quantity: number;
  entryPrice: number;
  entryOrderId: string;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  status: PaperPositionStatus;
  openedAt: number;
  closedAt: number | null;
  closePrice: number | null;
  closeReason: PaperPositionCloseReason | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  paperMode: true;
}

export interface PaperPositionOpenedMessage {
  type: "paper_position_opened";
  generatedAt: number;
  payload: PaperPositionState;
}

export interface PaperPositionUpdatedMessage {
  type: "paper_position_updated";
  generatedAt: number;
  payload: PaperPositionState;
}

export interface PaperPositionClosedMessage {
  type: "paper_position_closed";
  generatedAt: number;
  payload: PaperPositionState;
}

export interface PaperTradingStateMessage {
  type: "paper_trading_state";
  generatedAt: number;
  payload: {
    openPaperPositions: PaperPositionState[];
    recentPaperPositions: PaperPositionState[];
    recentOrders: OrderStatePayload[];
    recentAuditEvents: OrderAuditEventPayload[];
  };
}

export interface LiveSafetyStateMessage {
  type: "live_safety_state";
  generatedAt: number;
  payload: {
    liveTrading: "DISABLED" | "TESTNET_ONLY";
    mode: "DISABLED" | "TESTNET_ONLY";
    ready: boolean;
    testnetMode: boolean;
    environment?: "LIVE" | "TESTNET" | "DISABLED";
    restEnvironment?: "LIVE" | "TESTNET" | "UNKNOWN";
    wsEnvironment?: "LIVE" | "TESTNET" | "UNKNOWN";
    restBase?: string;
    wsBase?: string;
    configEnvDiagnostics?: {
      envFilePath: string | null;
      envFileSource: string | null;
      envFileCandidates: string[];
      envFilesLoaded: string[];
    };
    accountConnectionStatus?: {
      connectedClients: number;
      enabledClients: number;
      connectedStreams: number;
    };
    environmentDiagnostics?: {
      mode: "LIVE" | "TESTNET" | "DISABLED";
      restBaseClassification: "LIVE" | "TESTNET" | "UNKNOWN";
      wsBaseClassification: "LIVE" | "TESTNET" | "UNKNOWN";
      restBaseIsTestnet: boolean;
      wsBaseIsTestnet: boolean;
    };
    environmentBlockers?: Array<{
      code: string;
      message: string;
    }>;
    environmentWarnings?: Array<{
      code: string;
      message: string;
    }>;
    killSwitchActive: boolean;
    orderControlAuthRequired: boolean;
    gates: {
      liveTradingEnabled: boolean;
      orderLiveModeEnabled: boolean;
      paperModeDefault: boolean;
      requiresTestnet: boolean;
      requireTypedConfirm: boolean;
      orderControlAuthRequired: boolean;
      orderControlTokenConfigured: boolean;
      apiCredentialsConfigured: boolean;
      restBaseTestnetReady: boolean;
      wsBaseTestnetReady: boolean;
      riskLimitsReady: boolean;
      configKillSwitchActive: boolean;
      runtimeKillSwitchActive: boolean;
      killSwitchActive: boolean;
    };
    disabledReasons: Array<{
      code: string;
      message: string;
    }>;
    warnings: Array<{
      code: string;
      message: string;
    }>;
  };
}

export interface OrderIntentMessage {
  type: "order_intent";
  payload: {
    intentId: string;
    createdAt: number;
    preflightId?: string | null;
    preflightNonce?: string | null;
    unifiedSignalId?: string | null;
    decisionContextId: string | null;
    reviewCorrelationId?: string | null;
    action: OrderIntentAction;
    symbol?: string;
    side?: OrderSide;
    orderType?: OrderType;
    quantity?: number | null;
    price?: number | null;
    stopPrice?: number | null;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    paperPositionId?: string | null;
    clientOrderId?: string | null;
    targetClientOrderId?: string | null;
    reduceOnly?: boolean;
    paperMode?: boolean;
    confirmText?: string | null;
    controlToken?: string | null;
    sourceWindowId?: string | null;
  };
}

export interface RequestOrderPreflightMessage {
  type: "request_order_preflight";
  payload: {
    requestId: string;
    ticketKey?: string | null;
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number | null;
    stopPrice?: number | null;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    reduceOnly?: boolean;
    paperMode?: boolean;
    mode?: "PAPER" | "TESTNET_LIVE";
    createdAt: number;
  };
}

export interface OrderPreflightMessage {
  type: "order_preflight";
  generatedAt: number;
  payload: {
    requestId: string;
    preflightId: string;
    preflightNonce: string;
    ticketKey: string;
    symbol: string;
    side: OrderSide;
    validation: OrderValidationPayload;
    safeToAdd?: SafeToAddResult;
    generatedAt: number;
    staleAfterMs: number;
    expiresAt: number;
  };
}

export type OrderPreflightStatus = "ACTIVE" | "USED" | "EXPIRED" | "INVALIDATED";

export interface OrderPreflightRecord {
  id: string;
  requestId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  normalizedQuantity?: number | null;
  price?: number | null;
  normalizedPrice?: number | null;
  notional?: number | null;
  decisionContextId?: string | null;
  status: OrderPreflightStatus;
  createdAt: number;
  expiresAt: number;
  usedAt?: number | null;
  invalidatedAt?: number | null;
  reason?: string | null;
}

export interface OrderPreflightPersistedMessage {
  type: "order_preflight_persisted";
  generatedAt: number;
  payload: {
    preflightId: string;
    requestId: string;
    ticketKey: string;
    status: "ACTIVE";
    createdAt: number;
    expiresAt: number;
  };
}

export interface OrderPreflightInvalidatedMessage {
  type: "order_preflight_invalidated";
  generatedAt: number;
  payload: {
    preflightId: string;
    requestId?: string | null;
    ticketKey?: string | null;
    status: Exclude<OrderPreflightStatus, "ACTIVE">;
    reason: string;
    occurredAt: number;
  };
}

export interface TradeDecisionContextCreatedMessage {
  type: "trade_decision_context_created";
  generatedAt: number;
  payload: {
    decisionContext: TradeDecisionContext;
    legacy: true;
  };
}

export interface TradeDecisionContextErrorMessage {
  type: "trade_decision_context_error";
  generatedAt: number;
  payload: {
    id?: string | null;
    code: string;
    message: string;
  };
}

export type DecisionContextResponseStatus = "ACCEPTED" | "REJECTED" | "FORCED_WAIT";
export type DecisionContextSignalState = "OK" | "MISSING" | "STALE";

export interface DecisionContextResponse {
  status: DecisionContextResponseStatus;
  decisionContext?: TradeDecisionContext;
  reason?: string;
  signalState: DecisionContextSignalState;
  validationErrors: string[];
}

export interface DecisionContextResponseMessage {
  type: "decision_context_response";
  generatedAt: number;
  payload: DecisionContextResponse;
}

export interface DecisionChainSnapshotMessage {
  type: "decision_chain_snapshot";
  generatedAt: number;
  payload: DecisionChainSnapshot;
}

export interface DecisionChainErrorMessage {
  type: "decision_chain_error";
  generatedAt: number;
  payload: {
    code: string;
    message: string;
  };
}

export interface DecisionReplayPayloadMessage {
  type: "decision_replay_payload";
  generatedAt: number;
  payload: DecisionReplayPayload;
}

export interface DecisionReplayErrorMessage {
  type: "decision_replay_error";
  generatedAt: number;
  payload: {
    code: string;
    message: string;
  };
}

export interface KnowledgeLayerSnapshotMessage {
  type: "knowledge_layer_snapshot";
  generatedAt: number;
  payload: KnowledgeLayerSnapshot;
}

export interface KnowledgeLayerErrorMessage {
  type: "knowledge_layer_error";
  generatedAt: number;
  payload: {
    code: string;
    message: string;
  };
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
  safeToAdd?: SafeToAddResult | null;
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

export interface RequestSignalReplayMessage {
  type: "request_signal_replay";
  signalId: string;
}

export interface RequestDecisionChainMessage {
  type: "request_decision_chain";
  payload: {
    reviewId?: string | null;
    positionLifecycleId?: string | null;
  };
}

export interface RequestDecisionReplayMessage {
  type: "request_decision_replay";
  payload: {
    reviewId?: string | null;
    positionLifecycleId?: string | null;
  };
}

export interface RequestKnowledgeLayerMessage {
  type: "request_knowledge_layer";
  payload?: {
    symbol?: string | null;
    limit?: number | null;
  };
}

export interface RequestLearningReportMessage {
  type: "request_learning_report";
  filters?: LearningReportFilters;
}

export interface CreateTradeDecisionContextMessage {
  type: "create_trade_decision_context";
  payload: {
    symbol: string;
    intent: TradeDecisionAction;
    notes?: string | null;
    preflightId?: string | null;
  };
}

export type ServerMessage =
  | WelcomeMessage
  | PongMessage
  | ScreenerFrame
  | FrameSnapshotMessage
  | FramePatchMessage
  | RiskSnapshotMessage
  | RiskUpdateMessage
  | OrderAckMessage
  | OrderRejectedMessage
  | OrderErrorMessage
  | OrderStatusMessage
  | OrderAuditEventMessage
  | PaperPositionOpenedMessage
  | PaperPositionUpdatedMessage
  | PaperPositionClosedMessage
  | PaperTradingStateMessage
  | LiveSafetyStateMessage
  | SignalStatisticsMessage
  | SignalReplayMessage
  | JournalEntriesMessage
  | JournalAnalyticsMessage
  | LearningReportMessage
  | JournalErrorMessage
  | JournalAutoEventMessage
  | PositionSizingMessage
  | OrderPreflightMessage
  | OrderPreflightPersistedMessage
  | OrderPreflightInvalidatedMessage
  | TradeDecisionContextCreatedMessage
  | TradeDecisionContextErrorMessage
  | DecisionContextResponseMessage
  | PositionLifecycleCreatedMessage
  | PositionLifecycleUpdatedMessage
  | PositionLifecycleClosedMessage
  | PositionLifecycleEventMessage
  | DecisionChainSnapshotMessage
  | DecisionChainErrorMessage
  | DecisionReplayPayloadMessage
  | DecisionReplayErrorMessage
  | KnowledgeLayerSnapshotMessage
  | KnowledgeLayerErrorMessage;

export interface FrameSnapshotMessage {
  type: "snapshot";
  // Frontend recovery treats snapshots as full replacement frames; backend compact
  // snapshots must include the complete projected frame needed to rebuild UI state.
  frame: ScreenerFrame;
  frameSeq: number;
  baseSeq: null;
  recovery: DeltaFrameRecoveryTelemetry;
}

export interface FramePatchMessage {
  type: "frame_patch";
  frameSeq: number;
  baseSeq: number;
  changed: Partial<ScreenerFrame>;
  recovery: DeltaFrameRecoveryTelemetry;
}

export interface DeltaFrameRecoveryTelemetry {
  lastClientSeenSeq: number | null;
  forcedFullResyncs: number;
  desyncEvents: number;
  lastDesyncAt: number | null;
  lastDesyncReason: string | null;
  lastRecoveryAt: number | null;
  lastRecoveryReason: string | null;
}

export interface VisibleSectionsMessage {
  type: "visible_sections";
  sections: string[];
}

export interface SetSelectedSymbolMessage {
  type: "set_selected_symbol";
  payload: {
    symbol: string | null;
  };
}

export interface PersistedState {
  backendWsUrl?: string;
  settings: DashboardSettings;
  watchlist: string[];
  activeTrades?: string[];
  selectedSymbol?: string | null;
  uiPreferences?: UiPreferences;
  profileNotes?: string;
}
