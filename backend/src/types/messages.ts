import type { AllocationState } from "../allocation/types";
import type { AlertPriority } from "../alert-ranking/alert-ranking-engine";
import type { ConflictState } from "../conflict/types";
import type {
  FramePatchMessage,
  FrameSnapshotMessage,
  SnapshotRequestPayload
} from "../delta-frame/types";
import type { DoNotTradeResult } from "../do-not-trade/do-not-trade-engine";
import type { ExecutionCommand, ExecutionResult, ExecutionState } from "../execution/types";
import type { FundingSortedViews, FundingSymbolState } from "../funding/types";
import type { FrameTelemetryState } from "../frame-telemetry/types";
import type { LiquidationsDashboardPayload } from "../liquidations/types";
import type { MarketFlowState } from "../market-flow/types";
import type { RegimeFeedbackCalibrationState } from "../regime-feedback-calibration/types";
import type { MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type { PositionRiskOrchestratorState } from "../position-risk-orchestrator/types";
import type { PortfolioAnalyticsState } from "../portfolio/types";
import type { RegimePredictionState } from "../regime-prediction/types";
import type { RegimeState } from "../regime/types";
import type { RegimeMemoryState } from "../regime-memory/types";
import type { RegimeLearningPayload } from "../regime-learning/types";
import type { SignalIntelligenceState } from "../signal-intelligence/types";
import type {
  SignalStatisticsBucket,
  SignalStatisticsFilters,
  SignalStatisticsRecentOutcome
} from "../storage/signal-statistics-service";
import type {
  JournalAnalyticsFilters,
  JournalAnalyticsPayload
} from "../storage/journal-analytics-service";
import type {
  LearningReportFilters,
  LearningReportPayload
} from "../learning/learning-engine";
import type { AutoJournalEventType } from "../storage/auto-journal-service";
import type {
  CreateJournalEntryInput,
  JournalEntryFilters,
  JournalEntryRecord,
  SignalReplayPayload,
  UpdateJournalEntryPatch
} from "../storage/signal-repository";
import type {
  RiskLevel,
  RiskSnapshotPayload,
  RiskState,
  RiskSymbolPayload,
  RiskUpdatePayload
} from "../risk/types";
import type { PositionSizingDirection, PositionSizingResult } from "../risk/position-sizing-engine";

export type Bias = "LONG" | "SHORT" | "NEUTRAL";
export type ActiveTradeSource = "none" | "manual" | "account" | "both";
export type AccountCredentialSource = "none" | "env" | "session";

export type BackendPhase = "booting" | "live" | "degraded";
export type ScreenerAlertKind = "tape" | "liquidation" | "reviving_coin" | "risk";
export type ScreenerAlertLiveVisibility = "PRIMARY" | "REVIEW" | "HIDDEN";
export type ScreenerAlertNoiseClass = "ACTIONABLE" | "CONTEXT" | "NOISE";
export type SignalVolatilityClass = "LOW" | "MID" | "HIGH";
export type SignalDecayRate = "FAST" | "MEDIUM" | "SLOW";
export type MarketRegime = "TREND" | "CHOP" | "LIQUIDATION_SPIKE" | "BREAKOUT";
export type DecisionStrength = "WEAK" | "NORMAL" | "STRONG";
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

export type DecisionChainIntegrityStatus = "COMPLETE" | "DEGRADED" | "BROKEN";
export type DecisionChainMissingLink =
  | "UNIFIED_SIGNAL"
  | "DECISION_CONTEXT"
  | "ORDER_INTENT"
  | "EXECUTION_COMMAND"
  | "EXECUTION_RESULT"
  | "POSITION_LIFECYCLE"
  | "DECISION_REVIEW";

export interface DecisionChainIntegrityRecord {
  id: string;
  lifecycleId?: string | null;
  reviewId?: string | null;
  orderIntentId?: string | null;
  decisionContextId?: string | null;
  unifiedSignalId?: string | null;
  status: DecisionChainIntegrityStatus;
  missingLinks: DecisionChainMissingLink[];
  checkedAt: number;
  source: string;
}

export interface DecisionChainSnapshot {
  reviewId?: string;
  positionLifecycleId?: string;
  unifiedSignal?: UnifiedSignalEvent | null;
  tradeDecisionContext?: TradeDecisionContext | null;
  orderIntent?: unknown | null;
  executionCommand?: ExecutionCommand | null;
  executionResult?: ExecutionResult | null;
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
  confidenceScore: number;
  signalStabilityScore: number;
  signalVolatilityClass: SignalVolatilityClass;
  signalDecayRate: SignalDecayRate;
  marketRegime: MarketRegime;
  decisionQualityScore: number;
  decisionStrength: DecisionStrength;
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

export interface ScreenerFrame {
  type: "frame";
  generatedAt: number;
  settings: BackendSettings;
  status: {
    phase: BackendPhase;
    message: string;
    universeSize: number;
    focusSymbols: string[];
    marketStream: ConnectionHealth;
    publicStream: ConnectionHealth;
    accountStream: AccountStreamStatus;
  };
  overview: ScreenerOverview;
  risk: RiskState;
  funding: FundingSymbolState[];
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
  rows: ScreenerRow[];
  alerts: ScreenerAlert[];
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
  direction: PositionSizingDirection;
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

export interface PaperPositionPayload {
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
  payload: PaperPositionPayload;
}

export interface PaperPositionUpdatedMessage {
  type: "paper_position_updated";
  generatedAt: number;
  payload: PaperPositionPayload;
}

export interface PaperPositionClosedMessage {
  type: "paper_position_closed";
  generatedAt: number;
  payload: PaperPositionPayload;
}

export interface PaperTradingStateMessage {
  type: "paper_trading_state";
  generatedAt: number;
  payload: {
    openPaperPositions: PaperPositionPayload[];
    recentPaperPositions: PaperPositionPayload[];
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

export interface SignalStatisticsMessage {
  type: "signal_statistics";
  generatedAt: number;
  payload: {
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
  };
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
    event: AutoJournalEventType;
    journalEntry: JournalEntryRecord;
  };
}

export interface PositionSizingMessage {
  type: "position_sizing";
  generatedAt: number;
  payload: PositionSizingResult & {
    doNotTrade?: DoNotTradeResult;
    safeToAdd?: SafeToAddResult;
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

export type ServerMessage =
  | WelcomeMessage
  | ScreenerFrame
  | FrameSnapshotMessage
  | FramePatchMessage
  | PongMessage
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

export interface HelloMessage {
  type: "hello";
  payload?: {
    capabilities?: FrameTransportCapability[];
    activeOrderPreflightIds?: string[];
  };
}

export interface RequestSnapshotMessage {
  type: "request_snapshot";
  payload?: SnapshotRequestPayload & {
    activeOrderPreflightIds?: string[];
  };
}

export interface VisibleSectionsMessage {
  type: "visible_sections";
  sections: string[];
}

export interface SetWatchlistMessage {
  type: "set_watchlist";
  payload: {
    symbols: string[];
  };
}

export interface SetActiveTradesMessage {
  type: "set_active_trades";
  payload: {
    symbols: string[];
  };
}

export interface SetSelectedSymbolMessage {
  type: "set_selected_symbol";
  payload: {
    symbol: string | null;
  };
}

export interface SetSettingsMessage {
  type: "set_settings";
  payload: Partial<BackendSettings>;
}

export interface PingMessage {
  type: "ping";
  payload: {
    sentAt: number;
  };
}

export interface ConnectBinanceAccountMessage {
  type: "connect_binance_account";
  payload: {
    apiKey: string;
    apiSecret: string;
  };
}

export interface DisconnectBinanceAccountMessage {
  type: "disconnect_binance_account";
}

export interface OrderIntentMessage {
  type: "order_intent";
  payload: {
    intentId: string;
    createdAt: number;
    preflightId?: string | null;
    preflightNonce?: string | null;
    unifiedSignalId?: string | null;
    decisionContextId?: string | null;
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

export interface LiveTradingControlMessage {
  type: "live_trading_control";
  action: "DISABLE_LIVE_TRADING";
  payload?: {
    controlToken?: string | null;
  };
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

export interface RequestSignalStatisticsMessage {
  type: "request_signal_statistics";
  filters?: SignalStatisticsFilters;
}

export interface RequestSignalReplayMessage {
  type: "request_signal_replay";
  signalId: string;
}

export interface CreateJournalEntryMessage {
  type: "create_journal_entry";
  payload: CreateJournalEntryInput;
}

export interface UpdateJournalEntryMessage {
  type: "update_journal_entry";
  id: string;
  patch: UpdateJournalEntryPatch;
}

export interface DeleteJournalEntryMessage {
  type: "delete_journal_entry";
  id: string;
}

export interface RequestJournalEntriesMessage {
  type: "request_journal_entries";
  filters?: JournalEntryFilters;
}

export interface RequestJournalAnalyticsMessage {
  type: "request_journal_analytics";
  filters?: JournalAnalyticsFilters;
}

export interface RequestLearningReportMessage {
  type: "request_learning_report";
  filters?: LearningReportFilters;
}

export interface RequestPositionSizingMessage {
  type: "request_position_sizing";
  payload: {
    symbol: string;
    direction?: PositionSizingDirection;
    entryPrice?: number | null;
    stopDistancePct?: number | null;
    customEquityUsdt?: number | null;
    riskPerTradePct?: number | null;
  };
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

export type ClientMessage =
  | HelloMessage
  | RequestSnapshotMessage
  | VisibleSectionsMessage
  | SetWatchlistMessage
  | SetActiveTradesMessage
  | SetSelectedSymbolMessage
  | SetSettingsMessage
  | PingMessage
  | ConnectBinanceAccountMessage
  | DisconnectBinanceAccountMessage
  | OrderIntentMessage
  | RequestOrderPreflightMessage
  | LiveTradingControlMessage
  | CreateTradeDecisionContextMessage
  | RequestSignalStatisticsMessage
  | RequestSignalReplayMessage
  | CreateJournalEntryMessage
  | UpdateJournalEntryMessage
  | DeleteJournalEntryMessage
  | RequestJournalEntriesMessage
  | RequestJournalAnalyticsMessage
  | RequestLearningReportMessage
  | RequestPositionSizingMessage
  | RequestDecisionChainMessage
  | RequestDecisionReplayMessage
  | RequestKnowledgeLayerMessage;
