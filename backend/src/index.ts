import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import { PortfolioAllocationEngine } from "./allocation/portfolio-allocation-engine";
import { SignalConflictEngine } from "./conflict/signal-conflict-engine";
import { config } from "./config";
import { DeltaFrameEngine } from "./delta-frame/delta-frame-engine";
import type { DeltaFrameClientState } from "./delta-frame/types";
import { doNotTradeEngine } from "./do-not-trade/do-not-trade-engine";
import { ExecutionIntelligenceEngine } from "./execution/execution-intelligence-engine";
import { compactFrameForTransport } from "./frame-transport/compact-frame-transport";
import { decisionContextService } from "./decision/decision-context-service";
import { decisionContextValidator } from "./decision/decision-context-validator";
import { FrameTelemetryEngine, resolvePerformanceState } from "./frame-telemetry/frame-telemetry-engine";
import type { FrameTelemetryState } from "./frame-telemetry/types";
import { FundingEngine } from "./funding/funding-engine";
import { LiquidationAggregator } from "./liquidations/liquidation-aggregator";
import { LiquidationEngine } from "./liquidations/liquidation-engine";
import { MarketFlowEngine } from "./market-flow/market-flow-engine";
import {
  PayloadSuppressionEngine,
  resolveRequestedSections
} from "./payload-suppression/payload-suppression-engine";
import { RegimeFeedbackCalibrationEngine } from "./regime-feedback-calibration/regime-feedback-calibration-engine";
import { MetaRegimeGovernorEngine } from "./meta-regime-governor/meta-regime-governor-engine";
import { PositionRiskOrchestratorEngine } from "./position-risk-orchestrator/position-risk-orchestrator-engine";
import { PortfolioAnalyticsEngine } from "./portfolio/portfolio-analytics-engine";
import { RegimePredictionEngine } from "./regime-prediction/regime-prediction-engine";
import { UnifiedRegimeEngine } from "./regime/unified-regime-engine";
import { RegimeMemoryEngine } from "./regime-memory/regime-memory-engine";
import { RegimeLearningEngine } from "./regime-learning/regime-learning-engine";
import { SignalIntelligenceEngine } from "./signal-intelligence/signal-intelligence-engine";
import {
  createDefaultBackendSettings,
  normalizeBackendSettings,
  normalizeRevivingCoinAlertSettings,
  normalizeVolumeMilestoneSettings
} from "./lib/settings";
import { registerSocialAuthRoutes } from "./social-auth-broker";
import { RiskEngine } from "./risk/risk-engine";
import { RiskStore } from "./risk/risk-store";
import { createRiskSnapshotMessage } from "./risk/ws-risk-publisher";
import { positionSizingEngine } from "./risk/position-sizing-engine";
import { buildRiskAuthoritySafeToAddResult } from "./risk/risk-authority";
import { evaluateLiveReadiness } from "./safety/live-readiness";
import { getExchangeFilterMap } from "./services/binance-exchange-filters";
import { BinanceAccountStreamManager } from "./services/binance-account-stream";
import { BinanceOrderService } from "./services/binance-order-service";
import { BinanceStreamManager } from "./services/binance-stream";
import { bootstrapUniverse, fetchOpenInterest } from "./services/binance-rest";
import { summarizeBinanceEnvironmentDiagnostics } from "./safety/binance-environment";
import { MarketEventStore } from "./services/market-event-store";
import { RevivingCoinDetector } from "./services/reviving-coin-detector";
import {
  ScreenerEngine,
  buildUnifiedSignalFromAlert,
  buildUnifiedSignalFromVolumeMilestone,
  buildUnifiedSignalFromVolumeThresholdMilestone
} from "./services/screener-engine";
import { listTtsModels, synthesizeSpeech } from "./services/tts-service";
import { signalEventWriter } from "./storage/signal-event-writer";
import { signalOutcomeTracker } from "./storage/signal-outcome-tracker";
import { journalAnalyticsService } from "./storage/journal-analytics-service";
import type { JournalAnalyticsFilters } from "./storage/journal-analytics-service";
import { learningEngine } from "./learning/learning-engine";
import type { LearningReportFilters } from "./learning/learning-engine";
import { AutoJournalService } from "./storage/auto-journal-service";
import type { AutoJournalEvent } from "./storage/auto-journal-service";
import { signalRepository } from "./storage/signal-repository";
import type { JournalEntryFilters } from "./storage/signal-repository";
import { signalStatisticsService } from "./storage/signal-statistics-service";
import { unifiedSignalRepository } from "./storage/unified-signal-repository";
import { reconstructDecisionChain } from "./storage/decision-chain-repository";
import { buildDecisionReplay } from "./storage/decision-replay-service";
import { buildKnowledgeLayerSnapshot } from "./storage/knowledge-layer-service";
import { orderPreflightRepository } from "./storage/order-preflight-repository";
import { orderRepository } from "./storage/order-repository";
import type { SignalStatisticsFilters } from "./storage/signal-statistics-service";
import { closeSqlite, initializeSqlite } from "./storage/sqlite";
import type { SignalIntelligenceState } from "./signal-intelligence/types";
import type {
  BackendSettings,
  ClientMessage,
  DecisionContextResponse,
  FrameTransportCapability,
  SafeToAddResult,
  ScreenerAlert,
  ScreenerFrame,
  ScreenerRow,
  ServerMessage,
  UnifiedSignalEvent
} from "./types/messages";

interface ClientContext {
  socket: WebSocket;
  kind: "terminal" | "desktop-alert-monitor";
  watchlist: Set<string>;
  manualActiveTrades: Set<string>;
  selectedSymbol: { symbol: string; updatedAt: number } | null;
  settings: BackendSettings;
  orderService: BinanceOrderService;
  accountStreamManager: BinanceAccountStreamManager;
  accountActiveTrades: Set<string>;
  riskEngine: RiskEngine;
  visibleSections: Set<string> | null;
  deltaFrameState: DeltaFrameClientState;
  forceSnapshotNext: boolean;
  transportCapabilities: Set<FrameTransportCapability>;
}

interface FrameBuildContext {
  requestedSections: Set<string>;
  hasAnyClientFor: (section: string) => boolean;
}

interface SectionCacheEntry<T> {
  createdAt: number;
  expiresAt: number;
  value: T;
}

interface FrameComputeTelemetry {
  computedSections: string[];
  skippedComputeSections: string[];
  sectionComputeMs: Record<string, number>;
  sectionCacheStatus: Record<string, "hit" | "miss" | "uncached">;
  sectionCacheAgeMs: Record<string, number>;
  sectionCacheTtlMs: Record<string, number>;
  skippedByTtlSections: string[];
}

const engine = new ScreenerEngine();
const fundingEngine = new FundingEngine();
const liquidationEngine = new LiquidationEngine();
const liquidationAggregator = new LiquidationAggregator(liquidationEngine);
const marketFlowEngine = new MarketFlowEngine();
const portfolioAnalyticsEngine = new PortfolioAnalyticsEngine();
const unifiedRegimeEngine = new UnifiedRegimeEngine();
const regimeLearningEngine = new RegimeLearningEngine();
const executionIntelligenceEngine = new ExecutionIntelligenceEngine();
const signalConflictEngine = new SignalConflictEngine();
const portfolioAllocationEngine = new PortfolioAllocationEngine();
const signalIntelligenceEngine = new SignalIntelligenceEngine();
const metaRegimeGovernorEngine = new MetaRegimeGovernorEngine();
const positionRiskOrchestratorEngine = new PositionRiskOrchestratorEngine();
const regimeMemoryEngine = new RegimeMemoryEngine();
const regimePredictionEngine = new RegimePredictionEngine();
const regimeFeedbackCalibrationEngine = new RegimeFeedbackCalibrationEngine();
let paperProtectiveOrderService: BinanceOrderService | null = null;
const frameTelemetryEngine = new FrameTelemetryEngine({
  getRuntimeMetrics: () => {
    const accountSessions = summarizeAccountSessions();
    const persistenceMetrics = signalEventWriter.getMetrics();
    const sqliteDurations = [
      signalRepository.getLastSqliteQueryMs(),
      signalStatisticsService.getLastSqliteQueryMs()
    ].filter((value): value is number => typeof value === "number");

    const sqliteQueryMs = sqliteDurations.length > 0 ? Math.max(...sqliteDurations) : undefined;
    const signalFlushMs = persistenceMetrics.lastFlushMs ?? undefined;

    return {
      clientsConnected: accountSessions.connectedClients,
      enabledClients: accountSessions.enabledClients,
      sendIntervalMs: config.frameIntervalMs,
      ...(sqliteQueryMs !== undefined ? { sqliteQueryMs } : {}),
      ...(signalFlushMs !== undefined ? { signalFlushMs } : {}),
      persistenceQueue: persistenceMetrics
    };
  }
});
const payloadSuppressionEngine = new PayloadSuppressionEngine();
const deltaFrameEngine = new DeltaFrameEngine();
const marketEventStore = new MarketEventStore(config.marketEventStorePath);
const revivingCoinDetector = new RevivingCoinDetector(config.binanceRestBase, marketEventStore);
const autoJournalService = new AutoJournalService(config.autoJournalFromBinance);
const clients = new Map<string, ClientContext>();
const selectedChartSymbolTtlMs = 30 * 60_000;
const maxSelectedChartSymbols = 24;
let globalSettings = createDefaultBackendSettings();
let marketStreamsStarted = false;
let frameBroadcastInterval: NodeJS.Timeout | null = null;
let focusRebalanceInterval: NodeJS.Timeout | null = null;
let openInterestPollInterval: NodeJS.Timeout | null = null;
let revivingCoinScanInterval: NodeJS.Timeout | null = null;
let revivingCoinScanPromise: Promise<void> | null = null;
let openInterestPollPromise: Promise<void> | null = null;
let backendStarted = false;
let backendStartPromise: Promise<void> | null = null;
let marketBootstrapPromise: Promise<void> | null = null;
let bootstrapRetryTimer: NodeJS.Timeout | null = null;
let bootstrapRetryResolve: (() => void) | null = null;
let runtimeStopRequested = false;
let lastFrameSerializeMs = 0;
let lastPatchSizeBytes = 0;

const safeDefaultVisibleSections = new Set<string>(["rows", "risk"]);
const safeAlertMonitorVisibleSections = new Set<string>([
  "alerts",
  "volumeMilestones",
  "volumeThresholdMilestones",
  "status",
  "overview"
]);
const heavyComputeSections = new Set<string>([
  "regimeMemory",
  "regimePrediction",
  "regimeFeedbackCalibration",
  "pnlAttribution",
  "correlationHeatmap",
  "varPanel",
  "signalIntelligence",
  "metaRegimeGovernor",
  "positionRiskOrchestrator",
  "conflict",
  "execution",
  "fundingSorted",
  "marketFlow",
  "liquidations",
  "regime",
  "regimeLearning",
  "portfolioAnalytics",
  "allocation",
  "volumeMilestones",
  "volumeThresholdMilestones",
  "learning",
  "learningCenter",
  "statistics",
  "signalStatistics",
  "journal",
  "tradeJournal"
]);
const sectionCacheTtlMs = new Map<string, number>([
  ["fundingSorted", 2_000],
  ["metaRegimeGovernor", 5_000],
  ["portfolioAnalytics", 10_000],
  ["positionRiskOrchestrator", 5_000],
  ["regimeLearning", 3_000],
  ["regimeMemory", 10_000],
  ["regimePrediction", 5_000]
]);
const heavySectionCacheByClient = new WeakMap<ClientContext, Map<string, SectionCacheEntry<unknown>>>();

let phase: "booting" | "live" | "degraded" = "booting";
let phaseMessage = "bootstrapping market universe";

engine.onAlert((alert) => {
  marketEventStore.recordSignal(alert);
});

const summarizeSettings = (): BackendSettings => {
  const focusUniverseSize =
    Math.max(
      config.defaultFocusUniverseSize,
      ...Array.from(clients.values()).map((client) => client.settings.focusUniverseSize)
    ) || config.defaultFocusUniverseSize;

  return {
    focusUniverseSize,
    revivingCoins: globalSettings.revivingCoins,
    volumeMilestones: globalSettings.volumeMilestones
  };
};

const summarizeWatchlist = (): Set<string> => {
  const watchlist = new Set<string>();

  for (const client of clients.values()) {
    for (const symbol of client.watchlist) {
      watchlist.add(symbol);
    }
  }

  return watchlist;
};

const summarizeActiveTrades = (): Set<string> => {
  const manualActiveTrades = new Set<string>();

  for (const client of clients.values()) {
    for (const symbol of client.manualActiveTrades) {
      manualActiveTrades.add(symbol);
    }
  }

  return manualActiveTrades;
};

const summarizeAccountActiveTrades = (): Set<string> => {
  const accountSymbols = new Set<string>();

  for (const client of clients.values()) {
    for (const symbol of client.accountActiveTrades) {
      accountSymbols.add(symbol);
    }
  }

  return accountSymbols;
};

const areSetsEqual = (left: Set<string>, right: Set<string>): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
};

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeActiveOrderPreflightIds = (
  values: string[] | null | undefined
): string[] =>
  Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeText(value))
        .filter((value): value is string => value !== null)
    )
  );

const send = (socket: WebSocket, payload: ServerMessage | Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const sendSerialized = (socket: WebSocket, payload: string): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
  }
};

const broadcastOrderMessage = (payload: ServerMessage): void => {
  for (const client of clients.values()) {
    if (client.kind !== "terminal") {
      continue;
    }

    send(client.socket, payload);
  }
};

const sendOrderPreflightInvalidation = (
  socket: WebSocket,
  payload: {
    preflightId: string;
    requestId?: string | null;
    ticketKey?: string | null;
    status: "USED" | "EXPIRED" | "INVALIDATED";
    reason: string;
    occurredAt: number;
  }
): void => {
  send(socket, {
    type: "order_preflight_invalidated",
    generatedAt: payload.occurredAt,
    payload
  });
};

const syncClientOrderPreflights = (
  socket: WebSocket,
  client: ClientContext,
  activeOrderPreflightIds: string[] | null | undefined
): void => {
  const now = Date.now();

  for (const preflightId of normalizeActiveOrderPreflightIds(activeOrderPreflightIds)) {
    const persisted = orderPreflightRepository.getById(preflightId);

    if (!persisted) {
      sendOrderPreflightInvalidation(socket, {
        preflightId,
        requestId: null,
        ticketKey: null,
        status: "INVALIDATED",
        reason: "Preflight is no longer available on the backend. Request a new confirmation.",
        occurredAt: now
      });
      continue;
    }

    const currentRecord =
      persisted.status === "ACTIVE" && persisted.expiresAt <= now
        ? orderPreflightRepository.expireActivePreflight(
            persisted.id,
            now,
            "ACTIVE preflight expired before reconnect snapshot sync."
          ) ?? persisted
        : persisted;

    if (currentRecord.status !== "ACTIVE") {
      sendOrderPreflightInvalidation(socket, {
        preflightId: currentRecord.id,
        requestId: currentRecord.requestId,
        ticketKey: null,
        status: currentRecord.status,
        reason:
          currentRecord.reason ??
          "Preflight is no longer valid. Request a new confirmation before submitting.",
        occurredAt: currentRecord.usedAt ?? currentRecord.invalidatedAt ?? now
      });
      continue;
    }

    if (!client.orderService.hasRuntimeBoundPreflight(currentRecord.id, now)) {
      const invalidated =
        orderPreflightRepository.markInvalidated(
          currentRecord.id,
          now,
          "Preflight was tied to an earlier backend session. Request a new confirmation."
        ) ?? currentRecord;

      sendOrderPreflightInvalidation(socket, {
        preflightId: invalidated.id,
        requestId: invalidated.requestId,
        ticketKey: null,
        status: invalidated.status === "ACTIVE" ? "INVALIDATED" : invalidated.status,
        reason:
          invalidated.reason ??
          "Preflight was tied to an earlier backend session. Request a new confirmation.",
        occurredAt: invalidated.invalidatedAt ?? now
      });
    }
  }
};

paperProtectiveOrderService = new BinanceOrderService(config.binanceRestBase, {
  defaultPaperMode: true,
  liveModeEnabled: false,
  onMessage: broadcastOrderMessage
});

const sendRiskSnapshot = (socket: WebSocket, client: ClientContext): void => {
  send(socket, createRiskSnapshotMessage(client.riskEngine.getSnapshot()));
};

const sendPaperTradingState = (socket: WebSocket, client: ClientContext): void => {
  if (client.kind !== "terminal") {
    return;
  }

  send(socket, {
    type: "paper_trading_state",
    generatedAt: Date.now(),
    payload: {
      openPaperPositions: orderRepository.listOpenPaperPositions(),
      recentPaperPositions: orderRepository.listRecentPaperPositions(20),
      recentOrders: orderRepository.listRecentOrders(50),
      recentAuditEvents: orderRepository.listRecentAuditEvents(50)
    }
  });
};

let liveTradingRuntimeKillSwitchActive = false;

const createLiveSafetyStateMessage = () => {
  const decision = evaluateLiveReadiness({
    liveTradingEnabled: config.liveTradingEnabled,
    orderLiveModeEnabled: config.orderLiveModeEnabled,
    paperModeDefault: config.orderPaperModeDefault,
    liveTradingRequiresTestnet: config.liveTradingRequiresTestnet,
    liveTradingRequireTypedConfirm: config.liveTradingRequireTypedConfirm,
    binanceFuturesTestnet: config.binanceFuturesTestnet,
    restBase: config.binanceRestBase,
    wsBase: config.binanceWsBase,
    orderControlAuthRequired: config.orderControlAuthRequired,
    orderControlToken: config.orderControlToken,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    liveTradingKillSwitchEnabled: config.liveTradingKillSwitchEnabled,
    runtimeKillSwitchActive: liveTradingRuntimeKillSwitchActive,
    liveRiskLimits: config.liveRiskLimits
  });

  return {
    type: "live_safety_state" as const,
    generatedAt: Date.now(),
    payload: {
      liveTrading: decision.mode,
      mode: decision.mode,
      ready: decision.ready,
      testnetMode: config.binanceFuturesTestnet,
      environment: decision.environment.intendedMode,
      configEnvDiagnostics: (process as NodeJS.Process & {
          scalpstationEnvDiagnostics?: {
            envFilePath: string | null;
            envFileSource: string | null;
            envFileCandidates: string[];
            envFilesLoaded: string[];
          };
        }).scalpstationEnvDiagnostics,
      accountConnectionStatus: summarizeAccountSessions(),
      environmentDiagnostics: summarizeBinanceEnvironmentDiagnostics(decision.environment),
      restEnvironment: decision.environment.restEnvironment,
      wsEnvironment: decision.environment.wsEnvironment,
      restBase: decision.environment.restBase,
      wsBase: decision.environment.wsBase,
      environmentBlockers: decision.environment.blockers,
      environmentWarnings: decision.environment.warnings,
      killSwitchActive: decision.gates.killSwitchActive,
      orderControlAuthRequired: config.orderControlAuthRequired,
      gates: decision.gates,
      disabledReasons: decision.disabledReasons,
      warnings: decision.warnings
    }
  };
};

const sendLiveSafetyState = (socket: WebSocket): void => {
  send(socket, createLiveSafetyStateMessage());
};

const broadcastLiveSafetyState = (): void => {
  for (const client of clients.values()) {
    if (client.kind === "terminal") {
      sendLiveSafetyState(client.socket);
    }
  }
};

const sendSignalStatistics = (socket: WebSocket, filters: SignalStatisticsFilters | undefined): void => {
  send(socket, {
    type: "signal_statistics",
    generatedAt: Date.now(),
    payload: {
      summary: signalStatisticsService.getSummary(filters),
      byType: signalStatisticsService.getByType(filters),
      bySetupType: signalStatisticsService.getBySetupType(filters),
      byOpportunityVerdict: signalStatisticsService.getByOpportunityVerdict(filters),
      byDoNotTradeAction: signalStatisticsService.getByDoNotTradeAction(filters),
      byDoNotTradeSeverity: signalStatisticsService.getByDoNotTradeSeverity(filters),
      byAlertPriority: signalStatisticsService.getByAlertPriority(filters),
      bySymbol: signalStatisticsService.getBySymbol(filters),
      bySource: signalStatisticsService.getBySource(filters),
      recentOutcomes: signalStatisticsService.getRecentOutcomes(filters)
    }
  });
};

const sendSignalReplay = (socket: WebSocket, signalId: string): void => {
  const replay = signalRepository.getSignalReplay(signalId);

  send(socket, {
    type: "signal_replay",
    generatedAt: Date.now(),
    payload: replay,
    ...(replay ? {} : { error: "Signal not found" })
  });
};

const sendDecisionChain = (
  socket: WebSocket,
  payload: Extract<ClientMessage, { type: "request_decision_chain" }>["payload"]
): void => {
  try {
    send(socket, {
      type: "decision_chain_snapshot",
      generatedAt: Date.now(),
      payload: reconstructDecisionChain(payload)
    });
  } catch (error) {
    send(socket, {
      type: "decision_chain_error",
      generatedAt: Date.now(),
      payload: {
        code: "DECISION_CHAIN_RECONSTRUCTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Decision chain reconstruction failed."
      }
    });
  }
};

const sendDecisionReplay = (
  socket: WebSocket,
  payload: Extract<ClientMessage, { type: "request_decision_replay" }>["payload"]
): void => {
  try {
    send(socket, {
      type: "decision_replay_payload",
      generatedAt: Date.now(),
      payload: buildDecisionReplay(payload)
    });
  } catch (error) {
    send(socket, {
      type: "decision_replay_error",
      generatedAt: Date.now(),
      payload: {
        code: "DECISION_REPLAY_BUILD_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Decision replay could not be built."
      }
    });
  }
};

const sendKnowledgeLayerSnapshot = (
  socket: WebSocket,
  payload: Extract<ClientMessage, { type: "request_knowledge_layer" }>["payload"]
): void => {
  try {
    send(socket, {
      type: "knowledge_layer_snapshot",
      generatedAt: Date.now(),
      payload: buildKnowledgeLayerSnapshot(payload)
    });
  } catch (error) {
    send(socket, {
      type: "knowledge_layer_error",
      generatedAt: Date.now(),
      payload: {
        code: "KNOWLEDGE_LAYER_BUILD_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Knowledge layer snapshot could not be built."
      }
    });
  }
};

const sendJournalEntries = (
  socket: WebSocket,
  filters: JournalEntryFilters | undefined
): void => {
  send(socket, {
    type: "journal_entries",
    generatedAt: Date.now(),
    payload: signalRepository.listJournalEntries(filters)
  });
};

const sendJournalAnalytics = (
  socket: WebSocket,
  filters: JournalAnalyticsFilters | undefined
): void => {
  send(socket, {
    type: "journal_analytics",
    generatedAt: Date.now(),
    payload: journalAnalyticsService.getJournalAnalytics(filters)
  });
};

const sendLearningReport = (
  socket: WebSocket,
  filters: LearningReportFilters | undefined
): void => {
  const payload = learningEngine.getLearningReport(filters);

  send(socket, {
    type: "learning_report",
    generatedAt: payload.generatedAt,
    payload
  });
};

const buildBaseFrameForClient = (client: ClientContext) =>
  engine.buildFrame({
    settings: client.settings,
    watchlist: client.watchlist,
    manualActiveTrades: client.manualActiveTrades,
    accountActiveTrades: client.accountActiveTrades,
    phase,
    phaseMessage,
    streamHealth: streamManager.getHealth(),
    accountStream: client.accountStreamManager.getHealth()
  });

const sendJournalError = (socket: WebSocket, error: unknown): void => {
  send(socket, {
    type: "journal_error",
    generatedAt: Date.now(),
    error: error instanceof Error ? error.message : "Journal request failed"
  });
};

const sendPositionSizing = async (
  socket: WebSocket,
  client: ClientContext,
  payload: {
    symbol: string;
    direction?: string;
    entryPrice?: number | null;
    stopDistancePct?: number | null;
    customEquityUsdt?: number | null;
    riskPerTradePct?: number | null;
  }
): Promise<void> => {
  const symbol = payload.symbol.trim().toUpperCase();
  const baseFrame = buildBaseFrameForClient(client);
  const row = baseFrame.rows.find((item) => item.symbol === symbol) ?? null;
  const risk = client.riskEngine.getSnapshot().state;
  const account = client.accountStreamManager.getRiskSnapshot();
  const exchangeFilters = await getExchangeFilterMap(config.binanceRestBase).catch((error) => {
    console.warn("Could not load Binance exchange filters for position sizing request", error);
    return null;
  });

  const direction = payload.direction === "long" || payload.direction === "short" ? payload.direction : "unknown";
  const features = {
    row,
    risk,
    account
  };
  const positionSizing = positionSizingEngine.evaluate({
    symbol,
    direction,
    entryPrice: payload.entryPrice ?? row?.markPrice ?? row?.lastPrice ?? null,
    stopDistancePct: payload.stopDistancePct ?? null,
    customEquityUsdt: payload.customEquityUsdt ?? null,
    customRiskPerTradePct: payload.riskPerTradePct ?? null,
    defaultEquityUsdt: config.positionSizingDefaultEquityUsdt,
    features,
    account,
    risk,
    exchangeFilters
  });
  const doNotTrade = doNotTradeEngine.evaluate({
    symbol,
    direction,
    positionSizing,
    features,
    account,
    risk
  });
  const generatedAt = Date.now();
  const safeToAdd = buildRiskAuthoritySafeToAddResult({
    symbol,
    direction,
    side: direction === "long" ? "BUY" : direction === "short" ? "SELL" : null,
    generatedAt,
    sizing: positionSizing,
    doNotTrade,
    checks: []
  });

  send(socket, {
    type: "position_sizing",
    generatedAt,
    payload: {
      ...positionSizing,
      doNotTrade,
      safeToAdd
    }
  });
};

const sendTradeDecisionContextError = (
  socket: WebSocket,
  input: { id?: string | null | undefined; code: string; message: string }
): void => {
  send(socket, {
    type: "trade_decision_context_error",
    generatedAt: Date.now(),
    payload: {
      ...(input.id !== undefined ? { id: input.id } : {}),
      code: input.code,
      message: input.message
    }
  });
};

const sendDecisionContextResponse = (
  socket: WebSocket,
  response: DecisionContextResponse
): void => {
  console.log("DECISION_PROTOCOL_RESPONSE", response);
  send(socket, {
    type: "decision_context_response",
    generatedAt: Date.now(),
    payload: response
  });
};

const createTradeDecisionContextFromMessage = (
  socket: WebSocket,
  client: ClientContext,
  payload: Extract<ClientMessage, { type: "create_trade_decision_context" }>["payload"]
): void => {
  try {
    const validation = decisionContextValidator.validateIncomingCommand(payload);
    if (!validation.command) {
      const response: DecisionContextResponse = {
        status: "REJECTED",
        reason: "DECISION_CONTEXT_VALIDATION_FAILED",
        signalState: "MISSING",
        validationErrors: validation.validationErrors
      };
      sendDecisionContextResponse(socket, response);
      sendTradeDecisionContextError(socket, {
        code: "TRADE_DECISION_CONTEXT_REJECTED",
        message: validation.validationErrors.join(", ") || "Decision context command rejected."
      });
      return;
    }

    const response = decisionContextService.buildTradeDecisionContext({
      symbol: validation.command.symbol,
      intent: validation.command.intent,
      ...(validation.command.notes ? { notes: validation.command.notes } : {}),
      ...(validation.command.preflightId ? { preflightId: validation.command.preflightId } : {}),
      source: "manual",
      risk: client.riskEngine.getSnapshot(),
      account: client.accountStreamManager.getRiskSnapshot()
    });
    sendDecisionContextResponse(socket, response);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "TradeDecisionContext could not be created.";
    const response: DecisionContextResponse = {
      status: "REJECTED",
      reason: "TRADE_DECISION_CONTEXT_CREATE_FAILED",
      signalState: "MISSING",
      validationErrors: [message]
    };
    sendDecisionContextResponse(socket, response);
    sendTradeDecisionContextError(socket, {
      code: "TRADE_DECISION_CONTEXT_CREATE_FAILED",
      message
    });
  }
};

const buildOrderPreflightSafeToAdd = async (input: {
  client: ClientContext;
  symbol: string;
  side: "BUY" | "SELL";
  validation: Awaited<ReturnType<BinanceOrderService["validateOrderPreflight"]>>;
  row: ScreenerRow | null;
  generatedAt: number;
}): Promise<SafeToAddResult> => {
  const risk = input.client.riskEngine.getSnapshot().state;
  const account = input.client.accountStreamManager.getRiskSnapshot();
  const exchangeFilters = await getExchangeFilterMap(config.binanceRestBase).catch(() => null);
  const direction = input.side === "BUY" ? "long" : "short";
  const features = {
    row: input.row,
    risk,
    account
  };
  const positionSizing = positionSizingEngine.evaluate({
    symbol: input.symbol,
    direction,
    entryPrice: input.row?.markPrice ?? input.row?.lastPrice ?? null,
    stopDistancePct: null,
    customEquityUsdt: null,
    customRiskPerTradePct: null,
    defaultEquityUsdt: config.positionSizingDefaultEquityUsdt,
    features,
    account,
    risk,
    exchangeFilters
  });
  const doNotTrade = doNotTradeEngine.evaluate({
    symbol: input.symbol,
    direction,
    positionSizing,
    features,
    account,
    risk
  });

  return buildRiskAuthoritySafeToAddResult({
    symbol: input.symbol,
    direction,
    side: input.side,
    generatedAt: input.generatedAt,
    sizing: positionSizing,
    doNotTrade,
    checks: input.validation.checks
  });
};

const broadcastJournalAutoEvent = (event: AutoJournalEvent): void => {
  for (const client of clients.values()) {
    send(client.socket, {
      type: "journal_auto_event",
      generatedAt: Date.now(),
      payload: {
        event: event.event,
        journalEntry: event.journalEntry
      }
    });
  }
};

const observeAutoJournalPositions = (clientId: string): void => {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  for (const event of autoJournalService.observe(client.accountStreamManager.getRiskSnapshot())) {
    broadcastJournalAutoEvent(event);
  }
};

const findRowBySymbol = (rows: ScreenerRow[], symbol: string): ScreenerRow | null => {
  const normalized = symbol.trim().toUpperCase();
  return rows.find((row) => row.symbol === normalized) ?? null;
};

const recordRiskSignals = (riskAlerts: ScreenerAlert[], frame: ScreenerFrame): void => {
  for (const alert of riskAlerts) {
    const row = findRowBySymbol(frame.rows, alert.symbol);

    signalEventWriter.recordSignal({
      id: alert.id,
      symbol: alert.symbol,
      type: "risk",
      severity: alert.severity,
      source: "risk_engine",
      price: row?.lastPrice ?? null,
      score: alert.notionalUsd,
      payload: alert,
      features: {
        row,
        risk: frame.risk,
        metaRegimeGovernor: frame.metaRegimeGovernor,
        positionRiskOrchestrator: frame.positionRiskOrchestrator,
        regimePrediction: frame.regimePrediction,
        accountStream: frame.status.accountStream
      }
    });
  }
};

const resolveAlertSource = (alert: ScreenerAlert): string => {
  if (alert.kind === "reviving_coin") {
    return "reviving_coin_detector";
  }

  if (alert.kind === "liquidation") {
    return "liquidation_alert_engine";
  }

  if (alert.kind === "tape") {
    return "tape_alert_engine";
  }

  return "screener_engine";
};

const recordScreenerSignals = (alerts: ScreenerAlert[], frame: ScreenerFrame): void => {
  for (const alert of alerts) {
    const row = findRowBySymbol(frame.rows, alert.symbol);

    signalEventWriter.recordSignal({
      id: alert.id,
      symbol: alert.symbol,
      type: alert.kind ?? "screener",
      severity: alert.severity,
      source: resolveAlertSource(alert),
      price: row?.lastPrice ?? null,
      score: alert.notionalUsd,
      payload: alert,
      features: {
        row,
        overview: frame.overview,
        risk: frame.risk,
        marketFlow: frame.marketFlow?.find((item) => item.symbol === alert.symbol) ?? null,
        liquidations: frame.liquidations?.bySymbol[alert.symbol] ?? null,
        funding: frame.funding.find((item) => item.symbol === alert.symbol) ?? null,
        metaRegimeGovernor: frame.metaRegimeGovernor,
        positionRiskOrchestrator: frame.positionRiskOrchestrator,
        regimePrediction: frame.regimePrediction
      }
    });
  }
};

const persistUnifiedSignals = (signals: UnifiedSignalEvent[] | undefined): void => {
  if (!signals?.length) {
    return;
  }

  for (const signal of signals) {
    try {
      unifiedSignalRepository.upsertUnifiedSignal(signal);
    } catch (error) {
      console.warn("Could not persist unified signal", error);
    }
  }
};

const recordSignalIntelligenceSignals = (
  signalIntelligence: SignalIntelligenceState[],
  frame: ScreenerFrame
): void => {
  for (const signal of signalIntelligence) {
    const shouldPersist =
      signal.marketState === "STABLE_TREND" ||
      signal.marketState === "DISORDER" ||
      signal.adjustedSystemConfidence >= 70 ||
      signal.sdp >= 0.75;

    if (!shouldPersist) {
      continue;
    }

    const row = findRowBySymbol(frame.rows, signal.symbol);
    const severity = signal.marketState === "DISORDER" || signal.sdp >= 0.85 ? "high" : "info";

    signalEventWriter.recordSignal({
      symbol: signal.symbol,
      type: "signal_intelligence",
      severity,
      source: "signal_intelligence_engine",
      price: row?.lastPrice ?? null,
      score: signal.adjustedSystemConfidence,
      payload: signal,
      features: {
        row,
        risk: frame.risk,
        regime: frame.regime?.find((item) => item.symbol === signal.symbol) ?? null,
        execution: frame.execution?.find((item) => item.symbol === signal.symbol) ?? null,
        conflict: frame.conflict?.find((item) => item.symbol === signal.symbol) ?? null,
        allocation: frame.allocation?.find((item) => item.symbol === signal.symbol) ?? null,
        metaRegimeGovernor: frame.metaRegimeGovernor,
        positionRiskOrchestrator: frame.positionRiskOrchestrator,
        regimePrediction: frame.regimePrediction
      }
    });
  }
};

const normalizeVisibleSections = (sections: unknown): Set<string> =>
  new Set(
    (Array.isArray(sections) ? sections : [])
      .map((section) => (typeof section === "string" ? section.trim() : ""))
      .filter(Boolean)
  );

const supportedTransportCapabilities = new Set<FrameTransportCapability>([
  "compact_frame_transport_v1"
]);

const normalizeTransportCapabilities = (value: unknown): Set<FrameTransportCapability> =>
  new Set(
    (Array.isArray(value) ? value : [])
      .map((capability) => (typeof capability === "string" ? capability.trim() : ""))
      .filter(
        (capability): capability is FrameTransportCapability =>
          supportedTransportCapabilities.has(capability as FrameTransportCapability)
      )
  );

const normalizeSocketAddress = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/, "");

const isLoopbackAddress = (value: string | undefined): boolean => {
  const normalized = normalizeSocketAddress(value);
  return normalized === "127.0.0.1" || normalized === "::1";
};

const isTrustedLocalOrigin = (origin: string | undefined): boolean => {
  if (!origin?.trim()) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = normalizeSocketAddress(parsed.hostname);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
};

const shouldAllowEnvironmentAccountAccess = (request: http.IncomingMessage): boolean => {
  if (!config.apiKey || !config.apiSecret) {
    return false;
  }

  if (isDesktopAlertMonitorRequest(request)) {
    return false;
  }

  if (config.allowRemoteEnvBinanceAccountAccess) {
    return true;
  }

  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    return false;
  }

  const originHeader = request.headers.origin;
  const origin = typeof originHeader === "string" ? originHeader : "";

  return !origin || isTrustedLocalOrigin(origin);
};

const shouldAllowTrustedLocalRequest = (request: http.IncomingMessage): boolean => {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    return false;
  }

  const originHeader = request.headers.origin;
  const origin = typeof originHeader === "string" ? originHeader : "";

  return !origin || isTrustedLocalOrigin(origin);
};

const shouldAllowTtsAccess = (request: http.IncomingMessage): boolean =>
  config.allowRemoteTtsAccess || shouldAllowTrustedLocalRequest(request);

const shouldAllowDiagnosticHealthAccess = (request: http.IncomingMessage): boolean =>
  config.allowRemoteDiagnosticHealth || shouldAllowTrustedLocalRequest(request);

const isValidOrderControlToken = (value: unknown): boolean =>
  typeof value === "string" &&
  value.length > 0 &&
  config.orderControlToken.length > 0 &&
  value === config.orderControlToken;

const orderControlAuthRequiredFor = (
  request: http.IncomingMessage,
  paperMode: boolean
): boolean => {
  if (!config.orderControlAuthRequired) {
    return false;
  }

  if (
    paperMode &&
    config.orderControlAllowLoopbackPaper &&
    shouldAllowTrustedLocalRequest(request)
  ) {
    return false;
  }

  return true;
};

const sendOrderControlAuthFailed = (
  socket: WebSocket,
  intentId: string | null,
  action: string,
  sourceWindowId: string | null
): void => {
  const timestamp = Date.now();

  send(socket, {
    type: "order_error",
    generatedAt: timestamp,
    payload: {
      intentId,
      code: "ORDER_CONTROL_AUTH_FAILED",
      message: "ORDER_CONTROL_AUTH_FAILED: valid order control token is required.",
      retriable: false
    }
  });

  send(socket, {
    type: "order_audit_event",
    generatedAt: timestamp,
    payload: {
      auditId: `order-control-auth-failed:${timestamp}:${intentId ?? action}`,
      orderId: "ORDER_CONTROL",
      intentId,
      timestamp,
      symbol: "CONTROL",
      side: "BUY",
      orderType: "MARKET",
      quantity: 0,
      price: null,
      clientOrderId: "ORDER_CONTROL",
      status: "REJECTED",
      sourceWindowId,
      dryRun: false,
      eventType: "ORDER_CONTROL_AUTH_FAILED",
      message: "Order control message rejected before execution."
    }
  });
};

const getRequestPathname = (requestUrl: string | undefined): string => {
  try {
    return new URL(requestUrl ?? "", "http://127.0.0.1").pathname;
  } catch {
    return requestUrl ?? "";
  }
};

const isDesktopAlertMonitorRequest = (request: http.IncomingMessage): boolean => {
  try {
    const parsed = new URL(request.url ?? "", "http://127.0.0.1");
    return parsed.searchParams.get("client") === "desktop-alert-monitor";
  } catch {
    return false;
  }
};

const clearBootstrapRetryWait = (): void => {
  if (bootstrapRetryTimer) {
    clearTimeout(bootstrapRetryTimer);
    bootstrapRetryTimer = null;
  }

  if (bootstrapRetryResolve) {
    const resolve = bootstrapRetryResolve;
    bootstrapRetryResolve = null;
    resolve();
  }
};

const waitForBootstrapRetry = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    bootstrapRetryResolve = resolve;
    bootstrapRetryTimer = setTimeout(() => {
      bootstrapRetryTimer = null;
      bootstrapRetryResolve = null;
      resolve();
    }, delayMs);
  });

const streamManager = new BinanceStreamManager(config.binanceWsBase, {
  onTickerBatch: (events) => {
    engine.applyTickerBatch(events);
    paperProtectiveOrderService?.handleMarketPriceBatch(
      events.map((event) => ({
        symbol: event.s,
        lastPrice: Number(event.c)
      }))
    );
  },
  onMarkPriceBatch: (events) => {
    engine.applyMarkPriceBatch(events);
    paperProtectiveOrderService?.handleMarketPriceBatch(
      events.map((event) => ({
        symbol: event.s,
        markPrice: Number(event.p)
      }))
    );
  },
  onAggTrade: (event) => {
    engine.applyAggTrade(event);
    marketFlowEngine.applyAggTrade(event);
  },
  onBookTicker: (event) => engine.applyBookTicker(event),
  onLiquidation: (event) => {
    engine.applyLiquidation(event);
    liquidationEngine.applyEvent(event);
  },
  onKline: (event) => {
    engine.applyKline(event);
  },
  onStatus: (message) => {
    phaseMessage = message;
  }
});

const addResolvedSections = (
  requestedSections: Set<string>,
  visibleSections: ReadonlySet<string> | null
): void => {
  const projection = resolveRequestedSections(visibleSections);

  for (const section of projection.requestedSections) {
    requestedSections.add(section);
  }

  for (const section of projection.sections) {
    requestedSections.add(section);
  }
};

const resolveGlobalFrameBuildContext = (): FrameBuildContext => {
  const requestedSections = new Set<string>();
  let terminalClientCount = 0;

  for (const client of clients.values()) {
    if (client.socket.readyState !== WebSocket.OPEN || client.kind !== "terminal") {
      continue;
    }

    terminalClientCount += 1;
    addResolvedSections(requestedSections, client.visibleSections ?? safeDefaultVisibleSections);
  }

  if (terminalClientCount === 0) {
    addResolvedSections(requestedSections, safeDefaultVisibleSections);
  }

  return {
    requestedSections,
    hasAnyClientFor: (section) => requestedSections.has(section)
  };
};

const resolveClientFrameBuildContext = (client: ClientContext): FrameBuildContext => {
  const requestedSections = new Set<string>();
  const fallbackSections =
    client.kind === "desktop-alert-monitor"
      ? safeAlertMonitorVisibleSections
      : safeDefaultVisibleSections;

  addResolvedSections(requestedSections, client.visibleSections ?? fallbackSections);

  return {
    requestedSections,
    hasAnyClientFor: (section) => requestedSections.has(section)
  };
};

const getClientSectionCache = (client: ClientContext): Map<string, SectionCacheEntry<unknown>> => {
  const existing = heavySectionCacheByClient.get(client);

  if (existing) {
    return existing;
  }

  const nextCache = new Map<string, SectionCacheEntry<unknown>>();
  heavySectionCacheByClient.set(client, nextCache);
  return nextCache;
};

const trackSkippedComputeSections = (telemetry: FrameComputeTelemetry): void => {
  const computed = new Set(telemetry.computedSections);
  telemetry.skippedComputeSections = Array.from(heavyComputeSections)
    .filter((section) => !computed.has(section))
    .sort();
};

const buildFrame = (client: ClientContext, context = resolveGlobalFrameBuildContext()) => {
  const frameBuildStartedAt = Date.now();
  const frameBuildStagesMs = {
    rawAssembly: 0,
    rowsProjection: 0,
    compactEncoding: 0,
    deltaDiff: 0,
    telemetryMeasurement: 0,
    postBuildObservers: 0,
    sendPrep: 0
  };
  const computeTelemetry: FrameComputeTelemetry = {
    computedSections: [],
    skippedComputeSections: [],
    sectionComputeMs: {},
    sectionCacheStatus: {},
    sectionCacheAgeMs: {},
    sectionCacheTtlMs: {},
    skippedByTtlSections: []
  };
  const clientSectionCache = getClientSectionCache(client);
  const getFreshCache = <T>(section: string, now = Date.now()): SectionCacheEntry<T> | null => {
    const cached = clientSectionCache.get(section) as SectionCacheEntry<T> | undefined;
    return cached && cached.expiresAt > now ? cached : null;
  };
  const hasFreshCache = (section: string): boolean => Boolean(getFreshCache(section));
  const computeSection = <T>(section: string, builder: () => T): T => {
    const startedAt = Date.now();
    const value = builder();
    computeTelemetry.computedSections.push(section);
    computeTelemetry.sectionComputeMs[section] = Date.now() - startedAt;
    computeTelemetry.sectionCacheStatus[section] ??= "uncached";
    return value;
  };
  const computeCachedSection = <T>(section: string, builder: () => T): T => {
    const now = Date.now();
    const cached = getFreshCache<T>(section, now);
    const ttlMs = sectionCacheTtlMs.get(section);

    if (ttlMs && ttlMs > 0) {
      computeTelemetry.sectionCacheTtlMs[section] = ttlMs;
    }

    if (cached) {
      computeTelemetry.sectionComputeMs[section] = 0;
      computeTelemetry.sectionCacheStatus[section] = "hit";
      computeTelemetry.sectionCacheAgeMs[section] = Math.max(now - cached.createdAt, 0);
      computeTelemetry.skippedByTtlSections.push(section);
      return cached.value;
    }

    computeTelemetry.sectionCacheStatus[section] = ttlMs && ttlMs > 0 ? "miss" : "uncached";
    computeTelemetry.sectionCacheAgeMs[section] = 0;
    const value = computeSection(section, builder);

    if (ttlMs && ttlMs > 0) {
      clientSectionCache.set(section, {
        createdAt: now,
        expiresAt: now + ttlMs,
        value
      });
    }

    return value;
  };
  const computeCachedOptionalSection = <T>(
    section: string,
    canBuild: boolean,
    builder: () => T
  ): T | undefined => {
    const cached = getFreshCache<T>(section);
    const ttlMs = sectionCacheTtlMs.get(section);

    if (ttlMs && ttlMs > 0) {
      computeTelemetry.sectionCacheTtlMs[section] = ttlMs;
    }

    if (cached) {
      const now = Date.now();
      computeTelemetry.sectionComputeMs[section] = 0;
      computeTelemetry.sectionCacheStatus[section] = "hit";
      computeTelemetry.sectionCacheAgeMs[section] = Math.max(now - cached.createdAt, 0);
      computeTelemetry.skippedByTtlSections.push(section);
      return cached.value;
    }

    computeTelemetry.sectionCacheStatus[section] = ttlMs && ttlMs > 0 ? "miss" : "uncached";
    computeTelemetry.sectionCacheAgeMs[section] = 0;
    if (!canBuild) {
      return undefined;
    }

    return computeCachedSection(section, builder);
  };
  const wants = (section: string): boolean => context.hasAnyClientFor(section);
  const rawAssemblyStartedAt = Date.now();
  const frame = engine.buildFrame({
    settings: {
      ...client.settings,
      revivingCoins: globalSettings.revivingCoins,
      volumeMilestones: globalSettings.volumeMilestones
    },
    watchlist: client.watchlist,
    manualActiveTrades: client.manualActiveTrades,
    accountActiveTrades: client.accountActiveTrades,
    phase,
    phaseMessage,
    streamHealth: streamManager.getHealth(),
    accountStream: client.accountStreamManager.getHealth()
  });
  const rawAssemblyDiagnostics = frame.rawAssemblyDiagnostics;
  delete frame.rawAssemblyDiagnostics;
  frameBuildStagesMs.rawAssembly = Date.now() - rawAssemblyStartedAt;

  const rowsProjectionStartedAt = Date.now();
  const riskPayload = client.riskEngine.sync({
    account: client.accountStreamManager.getRiskSnapshot(),
    accountStream: frame.status.accountStream,
    rows: frame.rows,
    market: engine.getLatestMarketRiskSnapshot()
  });
  frameBuildStagesMs.rowsProjection = Date.now() - rowsProjectionStartedAt;

  const riskAlerts: ScreenerAlert[] = riskPayload.state.alerts.map((alert) => ({
    id: alert.id,
    symbol: alert.symbol ?? "RISK",
    kind: "risk",
    bias:
      alert.code === "flow_divergence"
        ? riskPayload.state.flow.directionalBias
        : alert.code === "liquidation_distance"
          ? "SHORT"
          : "NEUTRAL",
    reason: alert.message,
    severity: alert.severity,
    notionalUsd: Math.abs(alert.value ?? 0),
    createdAt: alert.createdAt
  }));

  const funding = computeSection("funding", () => fundingEngine.build(frame.rows));
  const needsFundingSorted = wants("fundingSorted") || wants("fundingBasis");
  const needsPositionRiskOrchestrator = wants("positionRiskOrchestrator");
  const needsPositionRiskOrchestratorBuild =
    needsPositionRiskOrchestrator && !hasFreshCache("positionRiskOrchestrator");
  const needsRegimeFeedbackCalibration = wants("regimeFeedbackCalibration");
  const needsRegimePrediction =
    wants("regimePrediction") ||
    needsPositionRiskOrchestratorBuild ||
    needsRegimeFeedbackCalibration;
  const needsRegimePredictionBuild = needsRegimePrediction && !hasFreshCache("regimePrediction");
  const needsRegimeMemory = wants("regimeMemory") || needsRegimePredictionBuild;
  const needsRegimeMemoryBuild = needsRegimeMemory && !hasFreshCache("regimeMemory");
  const needsMetaRegimeGovernor =
    wants("metaRegimeGovernor") ||
    needsPositionRiskOrchestratorBuild ||
    needsRegimeMemoryBuild ||
    needsRegimePredictionBuild ||
    needsRegimeFeedbackCalibration;
  const needsMetaRegimeGovernorBuild =
    needsMetaRegimeGovernor && !hasFreshCache("metaRegimeGovernor");
  const needsSignalIntelligence =
    wants("signalIntelligence") ||
    needsMetaRegimeGovernorBuild ||
    needsPositionRiskOrchestratorBuild ||
    needsRegimeMemoryBuild ||
    needsRegimePredictionBuild;
  const needsAllocation =
    wants("allocation") ||
    needsMetaRegimeGovernorBuild ||
    needsPositionRiskOrchestratorBuild ||
    needsRegimePredictionBuild;
  const needsConflict =
    wants("conflict") ||
    needsAllocation ||
    needsSignalIntelligence ||
    needsMetaRegimeGovernorBuild ||
    needsPositionRiskOrchestratorBuild ||
    needsRegimeMemoryBuild ||
    needsRegimePredictionBuild;
  const needsExecution =
    wants("execution") ||
    needsConflict ||
    needsAllocation ||
    needsSignalIntelligence ||
    needsMetaRegimeGovernorBuild ||
    needsPositionRiskOrchestratorBuild ||
    needsRegimeMemoryBuild ||
    needsRegimePredictionBuild ||
    needsRegimeFeedbackCalibration;
  const needsRegimeLearning =
    wants("regimeLearning") ||
    needsExecution ||
    needsConflict ||
    needsAllocation ||
    needsSignalIntelligence ||
    needsMetaRegimeGovernorBuild ||
    needsRegimeMemoryBuild ||
    needsRegimePredictionBuild;
  const needsRegime =
    wants("regime") ||
    needsRegimeLearning ||
    needsExecution ||
    needsConflict ||
    needsAllocation ||
    needsSignalIntelligence ||
    needsMetaRegimeGovernorBuild ||
    needsPositionRiskOrchestratorBuild ||
    needsRegimeMemoryBuild ||
    needsRegimePredictionBuild ||
    needsRegimeFeedbackCalibration;
  const needsMarketFlow =
    wants("marketFlow") ||
    wants("liquidations") ||
    needsRegime ||
    needsRegimeLearning ||
    needsSignalIntelligence ||
    needsMetaRegimeGovernorBuild ||
    needsRegimeMemoryBuild ||
    needsRegimePredictionBuild;
  const needsPortfolioAnalytics =
    wants("portfolioAnalytics") ||
    wants("account") ||
    wants("pnlAttribution") ||
    wants("correlationHeatmap") ||
    wants("varPanel");

  const fundingSorted = needsFundingSorted
    ? computeCachedSection("fundingSorted", () => fundingEngine.buildSortedViews(funding))
    : undefined;
  const chartSymbols = [
    ...frame.status.focusSymbols,
    ...summarizeSelectedChartSymbols(frame.generatedAt)
  ].filter((symbol, index, symbols) => symbols.indexOf(symbol) === index);
  const chartCandles = wants("chartCandles")
    ? computeSection("chartCandles", () => engine.buildMiniCandleSeries(chartSymbols))
    : undefined;
  const marketFlow = needsMarketFlow
    ? computeSection("marketFlow", () => marketFlowEngine.build(frame.status.focusSymbols))
    : undefined;
  const liquidations = needsMarketFlow
    ? computeSection("liquidations", () => liquidationAggregator.build())
    : undefined;
  const portfolioAnalytics = needsPortfolioAnalytics
    ? computeCachedSection("portfolioAnalytics", () =>
        portfolioAnalyticsEngine.build({
          rows: frame.rows,
          account: client.accountStreamManager.getRiskSnapshot(),
          generatedAt: frame.generatedAt
        })
      )
    : undefined;
  const regime =
    needsRegime && marketFlow && liquidations
      ? computeSection("regime", () =>
          unifiedRegimeEngine.build({
            rows: frame.rows,
            funding,
            marketFlow,
            liquidations
          })
        )
      : undefined;
  const regimeLearning =
    needsRegimeLearning && regime
      ? computeCachedSection("regimeLearning", () =>
          regimeLearningEngine.build({
            regime,
            rows: frame.rows,
            generatedAt: frame.generatedAt
          })
        )
      : undefined;
  const execution =
    needsExecution && regime && regimeLearning
      ? computeSection("execution", () =>
          executionIntelligenceEngine.build({
            regime,
            regimeLearning,
            rows: frame.rows
          })
        )
      : undefined;
  const conflict =
    needsConflict && regime && regimeLearning && execution
      ? computeSection("conflict", () =>
          signalConflictEngine.build({
            regime,
            regimeLearning,
            execution,
            rows: frame.rows
          })
        )
      : undefined;
  const allocation =
    needsAllocation && execution && regime && regimeLearning && conflict
      ? computeSection("allocation", () =>
          portfolioAllocationEngine.build({
            execution,
            regime,
            regimeLearning,
            conflict
          })
        )
      : undefined;
  const signalIntelligence =
    needsSignalIntelligence &&
    marketFlow &&
    liquidations &&
    regime &&
    regimeLearning &&
    execution &&
    conflict &&
    allocation
      ? computeSection("signalIntelligence", () =>
          signalIntelligenceEngine.build({
            rows: frame.rows,
            funding,
            marketFlow,
            liquidations,
            regime,
            regimeLearning,
            execution,
            conflict,
            allocation
          })
        )
      : undefined;
  const metaRegimeGovernor = needsMetaRegimeGovernor
    ? computeCachedOptionalSection(
        "metaRegimeGovernor",
        Boolean(
          signalIntelligence &&
            regime &&
            regimeLearning &&
            execution &&
            conflict &&
            allocation &&
            marketFlow &&
            liquidations
        ),
        () =>
          metaRegimeGovernorEngine.build({
            generatedAt: frame.generatedAt,
            signalIntelligence: signalIntelligence!,
            regime: regime!,
            regimeLearning,
            execution: execution!,
            conflict: conflict!,
            allocation: allocation!,
            marketFlow: marketFlow!,
            funding,
            risk: riskPayload.state,
            liquidations: liquidations!
          })
      )
    : undefined;
  const regimeMemory = needsRegimeMemory
    ? computeCachedOptionalSection(
        "regimeMemory",
        Boolean(
          marketFlow &&
            regime &&
            regimeLearning &&
            execution &&
            conflict &&
            signalIntelligence &&
            metaRegimeGovernor
        ),
        () =>
          regimeMemoryEngine.build({
            generatedAt: frame.generatedAt,
            rows: frame.rows,
            funding,
            marketFlow: marketFlow!,
            regime: regime!,
            regimeLearning,
            execution: execution!,
            conflict: conflict!,
            signalIntelligence: signalIntelligence!,
            metaRegimeGovernor: metaRegimeGovernor!
          })
      )
    : undefined;
  const regimePrediction = needsRegimePrediction
    ? computeCachedOptionalSection(
        "regimePrediction",
        Boolean(
          marketFlow &&
            regime &&
            regimeLearning &&
            execution &&
            conflict &&
            allocation &&
            signalIntelligence &&
            metaRegimeGovernor &&
            regimeMemory
        ),
        () =>
          regimePredictionEngine.build({
            generatedAt: frame.generatedAt,
            rows: frame.rows,
            funding,
            marketFlow: marketFlow!,
            regime: regime!,
            regimeLearning,
            execution: execution!,
            conflict: conflict!,
            allocation: allocation!,
            signalIntelligence: signalIntelligence!,
            metaRegimeGovernor: metaRegimeGovernor!,
            regimeMemory: regimeMemory!,
            risk: riskPayload.state
          })
      )
    : undefined;
  const positionRiskOrchestrator = needsPositionRiskOrchestrator
    ? computeCachedOptionalSection(
        "positionRiskOrchestrator",
        Boolean(
          execution &&
            allocation &&
            conflict &&
            signalIntelligence &&
            metaRegimeGovernor &&
            regimePrediction
        ),
        () =>
          positionRiskOrchestratorEngine.build({
            generatedAt: frame.generatedAt,
            account: client.accountStreamManager.getRiskSnapshot(),
            risk: riskPayload.state,
            execution: execution!,
            allocation: allocation!,
            conflict: conflict!,
            signalIntelligence: signalIntelligence!,
            metaRegimeGovernor: metaRegimeGovernor!,
            regimePrediction: regimePrediction!,
            rows: frame.rows
          })
      )
    : undefined;
  const regimeFeedbackCalibration =
    wants("regimeFeedbackCalibration") &&
    regime &&
    execution &&
    metaRegimeGovernor &&
    regimePrediction
      ? computeSection("regimeFeedbackCalibration", () =>
          regimeFeedbackCalibrationEngine.build({
            generatedAt: frame.generatedAt,
            rows: frame.rows,
            regime,
            execution,
            metaRegimeGovernor,
            regimePrediction
          })
        )
      : undefined;

  if (portfolioAnalytics && (wants("pnlAttribution") || wants("correlationHeatmap") || wants("varPanel"))) {
    if (wants("pnlAttribution")) {
      computeTelemetry.computedSections.push("pnlAttribution");
      computeTelemetry.sectionComputeMs.pnlAttribution = computeTelemetry.sectionComputeMs.portfolioAnalytics ?? 0;
    }
    if (wants("correlationHeatmap")) {
      computeTelemetry.computedSections.push("correlationHeatmap");
      computeTelemetry.sectionComputeMs.correlationHeatmap = computeTelemetry.sectionComputeMs.portfolioAnalytics ?? 0;
    }
    if (wants("varPanel")) {
      computeTelemetry.computedSections.push("varPanel");
      computeTelemetry.sectionComputeMs.varPanel = computeTelemetry.sectionComputeMs.portfolioAnalytics ?? 0;
    }
  }

  if (wants("volumeMilestones")) {
    computeTelemetry.computedSections.push("volumeMilestones");
    computeTelemetry.sectionComputeMs.volumeMilestones = 0;
  }
  if (wants("volumeThresholdMilestones")) {
    computeTelemetry.computedSections.push("volumeThresholdMilestones");
    computeTelemetry.sectionComputeMs.volumeThresholdMilestones = 0;
  }
  trackSkippedComputeSections(computeTelemetry);

  const nextFrame: ScreenerFrame = {
    ...frame,
    risk: riskPayload.state,
    funding,
    alerts: [...riskAlerts, ...frame.alerts].slice(0, 50),
    unifiedSignals: (() => {
      const unifiedSignals: UnifiedSignalEvent[] = [
        ...riskAlerts.map(buildUnifiedSignalFromAlert),
        ...(frame.unifiedSignals ?? frame.alerts.map(buildUnifiedSignalFromAlert))
      ];

      const existingRawRefs = new Set(
        unifiedSignals.map((signal) => `${signal.source}:${signal.rawRef.collection}:${signal.rawRef.id}`)
      );

      for (const milestone of frame.volumeMilestones ?? []) {
        const signal = buildUnifiedSignalFromVolumeMilestone(milestone);
        const key = `${signal.source}:${signal.rawRef.collection}:${signal.rawRef.id}`;

        if (!existingRawRefs.has(key)) {
          existingRawRefs.add(key);
          unifiedSignals.push(signal);
        }
      }

      for (const milestone of frame.volumeThresholdMilestones ?? []) {
        const signal = buildUnifiedSignalFromVolumeThresholdMilestone(milestone);
        const key = `${signal.source}:${signal.rawRef.collection}:${signal.rawRef.id}`;

        if (!existingRawRefs.has(key)) {
          existingRawRefs.add(key);
          unifiedSignals.push(signal);
        }
      }

      return unifiedSignals.slice(0, 100);
    })()
  };
  persistUnifiedSignals(nextFrame.unifiedSignals);

  if (fundingSorted) nextFrame.fundingSorted = fundingSorted;
  if (chartCandles) nextFrame.chartCandles = chartCandles;
  if (marketFlow) nextFrame.marketFlow = marketFlow;
  if (liquidations) nextFrame.liquidations = liquidations;
  if (portfolioAnalytics) nextFrame.portfolioAnalytics = portfolioAnalytics;
  if (regime) nextFrame.regime = regime;
  if (regimeLearning) nextFrame.regimeLearning = regimeLearning;
  if (execution) nextFrame.execution = execution;
  if (conflict) nextFrame.conflict = conflict;
  if (allocation) nextFrame.allocation = allocation;
  if (signalIntelligence) nextFrame.signalIntelligence = signalIntelligence;
  if (metaRegimeGovernor) nextFrame.metaRegimeGovernor = metaRegimeGovernor;
  if (positionRiskOrchestrator) nextFrame.positionRiskOrchestrator = positionRiskOrchestrator;
  if (regimeMemory) nextFrame.regimeMemory = regimeMemory;
  if (regimePrediction) nextFrame.regimePrediction = regimePrediction;
  if (regimeFeedbackCalibration) nextFrame.regimeFeedbackCalibration = regimeFeedbackCalibration;

  if (!wants("volumeMilestones")) {
    delete nextFrame.volumeMilestones;
  }
  if (!wants("volumeThresholdMilestones")) {
    delete nextFrame.volumeThresholdMilestones;
  }

  if (wants("frameTelemetry") || wants("health")) {
    const telemetryMeasurementStartedAt = Date.now();
    nextFrame.frameTelemetry = frameTelemetryEngine.build(
      nextFrame as unknown as Record<string, unknown>,
      {
        frameBuildMs: Date.now() - frameBuildStartedAt,
        frameBuildStagesMs,
        frameSerializeMs: lastFrameSerializeMs,
        patchSizeBytes: lastPatchSizeBytes,
        requestedSections: Array.from(context.requestedSections).sort(),
        computedSections: Array.from(new Set(computeTelemetry.computedSections)).sort(),
        skippedComputeSections: computeTelemetry.skippedComputeSections,
        sectionComputeMs: computeTelemetry.sectionComputeMs,
        sectionCacheStatus: computeTelemetry.sectionCacheStatus,
        sectionCacheAgeMs: computeTelemetry.sectionCacheAgeMs,
        sectionCacheTtlMs: computeTelemetry.sectionCacheTtlMs,
        skippedByTtlSections: Array.from(new Set(computeTelemetry.skippedByTtlSections)).sort()
      }
    );
    if (rawAssemblyDiagnostics) {
      Object.assign(nextFrame.frameTelemetry, rawAssemblyDiagnostics);
    }
    const telemetryMeasurementMs = Date.now() - telemetryMeasurementStartedAt;
    nextFrame.frameTelemetry.frameBuildStagesMs.telemetryMeasurement = telemetryMeasurementMs;
    nextFrame.frameTelemetry.frameBuildMs = Date.now() - frameBuildStartedAt;
  }
  const postBuildObserversStartedAt = Date.now();
  recordScreenerSignals(frame.alerts, nextFrame);
  recordRiskSignals(riskAlerts, nextFrame);
  if (signalIntelligence) {
    recordSignalIntelligenceSignals(signalIntelligence, nextFrame);
  }
  signalEventWriter.observeMarketRows(nextFrame.rows);
  if (nextFrame.frameTelemetry) {
    nextFrame.frameTelemetry.frameBuildStagesMs.postBuildObservers =
      Date.now() - postBuildObserversStartedAt;
    nextFrame.frameTelemetry.frameBuildMs = Date.now() - frameBuildStartedAt;
  }

  return nextFrame;
};

const pollOpenInterestSnapshot = (): void => {
  if (!marketStreamsStarted || openInterestPollPromise) {
    return;
  }

  const symbols = computeCurrentFocusSymbols().slice(0, 30);
  if (symbols.length === 0) {
    return;
  }

  openInterestPollPromise = Promise.all(
    symbols.map(async (symbol) => {
      try {
        const snapshot = await fetchOpenInterest(config.binanceRestBase, symbol);
        engine.applyOpenInterest(symbol, Number(snapshot.openInterest), snapshot.time || Date.now());
        marketFlowEngine.applyOpenInterest(
          symbol,
          Number(snapshot.openInterest),
          snapshot.time || Date.now()
        );
      } catch (error) {
        console.warn(`Open interest poll failed for ${symbol}`, error);
      }
    })
  )
    .then(() => {
      broadcastFrame();
    })
    .finally(() => {
      openInterestPollPromise = null;
    });
};

const runRevivingCoinScan = (force = false): void => {
  if (!marketStreamsStarted || revivingCoinScanPromise) {
    return;
  }

  revivingCoinScanPromise = (async () => {
    const detections = await revivingCoinDetector.scanIfDue(
      engine.getLiquiditySnapshot(),
      globalSettings.revivingCoins,
      force
    );
    let pushed = false;

    for (const detection of detections) {
      if (engine.pushExternalAlert(detection.alertKey, detection.alert, detection.alert.createdAt)) {
        marketEventStore.recordRevivingCoinEvent(detection.event);
        pushed = true;
      }
    }

    if (pushed) {
      broadcastFrame();
    }
  })()
    .catch((error) => {
      console.warn("Reviving coin scan failed", error);
    })
    .finally(() => {
      revivingCoinScanPromise = null;
    });
};

const sendClientFrame = (clientId: string): void => {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  const fullFrame = buildFrame(client, resolveClientFrameBuildContext(client));
  sendClientProjectedFrame(client, fullFrame);
};

const sendClientProjectedFrame = (
  client: ClientContext,
  fullFrame: ScreenerFrame,
  broadcastStartedAt?: number,
  collectedFrameTelemetries?: FrameTelemetryState[]
): void => {
  if (client.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const payloadSuppressionStartedAt = Date.now();
  const clientFrame = payloadSuppressionEngine.build(fullFrame, client.visibleSections);
  const payloadSuppressionMs = Date.now() - payloadSuppressionStartedAt;

  const compactEncodingStartedAt = Date.now();
  const transportFrame = client.transportCapabilities.has("compact_frame_transport_v1")
    ? compactFrameForTransport(clientFrame.frame, frameTelemetryEngine)
    : clientFrame.frame;
  if (transportFrame.frameTelemetry) {
    transportFrame.frameTelemetry.frameBuildStagesMs.compactEncoding =
      Date.now() - compactEncodingStartedAt;
    transportFrame.frameTelemetry.frameBuildMs =
      Object.values(transportFrame.frameTelemetry.frameBuildStagesMs).reduce(
        (sum, value) => sum + value,
        0
      );
  }

  const deltaDiffStartedAt = Date.now();
  const deltaPayload = deltaFrameEngine.build(client.deltaFrameState, transportFrame, {
    forceSnapshot: client.forceSnapshotNext
  });

  const telemetry =
    "frame" in deltaPayload ? deltaPayload.frame.frameTelemetry : deltaPayload.changed.frameTelemetry;

  if ("frame" in deltaPayload && deltaPayload.frame.frameTelemetry) {
    deltaPayload.frame.frameTelemetry.frameBuildStagesMs.deltaDiff =
      Date.now() - deltaDiffStartedAt;
    deltaPayload.frame.frameTelemetry.frameBuildMs =
      Object.values(deltaPayload.frame.frameTelemetry.frameBuildStagesMs).reduce(
        (sum, value) => sum + value,
        0
      );
  } else if ("changed" in deltaPayload && deltaPayload.changed.frameTelemetry) {
    deltaPayload.changed.frameTelemetry.frameBuildStagesMs.deltaDiff =
      Date.now() - deltaDiffStartedAt;
    deltaPayload.changed.frameTelemetry.frameBuildMs =
      Object.values(deltaPayload.changed.frameTelemetry.frameBuildStagesMs).reduce(
        (sum, value) => sum + value,
        0
      );
  }

  if (telemetry) {
    telemetry.payloadSuppressionMs = payloadSuppressionMs;
    if (broadcastStartedAt !== undefined) {
      telemetry.broadcastFrameTotalMs = Date.now() - broadcastStartedAt;
    }
    if (broadcastStartedAt !== undefined && collectedFrameTelemetries) {
      collectedFrameTelemetries.push(telemetry);
    }
  }

  const serializeStartedAt = Date.now();
  let serializedPayload = JSON.stringify(deltaPayload);
  lastFrameSerializeMs = Date.now() - serializeStartedAt;
  lastPatchSizeBytes = Buffer.byteLength(serializedPayload, "utf8");

  const applySendPrepTelemetry = (frameTelemetry: ScreenerFrame["frameTelemetry"] | undefined): void => {
    if (!frameTelemetry) {
      return;
    }
    frameTelemetry.frameBuildStagesMs.sendPrep = lastFrameSerializeMs;
    frameTelemetry.frameSerializeMs = lastFrameSerializeMs;
    frameTelemetry.patchSizeBytes = lastPatchSizeBytes;
    frameTelemetry.patchSizeKb = Number((lastPatchSizeBytes / 1024).toFixed(2));
    frameTelemetry.frameBuildMs = Object.values(frameTelemetry.frameBuildStagesMs).reduce(
      (sum, value) => sum + value,
      0
    );
    frameTelemetry.performanceState = resolvePerformanceState(
      frameTelemetry.payloadBudgetState,
      frameTelemetry.frameBuildMs,
      Math.max(...Object.values(frameTelemetry.frameBuildStagesMs))
    );
  };

  if ("frame" in deltaPayload) {
    applySendPrepTelemetry(deltaPayload.frame.frameTelemetry);
  } else {
    applySendPrepTelemetry(deltaPayload.changed.frameTelemetry);
  }

  serializedPayload = JSON.stringify(deltaPayload);
  lastPatchSizeBytes = Buffer.byteLength(serializedPayload, "utf8");

  const websocketSendStartedAt = Date.now();
  client.forceSnapshotNext = false;
  sendSerialized(client.socket, serializedPayload);
  const websocketSendMs = Date.now() - websocketSendStartedAt;

  if (telemetry) {
    telemetry.websocketSendMs = websocketSendMs;
  }
};

const broadcastFrame = (): void => {
  const broadcastStartedAt = Date.now();
  let reusableMonitorFrame: ScreenerFrame | null = null;
  const monitorClients: ClientContext[] = [];
  const frameTelemetries: FrameTelemetryState[] = [];

  for (const client of clients.values()) {
    if (client.socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    if (client.kind === "desktop-alert-monitor") {
      monitorClients.push(client);
      continue;
    }

    const fullFrame = buildFrame(client, resolveClientFrameBuildContext(client));
    reusableMonitorFrame ??= fullFrame;
    sendClientProjectedFrame(client, fullFrame, broadcastStartedAt, frameTelemetries);
  }

  for (const client of monitorClients) {
    const monitorFrame =
      reusableMonitorFrame ?? buildFrame(client, resolveClientFrameBuildContext(client));
    reusableMonitorFrame = monitorFrame;
    sendClientProjectedFrame(client, monitorFrame, broadcastStartedAt, frameTelemetries);
  }

};

const updateClientAccountActiveTrades = (clientId: string, symbols: string[]): void => {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  const nextSymbols = new Set(symbols);
  if (areSetsEqual(client.accountActiveTrades, nextSymbols)) {
    return;
  }

  client.accountActiveTrades = nextSymbols;

  if (marketStreamsStarted) {
    rebalanceFocusStreams();
    broadcastFrame();
  }
};

const createAccountStreamManager = (
  clientId: string,
  envApiKey: string | undefined,
  envApiSecret: string | undefined,
  orderService: BinanceOrderService
): BinanceAccountStreamManager =>
  new BinanceAccountStreamManager(
    config.binanceRestBase,
    config.binanceWsBase,
    envApiKey,
    envApiSecret,
    {
      onPositionsChanged: (symbols) => {
        updateClientAccountActiveTrades(clientId, symbols);
      },
      onRiskStateChanged: () => {
        observeAutoJournalPositions(clientId);
        sendClientFrame(clientId);
      },
      onStatus: (message) => {
        console.log(`[account ${clientId.slice(0, 8)}] ${message}`);
        sendClientFrame(clientId);
      },
      onOrderTradeUpdate: (event) => {
        orderService.handleOrderTradeUpdate(event);
      }
    }
  );

const createOrderService = (clientId: string): BinanceOrderService => {
  const orderService = new BinanceOrderService(config.binanceRestBase, {
    defaultPaperMode: config.orderPaperModeDefault,
    liveModeEnabled: config.orderLiveModeEnabled,
    liveTradingEnabled: config.liveTradingEnabled,
    liveTradingRequiresTestnet: config.liveTradingRequiresTestnet,
    liveTradingRequireTypedConfirm: config.liveTradingRequireTypedConfirm,
    liveTradingKillSwitchEnabled: config.liveTradingKillSwitchEnabled,
    binanceFuturesTestnet: config.binanceFuturesTestnet,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    restBase: config.binanceRestBase,
    wsBase: config.binanceWsBase,
    orderControlAuthRequired: config.orderControlAuthRequired,
    orderControlToken: config.orderControlToken,
    liveRiskLimits: config.liveRiskLimits,
    onMessage: (message) => {
      const client = clients.get(clientId);
      if (!client) {
        return;
      }

      send(client.socket, message);
    }
  });

  if (liveTradingRuntimeKillSwitchActive) {
    orderService.disableLiveTrading("Live trading disabled by global runtime kill switch.");
  }

  return orderService;
};

const startClientAccountStream = async (clientId: string): Promise<void> => {
  const client = clients.get(clientId);
  if (!client || !client.accountStreamManager.isEnabled()) {
    return;
  }

  try {
    const symbols = await client.accountStreamManager.start();
    updateClientAccountActiveTrades(clientId, symbols);
    sendClientFrame(clientId);
  } catch (error) {
    console.error(`Account stream bootstrap failed for client ${clientId}`, error);
    updateClientAccountActiveTrades(clientId, []);
    sendClientFrame(clientId);
  }
};

const summarizeAccountSessions = () => {
  let enabledClients = 0;
  let connectedStreams = 0;

  for (const client of clients.values()) {
    const health = client.accountStreamManager.getHealth();
    if (health.enabled) {
      enabledClients += 1;
    }
    if (health.connected) {
      connectedStreams += 1;
    }
  }

  return {
    connectedClients: clients.size,
    enabledClients,
    connectedStreams
  };
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

registerSocialAuthRoutes(app);

app.use("/api/tts", (request, response, next) => {
  const originHeader = request.headers.origin;
  const origin = typeof originHeader === "string" ? originHeader : "";

  if (origin && isTrustedLocalOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }

  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (!shouldAllowTtsAccess(request)) {
    response.status(403).json({
      error: "forbidden",
      message: "TTS API is available only to trusted local clients."
    });
    return;
  }

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
});

app.get(["/", "/health"], (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    service: "scalpstation-backend",
    status: phase,
    persistenceQueue: signalEventWriter.getMetrics(),
    generatedAt: Date.now()
  });
});

app.get("/health/diagnostics", (request, response) => {
  if (!shouldAllowDiagnosticHealthAccess(request)) {
    response.status(403).json({
      error: "forbidden",
      message: "Diagnostic health is available only to trusted local clients."
    });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.json({
    service: "scalpstation-backend",
    status: phase,
    message: phaseMessage,
    websocket: `ws://${config.host}:${config.port}${config.wsPath}`,
    frontend: "http://localhost:3000",
    authBrokerMode: config.authBrokerMode,
    authRedirects: config.authAllowedRedirectUris,
    streamHealth: streamManager.getHealth(),
    accountSessions: summarizeAccountSessions(),
    persistenceQueue: signalEventWriter.getMetrics(),
    paperProtectiveExecution: paperProtectiveOrderService?.getPaperProtectiveTelemetry() ?? {
      activePaperProtectiveLegs: 0,
      paperProtectiveTriggers: 0,
      lastPaperProtectiveTriggerAt: null
    },
    generatedAt: Date.now()
  });
});

app.get("/api/settings", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    settings: summarizeSettings(),
    generatedAt: Date.now()
  });
});

app.patch("/api/settings", (request, response) => {
  const patch = request.body && typeof request.body === "object" ? request.body : {};
  const nextSettings = normalizeBackendSettings(patch as Partial<BackendSettings>, globalSettings);

  globalSettings = {
    ...nextSettings,
    revivingCoins: normalizeRevivingCoinAlertSettings(
      nextSettings.revivingCoins,
      globalSettings.revivingCoins
    ),
    volumeMilestones: normalizeVolumeMilestoneSettings(
      nextSettings.volumeMilestones,
      globalSettings.volumeMilestones
    )
  };

  for (const client of clients.values()) {
    client.settings = {
      ...client.settings,
      revivingCoins: globalSettings.revivingCoins,
      volumeMilestones: globalSettings.volumeMilestones
    };
  }

  rebalanceFocusStreams();
  broadcastFrame();
  runRevivingCoinScan(true);

  response.setHeader("Cache-Control", "no-store");
  response.json({
    settings: summarizeSettings(),
    generatedAt: Date.now()
  });
});

app.get("/api/reviving-coin-alerts/events", (request, response) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);

  response.setHeader("Cache-Control", "no-store");
  response.json({
    events: marketEventStore.listRevivingCoinEvents(limit),
    generatedAt: Date.now()
  });
});

app.get("/api/tts/models", (_request, response) => {
  response.json({
    provider: "edge",
    defaultModelId: "en-US-AvaMultilingualNeural",
    models: listTtsModels()
  });
});

app.post("/api/tts/synthesize", async (request, response) => {
  const text = typeof request.body?.text === "string" ? request.body.text : "";

  if (!text.trim()) {
    response.status(400).json({
      error: "invalid_text",
      message: "Speech text is required."
    });
    return;
  }

  try {
    const audioBuffer = await synthesizeSpeech({
      text,
      voiceId: typeof request.body?.voiceId === "string" ? request.body.voiceId : null,
      lang: typeof request.body?.lang === "string" ? request.body.lang : null,
      rate: typeof request.body?.rate === "string" ? request.body.rate : null,
      pitch: typeof request.body?.pitch === "string" ? request.body.pitch : null
    });

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "audio/mpeg");
    response.setHeader("Content-Length", String(audioBuffer.byteLength));
    response.status(200).send(audioBuffer);
  } catch (error) {
    response.status(500).json({
      error: "tts_failed",
      message: error instanceof Error ? error.message : "Speech synthesis failed."
    });
  }
});

app.all(config.wsPath, (_request, response) => {
  response.status(426).json({
    error: "upgrade_required",
    message: `Connect via WebSocket at ws://localhost:${config.port}${config.wsPath}`
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: "not_found" });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

const summarizePinnedSymbols = (): Set<string> => {
  const watchlist = summarizeWatchlist();
  const manualActiveTrades = summarizeActiveTrades();
  const accountActiveTrades = summarizeAccountActiveTrades();

  return new Set([...watchlist, ...manualActiveTrades, ...accountActiveTrades]);
};

const summarizeSelectedChartSymbols = (now = Date.now()): string[] => {
  const selected = Array.from(clients.values())
    .map((client) => client.selectedSymbol)
    .filter(
      (item): item is { symbol: string; updatedAt: number } =>
        !!item && now - item.updatedAt <= selectedChartSymbolTtlMs && engine.hasSymbol(item.symbol)
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const symbols: string[] = [];
  const seen = new Set<string>();

  for (const item of selected) {
    if (seen.has(item.symbol)) {
      continue;
    }

    seen.add(item.symbol);
    symbols.push(item.symbol);

    if (symbols.length >= maxSelectedChartSymbols) {
      break;
    }
  }

  return symbols;
};

const computeCurrentFocusSymbols = (): string[] =>
  [
    ...engine.computeDesiredFocusSymbols(summarizeSettings(), summarizePinnedSymbols()),
    ...summarizeSelectedChartSymbols()
  ].filter((symbol, index, symbols) => symbols.indexOf(symbol) === index);

const rebalanceFocusStreams = (): void => {
  if (!marketStreamsStarted) {
    return;
  }

  streamManager.updateFocusSymbols(computeCurrentFocusSymbols());
  pollOpenInterestSnapshot();
};

wss.on("connection", (socket, request) => {
  const clientId = randomUUID();
  const allowEnvironmentAccountAccess = shouldAllowEnvironmentAccountAccess(request);
  const orderService = createOrderService(clientId);
  const client: ClientContext = {
    socket,
    kind: isDesktopAlertMonitorRequest(request) ? "desktop-alert-monitor" : "terminal",
    watchlist: new Set<string>(),
    manualActiveTrades: new Set<string>(),
    selectedSymbol: null,
    settings: {
      ...createDefaultBackendSettings(),
      revivingCoins: globalSettings.revivingCoins
    },
    orderService,
    accountStreamManager: createAccountStreamManager(
      clientId,
      allowEnvironmentAccountAccess ? config.apiKey : undefined,
      allowEnvironmentAccountAccess ? config.apiSecret : undefined,
      orderService
    ),
    accountActiveTrades: new Set<string>(),
    riskEngine: new RiskEngine(new RiskStore()),
    visibleSections: null,
    deltaFrameState: deltaFrameEngine.createClientState(),
    forceSnapshotNext: true,
    transportCapabilities: new Set<FrameTransportCapability>()
  };
  clients.set(clientId, client);

  send(socket, {
    type: "welcome",
    message: "connected to t.me/troesh backend",
    generatedAt: Date.now()
  });
  sendPaperTradingState(socket, client);
  sendLiveSafetyState(socket);
  sendClientFrame(clientId);
  sendRiskSnapshot(socket, client);

  if (client.accountStreamManager.isEnabled()) {
    void startClientAccountStream(clientId);
  }

  socket.on("message", async (buffer) => {
    let message: ClientMessage | null = null;

    try {
      message = JSON.parse(buffer.toString("utf8")) as ClientMessage;
    } catch {
      return;
    }

    if (!message) {
      return;
    }

    const client = clients.get(clientId);
    if (!client) {
      return;
    }

    try {
      switch (message.type) {
        case "hello":
          client.transportCapabilities = normalizeTransportCapabilities(message.payload?.capabilities);
          client.forceSnapshotNext = true;
          sendClientFrame(clientId);
          sendRiskSnapshot(socket, client);
          syncClientOrderPreflights(socket, client, message.payload?.activeOrderPreflightIds);
          break;
        case "request_snapshot":
          deltaFrameEngine.noteSnapshotRequest(client.deltaFrameState, message.payload);
          client.forceSnapshotNext = true;
          sendClientFrame(clientId);
          sendRiskSnapshot(socket, client);
          syncClientOrderPreflights(socket, client, message.payload?.activeOrderPreflightIds);
          break;
        case "request_signal_statistics":
          sendSignalStatistics(socket, message.filters);
          break;
        case "request_signal_replay":
          sendSignalReplay(socket, message.signalId);
          break;
        case "request_decision_chain":
          sendDecisionChain(socket, message.payload);
          break;
        case "request_decision_replay":
          sendDecisionReplay(socket, message.payload);
          break;
        case "request_knowledge_layer":
          sendKnowledgeLayerSnapshot(socket, message.payload);
          break;
        case "request_journal_entries":
          sendJournalEntries(socket, message.filters);
          break;
        case "request_journal_analytics":
          sendJournalAnalytics(socket, message.filters);
          break;
        case "request_learning_report":
          sendLearningReport(socket, message.filters);
          break;
        case "request_position_sizing":
          await sendPositionSizing(socket, client, message.payload);
          break;
        case "create_trade_decision_context":
          createTradeDecisionContextFromMessage(socket, client, message.payload);
          break;
        case "request_order_preflight": {
          const symbol = message.payload.symbol?.trim().toUpperCase() ?? "";
          const baseFrame = symbol ? buildBaseFrameForClient(client) : null;
          const row = symbol
            ? baseFrame?.rows.find((item) => item.symbol === symbol) ?? null
            : null;
          const paperMode =
            typeof message.payload.paperMode === "boolean"
              ? message.payload.paperMode
              : message.payload.mode === "TESTNET_LIVE"
                ? false
                : message.payload.mode === "PAPER"
                  ? true
                  : config.orderPaperModeDefault;
          const validation = await client.orderService.validateOrderPreflight(
            {
              ...message.payload,
              symbol,
              paperMode
            },
            {
              account: client.accountStreamManager.getRiskSnapshot(),
              accountStream: client.accountStreamManager.getHealth(),
              row
            }
          );
          const generatedAt = Date.now();
          const safeToAdd = await buildOrderPreflightSafeToAdd({
            client,
            symbol,
            side: message.payload.side,
            validation,
            row,
            generatedAt
          });
          const preflightId = randomUUID();
          const preflightNonce = randomUUID();
          const staleAfterMs = safeToAdd.staleAfterMs;
          const expiresAt = generatedAt + staleAfterMs;
          const ticketKey = message.payload.ticketKey?.trim() || [
            symbol,
            message.payload.side,
            message.payload.type,
            message.payload.quantity,
            message.payload.price ?? "",
            message.payload.stopPrice ?? "",
            message.payload.stopLossPrice ?? "",
            message.payload.takeProfitPrice ?? "",
            message.payload.reduceOnly === true ? "reduce" : "add",
            paperMode ? "paper" : "live"
          ].join("|");
          client.orderService.bindPreflight({
            preflightId,
            preflightNonce,
            requestId: message.payload.requestId,
            ticketKey,
            paperMode,
            generatedAt,
            expiresAt,
            safeToAddStatus: safeToAdd.status,
            payload: {
              ...message.payload,
              symbol,
              paperMode
            }
          });
          if (validation.accepted) {
            orderPreflightRepository.createActivePreflight({
              id: preflightId,
              requestId: message.payload.requestId,
              symbol,
              side: message.payload.side,
              type: message.payload.type,
              quantity: message.payload.quantity,
              normalizedQuantity: validation.normalizedQuantity,
              price: message.payload.price ?? null,
              normalizedPrice: validation.normalizedPrice,
              notional: validation.notional,
              decisionContextId: null,
              createdAt: generatedAt,
              expiresAt
            });
          }

          send(socket, {
            type: "order_preflight",
            generatedAt,
            payload: {
              requestId: message.payload.requestId,
              preflightId,
              preflightNonce,
              ticketKey,
              symbol,
              side: message.payload.side,
              validation,
              safeToAdd,
              generatedAt,
              staleAfterMs,
              expiresAt
            }
          });
          if (validation.accepted) {
            send(socket, {
              type: "order_preflight_persisted",
              generatedAt,
              payload: {
                preflightId,
                requestId: message.payload.requestId,
                ticketKey,
                status: "ACTIVE",
                createdAt: generatedAt,
                expiresAt
              }
            });
          }
          break;
        }
        case "live_trading_control":
          if (
            orderControlAuthRequiredFor(request, false) &&
            !isValidOrderControlToken(message.payload?.controlToken)
          ) {
            sendOrderControlAuthFailed(socket, null, message.action, clientId);
            break;
          }

          if (message.action === "DISABLE_LIVE_TRADING") {
            liveTradingRuntimeKillSwitchActive = true;
            for (const targetClient of clients.values()) {
              targetClient.orderService.disableLiveTrading(
                "LIVE_TRADING_DISABLED: runtime kill switch requested."
              );
            }
            broadcastLiveSafetyState();
          }
          break;
        case "order_intent": {
          const paperMode = message.payload.paperMode ?? config.orderPaperModeDefault;
          if (
            orderControlAuthRequiredFor(request, paperMode) &&
            !isValidOrderControlToken(message.payload.controlToken)
          ) {
            sendOrderControlAuthFailed(
              socket,
              typeof message.payload.intentId === "string" ? message.payload.intentId : null,
              message.payload.action,
              message.payload.sourceWindowId ?? clientId
            );
            break;
          }

          const symbol = message.payload.symbol?.trim().toUpperCase() ?? "";
          const baseFrame = symbol ? buildBaseFrameForClient(client) : null;
          const row = symbol
            ? baseFrame?.rows.find((item) => item.symbol === symbol) ?? null
            : null;

          await client.orderService.handleIntent(
            {
              ...message.payload,
              sourceWindowId: message.payload.sourceWindowId ?? clientId
            },
            {
              account: client.accountStreamManager.getRiskSnapshot(),
              accountStream: client.accountStreamManager.getHealth(),
              row
            }
          );
          break;
        }
        case "create_journal_entry":
          try {
            signalRepository.createJournalEntry(message.payload);
            sendJournalEntries(socket, undefined);
            sendJournalAnalytics(socket, undefined);
            sendLearningReport(socket, undefined);
          } catch (error) {
            sendJournalError(socket, error);
          }
          break;
        case "update_journal_entry":
          try {
            const updated = signalRepository.updateJournalEntry(message.id, message.patch);
            if (!updated) {
              throw new Error("Journal entry not found");
            }
            sendJournalEntries(socket, undefined);
            sendJournalAnalytics(socket, undefined);
            sendLearningReport(socket, undefined);
          } catch (error) {
            sendJournalError(socket, error);
          }
          break;
        case "delete_journal_entry":
          try {
            const deleted = signalRepository.deleteJournalEntry(message.id);
            if (!deleted) {
              throw new Error("Journal entry not found");
            }
            sendJournalEntries(socket, undefined);
            sendJournalAnalytics(socket, undefined);
            sendLearningReport(socket, undefined);
          } catch (error) {
            sendJournalError(socket, error);
          }
          break;
        case "visible_sections":
          client.visibleSections = normalizeVisibleSections(message.sections);
          sendClientFrame(clientId);
          break;
        case "connect_binance_account": {
          try {
            const symbols = await client.accountStreamManager.connectSession(
              message.payload.apiKey,
              message.payload.apiSecret
            );
            client.accountActiveTrades = new Set(symbols);
          } catch (error) {
            console.error("Binance account connect failed", error);
          }
          rebalanceFocusStreams();
          broadcastFrame();
          break;
        }
        case "disconnect_binance_account": {
          try {
            const symbols = await client.accountStreamManager.disconnectSession();
            client.accountActiveTrades = new Set(symbols);
          } catch (error) {
            console.error("Binance account disconnect failed", error);
          }
          rebalanceFocusStreams();
          broadcastFrame();
          break;
        }
        case "set_watchlist": {
          client.watchlist = new Set(
            message.payload.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
          );
          rebalanceFocusStreams();
          sendClientFrame(clientId);
          break;
        }
        case "set_active_trades": {
          client.manualActiveTrades = new Set(
            message.payload.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
          );
          rebalanceFocusStreams();
          sendClientFrame(clientId);
          break;
        }
        case "set_selected_symbol": {
          const symbol = message.payload.symbol?.trim().toUpperCase() ?? "";
          client.selectedSymbol = symbol ? { symbol, updatedAt: Date.now() } : null;
          rebalanceFocusStreams();
          sendClientFrame(clientId);
          break;
        }
        case "set_settings": {
          const nextSettings = normalizeBackendSettings(message.payload, client.settings);
          client.settings = nextSettings;

          if (message.payload.revivingCoins || message.payload.volumeMilestones) {
            globalSettings = {
              ...globalSettings,
              revivingCoins: nextSettings.revivingCoins,
              volumeMilestones: nextSettings.volumeMilestones
            };

            for (const existingClient of clients.values()) {
              existingClient.settings = {
                ...existingClient.settings,
                revivingCoins: globalSettings.revivingCoins,
                volumeMilestones: globalSettings.volumeMilestones
              };
            }
          }

          rebalanceFocusStreams();
          sendClientFrame(clientId);
          runRevivingCoinScan(Boolean(message.payload.revivingCoins));
          break;
        }
        case "ping": {
          const sentAt = message.payload?.sentAt;

          if (typeof sentAt !== "number" || !Number.isFinite(sentAt)) {
            return;
          }

          send(socket, {
            type: "pong",
            sentAt,
            receivedAt: Date.now()
          });
          break;
        }
      }
    } catch (error) {
      console.warn("Invalid client message ignored", error);
    }
  });

  socket.on("close", () => {
    const closingClient = clients.get(clientId);
    clients.delete(clientId);
    if (closingClient) {
      closingClient.orderService.dispose();
      void closingClient.accountStreamManager.dispose().catch((error) => {
        console.error(`Account stream dispose failed for client ${clientId}`, error);
      });
    }
    rebalanceFocusStreams();
  });
});

server.on("upgrade", (request, socket, head) => {
  if (getRequestPathname(request.url) !== config.wsPath) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

const bootstrap = async (): Promise<boolean> => {
  const snapshot = await bootstrapUniverse(config.binanceRestBase);

  if (runtimeStopRequested) {
    return false;
  }

  engine.bootstrap(snapshot.symbols, snapshot.tickers);

  phase = "live";
  phaseMessage = "market streams online";

  const initialFocus = computeCurrentFocusSymbols();
  streamManager.start(initialFocus);
  marketStreamsStarted = true;
  pollOpenInterestSnapshot();
  runRevivingCoinScan(true);
  return true;
};

const listenServer = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };

    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(config.port, config.host);
  });
};

const startMarketDataBootstrapLoop = (): void => {
  if (marketStreamsStarted || marketBootstrapPromise) {
    return;
  }

  marketBootstrapPromise = (async () => {
    for (;;) {
      if (runtimeStopRequested) {
        return;
      }

      try {
        const bootstrapped = await bootstrap();

        if (!bootstrapped || runtimeStopRequested) {
          return;
        }

        broadcastFrame();
        return;
      } catch (error) {
        if (runtimeStopRequested) {
          return;
        }

        phase = "degraded";
        phaseMessage =
          error instanceof Error
            ? `bootstrap failed, retrying: ${error.message}`
            : "bootstrap failed, retrying";
        broadcastFrame();
        await waitForBootstrapRetry(5_000);
      }
    }
  })().finally(() => {
    marketBootstrapPromise = null;
  });
};

export const startScalpStationBackend = async (): Promise<void> => {
  if (backendStarted) {
    return;
  }

  if (backendStartPromise) {
    return backendStartPromise;
  }

  backendStartPromise = (async () => {
    runtimeStopRequested = false;
    phase = "booting";
    phaseMessage = "bootstrapping market universe";

    initializeSqlite();
    orderPreflightRepository.expireExpiredActivePreflights(Date.now());
    signalOutcomeTracker.recoverPendingOutcomes();
    await listenServer();

    frameBroadcastInterval = setInterval(() => {
      broadcastFrame();
    }, config.frameIntervalMs);

    focusRebalanceInterval = setInterval(() => {
      rebalanceFocusStreams();
    }, config.focusRebalanceIntervalMs);

    openInterestPollInterval = setInterval(() => {
      pollOpenInterestSnapshot();
    }, config.openInterestPollIntervalMs);

    revivingCoinScanInterval = setInterval(() => {
      runRevivingCoinScan(false);
    }, 30_000);

    startMarketDataBootstrapLoop();

    backendStarted = true;
    console.log(`t.me/troesh backend listening on ws://localhost:${config.port}${config.wsPath}`);
  })();

  try {
    await backendStartPromise;
  } catch (error) {
    backendStartPromise = null;
    throw error;
  }
};

export const stopScalpStationBackend = async (): Promise<void> => {
  if (!backendStarted && !backendStartPromise) {
    return;
  }

  runtimeStopRequested = true;
  clearBootstrapRetryWait();
  const activeMarketBootstrapPromise = marketBootstrapPromise;

  if (frameBroadcastInterval) {
    clearInterval(frameBroadcastInterval);
    frameBroadcastInterval = null;
  }

  if (focusRebalanceInterval) {
    clearInterval(focusRebalanceInterval);
    focusRebalanceInterval = null;
  }

  if (revivingCoinScanInterval) {
    clearInterval(revivingCoinScanInterval);
    revivingCoinScanInterval = null;
  }

  if (openInterestPollInterval) {
    clearInterval(openInterestPollInterval);
    openInterestPollInterval = null;
  }

  const activeClients = Array.from(clients.entries());
  clients.clear();

  await Promise.all(
    activeClients.map(async ([clientId, client]) => {
      client.orderService.dispose();
      try {
        await client.accountStreamManager.dispose();
      } catch (error) {
        console.error(`Account stream dispose failed for client ${clientId}`, error);
      }
    })
  );

  streamManager.stop();
  marketStreamsStarted = false;

  if (activeMarketBootstrapPromise) {
    try {
      await activeMarketBootstrapPromise;
    } catch {
      // Bootstrap loop errors are already reflected in phase/status.
    }
  }

  marketBootstrapPromise = null;
  signalEventWriter.flush();
  closeSqlite();

  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });

  await new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  backendStarted = false;
  backendStartPromise = null;
  phase = "booting";
  phaseMessage = "bootstrapping market universe";
};

if (require.main === module) {
  startScalpStationBackend().catch((error) => {
    console.error("Fatal backend error", error);
    process.exit(1);
  });
}
