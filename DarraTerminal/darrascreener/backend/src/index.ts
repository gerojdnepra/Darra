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
import { FrameTelemetryEngine } from "./frame-telemetry/frame-telemetry-engine";
import { FundingEngine } from "./funding/funding-engine";
import { LiquidationAggregator } from "./liquidations/liquidation-aggregator";
import { LiquidationEngine } from "./liquidations/liquidation-engine";
import { MarketFlowEngine } from "./market-flow/market-flow-engine";
import { PayloadSuppressionEngine } from "./payload-suppression/payload-suppression-engine";
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
import { getExchangeFilterMap } from "./services/binance-exchange-filters";
import { BinanceAccountStreamManager } from "./services/binance-account-stream";
import { BinanceStreamManager } from "./services/binance-stream";
import { bootstrapUniverse, fetchOpenInterest } from "./services/binance-rest";
import { MarketEventStore } from "./services/market-event-store";
import { RevivingCoinDetector } from "./services/reviving-coin-detector";
import { ScreenerEngine } from "./services/screener-engine";
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
import type { SignalStatisticsFilters } from "./storage/signal-statistics-service";
import { closeSqlite, initializeSqlite } from "./storage/sqlite";
import type { SignalIntelligenceState } from "./signal-intelligence/types";
import type {
  BackendSettings,
  ClientMessage,
  ScreenerAlert,
  ScreenerFrame,
  ScreenerRow,
  ServerMessage
} from "./types/messages";

interface ClientContext {
  socket: WebSocket;
  watchlist: Set<string>;
  manualActiveTrades: Set<string>;
  settings: BackendSettings;
  accountStreamManager: BinanceAccountStreamManager;
  accountActiveTrades: Set<string>;
  riskEngine: RiskEngine;
  visibleSections: Set<string> | null;
  deltaFrameState: DeltaFrameClientState;
  forceSnapshotNext: boolean;
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
const frameTelemetryEngine = new FrameTelemetryEngine({
  getRuntimeMetrics: () => ({
    clientsConnected: clients.size,
    sendIntervalMs: config.frameIntervalMs,
    persistenceQueue: signalEventWriter.getMetrics()
  })
});
const payloadSuppressionEngine = new PayloadSuppressionEngine();
const deltaFrameEngine = new DeltaFrameEngine();
const marketEventStore = new MarketEventStore(config.marketEventStorePath);
const revivingCoinDetector = new RevivingCoinDetector(config.binanceRestBase, marketEventStore);
const autoJournalService = new AutoJournalService(config.autoJournalFromBinance);
const clients = new Map<string, ClientContext>();
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

const send = (socket: WebSocket, payload: ServerMessage | Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const sendRiskSnapshot = (socket: WebSocket, client: ClientContext): void => {
  send(socket, createRiskSnapshotMessage(client.riskEngine.getSnapshot()));
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
  const baseFrame = engine.buildFrame({
    settings: client.settings,
    watchlist: client.watchlist,
    manualActiveTrades: client.manualActiveTrades,
    accountActiveTrades: client.accountActiveTrades,
    phase,
    phaseMessage,
    streamHealth: streamManager.getHealth(),
    accountStream: client.accountStreamManager.getHealth()
  });
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

  send(socket, {
    type: "position_sizing",
    generatedAt: Date.now(),
    payload: {
      ...positionSizing,
      doNotTrade
    }
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
  onTickerBatch: (events) => engine.applyTickerBatch(events),
  onMarkPriceBatch: (events) => engine.applyMarkPriceBatch(events),
  onAggTrade: (event) => {
    engine.applyAggTrade(event);
    marketFlowEngine.applyAggTrade(event);
  },
  onBookTicker: (event) => engine.applyBookTicker(event),
  onLiquidation: (event) => {
    engine.applyLiquidation(event);
    liquidationEngine.applyEvent(event);
  },
  onStatus: (message) => {
    phaseMessage = message;
  }
});

const buildFrame = (client: ClientContext) => {
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

  const riskPayload = client.riskEngine.sync({
    account: client.accountStreamManager.getRiskSnapshot(),
    accountStream: frame.status.accountStream,
    rows: frame.rows,
    market: engine.getLatestMarketRiskSnapshot()
  });

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

  const funding = fundingEngine.build(frame.rows);
  const fundingSorted = fundingEngine.buildSortedViews(funding);
  const marketFlow = marketFlowEngine.build(frame.status.focusSymbols);
  const liquidations = liquidationAggregator.build();
  const portfolioAnalytics = portfolioAnalyticsEngine.build({
    rows: frame.rows,
    account: client.accountStreamManager.getRiskSnapshot(),
    generatedAt: frame.generatedAt
  });
  const regime = unifiedRegimeEngine.build({
    rows: frame.rows,
    funding,
    marketFlow,
    liquidations
  });
  const regimeLearning = regimeLearningEngine.build({
    regime,
    rows: frame.rows,
    generatedAt: frame.generatedAt
  });
  const execution = executionIntelligenceEngine.build({
    regime,
    regimeLearning,
    rows: frame.rows
  });
  const conflict = signalConflictEngine.build({
    regime,
    regimeLearning,
    execution,
    rows: frame.rows
  });
  const allocation = portfolioAllocationEngine.build({
    execution,
    regime,
    regimeLearning,
    conflict
  });
  const signalIntelligence = signalIntelligenceEngine.build({
    rows: frame.rows,
    funding,
    marketFlow,
    liquidations,
    regime,
    regimeLearning,
    execution,
    conflict,
    allocation
  });
  const metaRegimeGovernor = metaRegimeGovernorEngine.build({
    generatedAt: frame.generatedAt,
    signalIntelligence,
    regime,
    regimeLearning,
    execution,
    conflict,
    allocation,
    marketFlow,
    funding,
    risk: riskPayload.state,
    liquidations
  });
  const regimeMemory = regimeMemoryEngine.build({
    generatedAt: frame.generatedAt,
    rows: frame.rows,
    funding,
    marketFlow,
    regime,
    regimeLearning,
    execution,
    conflict,
    signalIntelligence,
    metaRegimeGovernor
  });
  const regimePrediction = regimePredictionEngine.build({
    generatedAt: frame.generatedAt,
    rows: frame.rows,
    funding,
    marketFlow,
    regime,
    regimeLearning,
    execution,
    conflict,
    allocation,
    signalIntelligence,
    metaRegimeGovernor,
    regimeMemory,
    risk: riskPayload.state
  });
  const positionRiskOrchestrator = positionRiskOrchestratorEngine.build({
    generatedAt: frame.generatedAt,
    account: client.accountStreamManager.getRiskSnapshot(),
    risk: riskPayload.state,
    execution,
    allocation,
    conflict,
    signalIntelligence,
    metaRegimeGovernor,
    regimePrediction,
    rows: frame.rows
  });
  const regimeFeedbackCalibration = regimeFeedbackCalibrationEngine.build({
    generatedAt: frame.generatedAt,
    rows: frame.rows,
    regime,
    execution,
    metaRegimeGovernor,
    regimePrediction
  });

  const nextFrame: ScreenerFrame = {
    ...frame,
    risk: riskPayload.state,
    funding,
    fundingSorted,
    marketFlow,
    liquidations,
    portfolioAnalytics,
    regime,
    regimeLearning,
    execution,
    conflict,
    allocation,
    signalIntelligence,
    metaRegimeGovernor,
    positionRiskOrchestrator,
    regimeMemory,
    regimePrediction,
    regimeFeedbackCalibration,
    alerts: [...riskAlerts, ...frame.alerts].slice(0, 50)
  };

  nextFrame.frameTelemetry = frameTelemetryEngine.build(nextFrame as unknown as Record<string, unknown>);
  recordScreenerSignals(frame.alerts, nextFrame);
  recordRiskSignals(riskAlerts, nextFrame);
  recordSignalIntelligenceSignals(signalIntelligence, nextFrame);
  signalEventWriter.observeMarketRows(nextFrame.rows);

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

  const fullFrame = buildFrame(client);
  const clientFrame = payloadSuppressionEngine.build(fullFrame, client.visibleSections);
  const deltaPayload = deltaFrameEngine.build(client.deltaFrameState, clientFrame.frame, {
    forceSnapshot: client.forceSnapshotNext
  });

  client.forceSnapshotNext = false;
  send(client.socket, deltaPayload);
};

const broadcastFrame = (): void => {
  for (const [clientId] of clients.entries()) {
    sendClientFrame(clientId);
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
  envApiSecret: string | undefined
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
      }
    }
  );

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

const computeCurrentFocusSymbols = (): string[] =>
  engine.computeDesiredFocusSymbols(summarizeSettings(), summarizePinnedSymbols());

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
  const client: ClientContext = {
    socket,
    watchlist: new Set<string>(),
    manualActiveTrades: new Set<string>(),
    settings: {
      ...createDefaultBackendSettings(),
      revivingCoins: globalSettings.revivingCoins
    },
    accountStreamManager: createAccountStreamManager(
      clientId,
      allowEnvironmentAccountAccess ? config.apiKey : undefined,
      allowEnvironmentAccountAccess ? config.apiSecret : undefined
    ),
    accountActiveTrades: new Set<string>(),
    riskEngine: new RiskEngine(new RiskStore()),
    visibleSections: null,
    deltaFrameState: deltaFrameEngine.createClientState(),
    forceSnapshotNext: true
  };
  clients.set(clientId, client);

  send(socket, {
    type: "welcome",
    message: "connected to t.me/troesh backend",
    generatedAt: Date.now()
  });
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
          sendClientFrame(clientId);
          sendRiskSnapshot(socket, client);
          break;
        case "request_snapshot":
          client.forceSnapshotNext = true;
          sendClientFrame(clientId);
          sendRiskSnapshot(socket, client);
          break;
        case "request_signal_statistics":
          sendSignalStatistics(socket, message.filters);
          break;
        case "request_signal_replay":
          sendSignalReplay(socket, message.signalId);
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
