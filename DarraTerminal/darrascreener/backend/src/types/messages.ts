import type { AllocationState } from "../allocation/types";
import type { AlertPriority } from "../alert-ranking/alert-ranking-engine";
import type { ConflictState } from "../conflict/types";
import type { FramePatchMessage, FrameSnapshotMessage } from "../delta-frame/types";
import type { DoNotTradeResult } from "../do-not-trade/do-not-trade-engine";
import type { ExecutionState } from "../execution/types";
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
  fundingSorted: FundingSortedViews;
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
  volumeMilestones: VolumeMilestoneEvent[];
  volumeThresholdMilestones: VolumeMilestoneEvent[];
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
  | SignalStatisticsMessage
  | SignalReplayMessage
  | JournalEntriesMessage
  | JournalAnalyticsMessage
  | LearningReportMessage
  | JournalErrorMessage
  | JournalAutoEventMessage
  | PositionSizingMessage;

export interface HelloMessage {
  type: "hello";
}

export interface RequestSnapshotMessage {
  type: "request_snapshot";
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

export type ClientMessage =
  | HelloMessage
  | RequestSnapshotMessage
  | VisibleSectionsMessage
  | SetWatchlistMessage
  | SetActiveTradesMessage
  | SetSettingsMessage
  | PingMessage
  | ConnectBinanceAccountMessage
  | DisconnectBinanceAccountMessage
  | RequestSignalStatisticsMessage
  | RequestSignalReplayMessage
  | CreateJournalEntryMessage
  | UpdateJournalEntryMessage
  | DeleteJournalEntryMessage
  | RequestJournalEntriesMessage
  | RequestJournalAnalyticsMessage
  | RequestLearningReportMessage
  | RequestPositionSizingMessage;
