import { randomUUID } from "node:crypto";
import { ExecutionFacade } from "../execution/execution-facade";
import { safeNumber } from "../lib/math";
import { evaluateLiveReadiness } from "../safety/live-readiness";
import {
  evaluateClientOrderIdSafety,
  evaluateReduceOnlyPositionSafety,
  isTerminalOrderStatus
} from "../safety/order-safety";
import { evaluateRiskAuthorityOrder } from "../risk/risk-authority";
import {
  orderRepository,
  type StoredOrderIntentResponse,
  type StoredPreSubmitOrderIntentRecord
} from "../storage/order-repository";
import { recoveryAuditRepository } from "../storage/recovery-audit-repository";
import { orderPreflightRepository } from "../storage/order-preflight-repository";
import { tradeDecisionRepository } from "../storage/trade-decision-repository";
import type { OrderTradeUpdateEvent } from "../types/binance";
import type { RestFuturesOrder } from "../types/binance";
import type {
  OrderAckMessage,
  OrderAuditEventMessage,
  OrderErrorMessage,
  OrderIntentMessage,
  OrderLifecycleStatus,
  OrderPreflightInvalidatedMessage,
  OrderPreflightPersistedMessage,
  PaperPositionClosedMessage,
  PaperPositionOpenedMessage,
  PaperPositionPayload,
  PaperPositionUpdatedMessage,
  OrderProtectiveKind,
  OrderRejectedMessage,
  OrderRiskLimits,
  OrderStatePayload,
  OrderStatusMessage,
  OrderType,
  OrderValidationCheck,
  OrderValidationPayload,
  PositionLifecycle,
  PositionLifecycleClosedMessage,
  PositionLifecycleCreatedMessage,
  PositionLifecycleEventMessage,
  PositionLifecycleEventType,
  PositionLifecycleUpdatedMessage,
  RequestOrderPreflightMessage,
  ScreenerRow
} from "../types/messages";
import {
  getExchangeFilterMap,
  normalizePrice,
  normalizeQuantity,
  validateNotional
} from "./binance-exchange-filters";
import {
  cancelFuturesOrder,
  fetchPositionRiskSnapshot,
  getCachedLeverageBrackets,
  getFuturesOrder,
  getOpenOrders,
  getPositionRisk,
  placeFuturesOrder
} from "./binance-rest";
import { ensureBinanceTimeSyncStarted } from "./binance-time-sync";
import type {
  AccountStreamHealth,
  BinanceAccountRiskSnapshot
} from "./binance-account-stream";
import type {
  RestPositionRiskV3
} from "../types/binance";
import type { ExecutionCommand } from "../execution/types";

type OrderServerMessage =
  | OrderAckMessage
  | OrderRejectedMessage
  | OrderErrorMessage
  | OrderStatusMessage
  | OrderAuditEventMessage
  | PaperPositionOpenedMessage
  | PaperPositionUpdatedMessage
  | PaperPositionClosedMessage
  | PositionLifecycleCreatedMessage
  | PositionLifecycleUpdatedMessage
  | PositionLifecycleClosedMessage
  | PositionLifecycleEventMessage
  | OrderPreflightPersistedMessage
  | OrderPreflightInvalidatedMessage;

interface OrderIntentContext {
  account: BinanceAccountRiskSnapshot;
  accountStream: AccountStreamHealth;
  row: ScreenerRow | null;
}

interface BinanceOrderServiceOptions {
  defaultPaperMode: boolean;
  liveModeEnabled: boolean;
  liveTradingEnabled?: boolean;
  liveTradingRequiresTestnet?: boolean;
  liveTradingRequireTypedConfirm?: boolean;
  liveTradingKillSwitchEnabled?: boolean;
  binanceFuturesTestnet?: boolean;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  restBase?: string;
  wsBase?: string;
  orderControlAuthRequired?: boolean;
  orderControlToken?: string;
  skipStartupRecovery?: boolean;
  liveRiskLimits?: {
    maxOrderNotionalUsdt: { enabled: boolean; value: number | null };
    maxPositionNotionalUsdt: { enabled: boolean; value: number | null };
    maxOpenPositions?: { enabled: boolean; value: number | null };
    maxDailyLossUsdt: { enabled: boolean; value: number | null };
    maxLeverage: { enabled: boolean; value: number | null };
  };
  riskLimits?: Partial<OrderRiskLimits>;
  onMessage: (message: OrderServerMessage) => void;
}

export interface PaperProtectiveMarketPrice {
  symbol: string;
  markPrice?: number | null;
  lastPrice?: number | null;
}

export interface PaperProtectiveTelemetry {
  activePaperProtectiveLegs: number;
  paperProtectiveTriggers: number;
  lastPaperProtectiveTriggerAt: number | null;
}

interface NormalizedIntentMeta {
  intentId: string;
  createdAt: number;
  sourceWindowId: string | null;
  paperMode: boolean;
  preflightId: string | null;
  preflightNonce: string | null;
  unifiedSignalId: string | null;
  decisionContextId: string | null;
  reviewCorrelationId: string | null;
}

interface NormalizedPlaceIntent extends NormalizedIntentMeta {
  action: "PLACE_ORDER";
  symbol: string;
  side: OrderStatePayload["side"];
  orderType: OrderStatePayload["orderType"];
  quantity: number;
  price: number | null;
  stopPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  clientOrderId: string;
  reduceOnly: boolean;
}

interface CanonicalPreflightPayload {
  paperMode: boolean;
  symbol: string;
  side: OrderStatePayload["side"];
  orderType: OrderStatePayload["orderType"];
  quantity: number;
  price: number | null;
  stopPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  reduceOnly: boolean;
}

interface BoundPreflightRecord {
  preflightId: string;
  preflightNonce: string;
  requestId: string;
  ticketKey: string;
  paperMode: boolean;
  generatedAt: number;
  expiresAt: number;
  safeToAddStatus: "ALLOW" | "WAIT" | "STALE" | "BLOCK";
  canonicalPayload: CanonicalPreflightPayload | null;
  lockedIntentId: string | null;
  lockedAt: number | null;
}

interface BindPreflightInput {
  preflightId: string;
  preflightNonce: string;
  requestId: string;
  ticketKey: string;
  paperMode: boolean;
  generatedAt: number;
  expiresAt: number;
  safeToAddStatus: "ALLOW" | "WAIT" | "STALE" | "BLOCK";
  payload: RequestOrderPreflightMessage["payload"];
}

interface NormalizedCancelIntent extends NormalizedIntentMeta {
  action: "CANCEL_ORDER";
  symbol: string | null;
  targetClientOrderId: string;
}

interface NormalizedClosePaperPositionIntent extends NormalizedIntentMeta {
  action: "CLOSE_PAPER_POSITION";
  paperPositionId: string;
  symbol: string;
  quantity: number | null;
}

type CancelRiskClassification =
  | "ENTRY_PENDING_RISK_REDUCING"
  | "PROTECTIVE_OR_RISK_INCREASING"
  | "TERMINAL_OR_INVALID"
  | "UNKNOWN_RISK";

interface CancelTargetResolution {
  order: OrderStatePayload | null;
  classification: CancelRiskClassification;
  reason: string;
  targetOrderId: string | null;
  targetClientOrderId: string | null;
}

type LiveLifecycleClosureDecision = "CAN_CLOSE" | "CANNOT_CLOSE" | "AMBIGUOUS";

interface LiveLifecycleClosureEvaluation {
  decision: LiveLifecycleClosureDecision;
  reason: string;
  timestamp: number;
  lifecycleId: string;
  orderIntentId: string | null;
  relatedLocalOrderCount: number | null;
  matchingExchangeOpenOrderCount: number;
  sameSymbolUnmatchedExchangeOpenOrderCount: number;
  positionAmt: number | null;
  positionSide: RestPositionRiskV3["positionSide"] | null;
  matchMethod: "orderIntentId" | null;
}

interface EvaluateLiveLifecycleClosureInput {
  lifecycle: PositionLifecycle;
  relatedLocalOrders: OrderStatePayload[] | null;
  exchangeOpenOrders: RestFuturesOrder[];
  exchangePositions: RestPositionRiskV3[] | null;
  timestamp: number;
}

interface LiveLifecycleClosureApplyResult {
  closed: boolean;
  markerType: string | null;
  skippedDuplicate: boolean;
  error: string | null;
}

const canonicalPreflightPayloadFields = [
  "paperMode",
  "symbol",
  "side",
  "orderType",
  "quantity",
  "price",
  "stopPrice",
  "stopLossPrice",
  "takeProfitPrice",
  "reduceOnly"
] as const satisfies ReadonlyArray<keyof CanonicalPreflightPayload>;

const buildCanonicalPreflightPayload = (
  intent: Pick<
    NormalizedPlaceIntent,
    | "paperMode"
    | "symbol"
    | "side"
    | "orderType"
    | "quantity"
    | "price"
    | "stopPrice"
    | "stopLossPrice"
    | "takeProfitPrice"
    | "reduceOnly"
  >
): CanonicalPreflightPayload => ({
  paperMode: intent.paperMode,
  symbol: intent.symbol,
  side: intent.side,
  orderType: intent.orderType,
  quantity: intent.quantity,
  price: intent.price,
  stopPrice: intent.stopPrice,
  stopLossPrice: intent.stopLossPrice,
  takeProfitPrice: intent.takeProfitPrice,
  reduceOnly: intent.reduceOnly
});

const findCanonicalPreflightPayloadMismatch = (
  bound: CanonicalPreflightPayload,
  submitPayload: CanonicalPreflightPayload
): keyof CanonicalPreflightPayload | null => {
  for (const field of canonicalPreflightPayloadFields) {
    if (bound[field] !== submitPayload[field]) {
      return field;
    }
  }

  return null;
};

const DEFAULT_ORDER_RISK_LIMITS: OrderRiskLimits = {
  maxPositionSize: {
    enabled: false,
    value: null
  },
  maxAccountExposure: {
    enabled: false,
    value: null
  },
  maxLeverage: {
    enabled: false,
    value: null
  },
  maxDailyLoss: {
    enabled: false,
    value: null
  }
};

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string | undefined): string | null => {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
};

const isPositiveNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const signedPaperPositionQuantity = (
  side: PaperPositionPayload["side"],
  quantity: number
): number => (side === "LONG" ? quantity : -quantity);

const formatOrderPrice = (value: number): string =>
  Number.isInteger(value)
    ? value.toString()
    : value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

const flipOrderSide = (
  side: OrderStatePayload["side"]
): OrderStatePayload["side"] => (side === "BUY" ? "SELL" : "BUY");

const parseExchangePositionAmt = (position: RestPositionRiskV3): number | null => {
  const rawPositionAmt = position.positionAmt.trim();
  if (!rawPositionAmt) {
    return null;
  }

  const parsedPositionAmt = Number(rawPositionAmt);
  return Number.isFinite(parsedPositionAmt) ? parsedPositionAmt : null;
};

const buildFlatPositionRisk = (symbol: string): RestPositionRiskV3 => ({
  symbol,
  positionSide: "BOTH",
  positionAmt: "0",
  entryPrice: "0",
  breakEvenPrice: "0",
  markPrice: "0",
  unRealizedProfit: "0",
  liquidationPrice: "0",
  isolatedMargin: "0",
  notional: "0",
  marginAsset: "USDT",
  isolatedWallet: "0",
  initialMargin: "0",
  maintMargin: "0",
  positionInitialMargin: "0",
  openOrderInitialMargin: "0",
  adl: 0,
  bidNotional: "0",
  askNotional: "0",
  updateTime: 0
});

const exchangeOrderIdText = (order: RestFuturesOrder): string | null =>
  Number.isFinite(order.orderId) ? String(order.orderId) : null;

const isActiveRelatedLocalOrder = (order: OrderStatePayload): boolean =>
  order.status === "NEW" || order.status === "PARTIALLY_FILLED";

const isProtectiveOrReduceOnlyLocalOrder = (order: OrderStatePayload): boolean =>
  order.protectiveKind !== null || order.reduceOnly;

const isProtectiveOrReduceOnlyExchangeOrder = (order: RestFuturesOrder): boolean =>
  Boolean(order.reduceOnly) ||
  order.type === "STOP" ||
  order.type === "STOP_MARKET" ||
  order.type === "TAKE_PROFIT" ||
  order.type === "TAKE_PROFIT_MARKET";

const evaluateLiveLifecycleClosure = (
  input: EvaluateLiveLifecycleClosureInput
): LiveLifecycleClosureEvaluation => {
  const lifecycle = input.lifecycle;
  const orderIntentId = normalizeText(lifecycle.orderIntentId);
  const lifecycleSymbol = normalizeSymbol(lifecycle.symbol);
  const relatedLocalOrderCount = input.relatedLocalOrders?.length ?? null;

  const finish = (
    decision: LiveLifecycleClosureDecision,
    reason: string,
    evidence: Pick<
      LiveLifecycleClosureEvaluation,
      | "matchingExchangeOpenOrderCount"
      | "sameSymbolUnmatchedExchangeOpenOrderCount"
      | "positionAmt"
      | "positionSide"
    > = {
      matchingExchangeOpenOrderCount: 0,
      sameSymbolUnmatchedExchangeOpenOrderCount: 0,
      positionAmt: null,
      positionSide: null
    }
  ): LiveLifecycleClosureEvaluation => ({
    decision,
    reason,
    timestamp: input.timestamp,
    lifecycleId: lifecycle.id,
    orderIntentId,
    relatedLocalOrderCount,
    matchingExchangeOpenOrderCount: evidence.matchingExchangeOpenOrderCount,
    sameSymbolUnmatchedExchangeOpenOrderCount: evidence.sameSymbolUnmatchedExchangeOpenOrderCount,
    positionAmt: evidence.positionAmt,
    positionSide: evidence.positionSide,
    matchMethod: orderIntentId ? "orderIntentId" : null
  });

  if (
    lifecycle.status === "CLOSED" ||
    lifecycle.status === "CLOSING" ||
    lifecycle.status === "REJECTED" ||
    lifecycle.status === "ERROR"
  ) {
    return finish("CANNOT_CLOSE", "Lifecycle is already terminal or closing.");
  }

  if (lifecycle.status !== "OPEN" && lifecycle.status !== "MANAGING") {
    return finish("AMBIGUOUS", "Lifecycle is not OPEN or MANAGING.");
  }

  if (!orderIntentId) {
    return finish("AMBIGUOUS", "lifecycle.orderIntentId is required for closure evaluation.");
  }

  if (input.relatedLocalOrders === null) {
    return finish("AMBIGUOUS", "Related order chain cannot be loaded.");
  }

  if (input.relatedLocalOrders.length === 0) {
    return finish(
      "AMBIGUOUS",
      "Exchange/lifecycle evidence is symbol-only without an orderIntentId chain."
    );
  }

  const rootRelatedOrders = input.relatedLocalOrders.filter(
    (order) => normalizeText(order.intentId) === orderIntentId && normalizeText(order.parentOrderId) === null
  );

  if (rootRelatedOrders.length !== 1) {
    return finish("AMBIGUOUS", "Multiple possible lifecycle/order matches for orderIntentId.");
  }

  if (input.relatedLocalOrders.some((order) => normalizeSymbol(order.symbol) !== lifecycleSymbol)) {
    return finish("AMBIGUOUS", "Related order chain contains a different symbol.");
  }

  if (input.exchangePositions === null) {
    return finish("AMBIGUOUS", "Exchange position evidence is missing or unknown.");
  }

  const symbolPositions = input.exchangePositions.filter(
    (position) => normalizeSymbol(position.symbol) === lifecycleSymbol
  );

  if (symbolPositions.length === 0) {
    return finish("AMBIGUOUS", "Exchange position evidence is missing or unknown.");
  }

  for (const position of symbolPositions) {
    const parsedPositionAmt = parseExchangePositionAmt(position);
    if (parsedPositionAmt === null) {
      return finish("AMBIGUOUS", "Exchange positionAmt is missing or unknown.", {
        matchingExchangeOpenOrderCount: 0,
        sameSymbolUnmatchedExchangeOpenOrderCount: 0,
        positionAmt: null,
        positionSide: position.positionSide
      });
    }

    if (parsedPositionAmt !== 0) {
      return finish("CANNOT_CLOSE", "Exchange positionAmt is not zero.", {
        matchingExchangeOpenOrderCount: 0,
        sameSymbolUnmatchedExchangeOpenOrderCount: 0,
        positionAmt: parsedPositionAmt,
        positionSide: position.positionSide
      });
    }
  }

  if (symbolPositions.length !== 1) {
    return finish("AMBIGUOUS", "Hedge positionSide cannot be resolved for lifecycle closure.");
  }

  const exchangePosition = symbolPositions[0];
  if (!exchangePosition || exchangePosition.positionSide !== "BOTH") {
    return finish("AMBIGUOUS", "Hedge positionSide cannot be resolved for lifecycle closure.");
  }

  const activeProtectiveRelatedOrders = input.relatedLocalOrders.filter(
    (order) => isActiveRelatedLocalOrder(order) && isProtectiveOrReduceOnlyLocalOrder(order)
  );
  if (activeProtectiveRelatedOrders.length > 0) {
    return finish("CANNOT_CLOSE", "Active protective/reduceOnly related local order blocks closure.", {
      matchingExchangeOpenOrderCount: 0,
      sameSymbolUnmatchedExchangeOpenOrderCount: 0,
      positionAmt: 0,
      positionSide: exchangePosition.positionSide
    });
  }

  const activeRelatedLocalOrders = input.relatedLocalOrders.filter(isActiveRelatedLocalOrder);
  if (activeRelatedLocalOrders.length > 0) {
    return finish("CANNOT_CLOSE", "Active related local order blocks closure.", {
      matchingExchangeOpenOrderCount: 0,
      sameSymbolUnmatchedExchangeOpenOrderCount: 0,
      positionAmt: 0,
      positionSide: exchangePosition.positionSide
    });
  }

  const nonTerminalRelatedLocalOrders = input.relatedLocalOrders.filter(
    (order) => !isTerminalOrderStatus(order.status)
  );
  if (nonTerminalRelatedLocalOrders.length > 0) {
    return finish("CANNOT_CLOSE", "Related local orders are not all terminal.", {
      matchingExchangeOpenOrderCount: 0,
      sameSymbolUnmatchedExchangeOpenOrderCount: 0,
      positionAmt: 0,
      positionSide: exchangePosition.positionSide
    });
  }

  const relatedClientOrderIds = new Set(
    input.relatedLocalOrders
      .map((order) => normalizeText(order.clientOrderId))
      .filter((clientOrderId): clientOrderId is string => clientOrderId !== null)
  );
  const relatedExchangeOrderIds = new Set(
    input.relatedLocalOrders
      .map((order) => normalizeText(order.exchangeOrderId))
      .filter((exchangeOrderId): exchangeOrderId is string => exchangeOrderId !== null)
  );
  const matchesRelatedExchangeOrder = (order: RestFuturesOrder): boolean => {
    const clientOrderId = normalizeText(order.clientOrderId);
    const exchangeOrderId = exchangeOrderIdText(order);
    return (
      (clientOrderId !== null && relatedClientOrderIds.has(clientOrderId)) ||
      (exchangeOrderId !== null && relatedExchangeOrderIds.has(exchangeOrderId))
    );
  };

  const matchingExchangeOpenOrders = input.exchangeOpenOrders.filter(matchesRelatedExchangeOrder);
  const sameSymbolUnmatchedExchangeOpenOrders = input.exchangeOpenOrders.filter(
    (order) => normalizeSymbol(order.symbol) === lifecycleSymbol && !matchesRelatedExchangeOrder(order)
  );

  const exchangeEvidence = {
    matchingExchangeOpenOrderCount: matchingExchangeOpenOrders.length,
    sameSymbolUnmatchedExchangeOpenOrderCount: sameSymbolUnmatchedExchangeOpenOrders.length,
    positionAmt: 0,
    positionSide: exchangePosition.positionSide
  };

  if (matchingExchangeOpenOrders.some(isProtectiveOrReduceOnlyExchangeOrder)) {
    return finish(
      "CANNOT_CLOSE",
      "Related protective/reduceOnly exchange open order blocks closure.",
      exchangeEvidence
    );
  }

  if (matchingExchangeOpenOrders.length > 0) {
    return finish("CANNOT_CLOSE", "Related exchange open order blocks closure.", exchangeEvidence);
  }

  if (sameSymbolUnmatchedExchangeOpenOrders.length > 0) {
    return finish(
      "AMBIGUOUS",
      "Exchange open order exists with same symbol but cannot be matched to local order.",
      exchangeEvidence
    );
  }

  return finish(
    "CAN_CLOSE",
    "Lifecycle has orderIntentId identity, zero BOTH position, terminal related local orders, and no related exchange open orders.",
    exchangeEvidence
  );
};

const mergeRiskLimits = (
  overrides: Partial<OrderRiskLimits> | undefined
): OrderRiskLimits => ({
  maxPositionSize: {
    ...DEFAULT_ORDER_RISK_LIMITS.maxPositionSize,
    ...overrides?.maxPositionSize
  },
  maxAccountExposure: {
    ...DEFAULT_ORDER_RISK_LIMITS.maxAccountExposure,
    ...overrides?.maxAccountExposure
  },
  maxLeverage: {
    ...DEFAULT_ORDER_RISK_LIMITS.maxLeverage,
    ...overrides?.maxLeverage
  },
  maxDailyLoss: {
    ...DEFAULT_ORDER_RISK_LIMITS.maxDailyLoss,
    ...overrides?.maxDailyLoss
  }
});

const cloneValidation = (validation: OrderValidationPayload): OrderValidationPayload => ({
  accepted: validation.accepted,
  paperMode: validation.paperMode,
  checks: validation.checks.map((check) => ({ ...check })),
  normalizedQuantity: validation.normalizedQuantity,
  normalizedPrice: validation.normalizedPrice,
  notional: validation.notional,
  riskLimits: {
    maxPositionSize: { ...validation.riskLimits.maxPositionSize },
    maxAccountExposure: { ...validation.riskLimits.maxAccountExposure },
    maxLeverage: { ...validation.riskLimits.maxLeverage },
    maxDailyLoss: { ...validation.riskLimits.maxDailyLoss }
  }
});

const mapBinanceStatus = (
  status: OrderTradeUpdateEvent["o"]["X"]
): OrderLifecycleStatus => {
  if (status === "EXPIRED_IN_MATCH") {
    return "EXPIRED";
  }

  return status;
};

const mapBinanceOrderType = (
  value: OrderTradeUpdateEvent["o"]["o"]
): OrderType => {
  if (value === "MARKET") {
    return "MARKET";
  }

  if (value === "STOP" || value === "STOP_MARKET") {
    return "STOP_MARKET";
  }

  if (value === "TAKE_PROFIT" || value === "TAKE_PROFIT_MARKET") {
    return "TAKE_PROFIT_MARKET";
  }

  return "LIMIT";
};

const liveTestnetAuditEventForStatus = (status: OrderLifecycleStatus): string => {
  if (status === "NEW") {
    return "LIVE_TESTNET_ORDER_NEW";
  }

  if (status === "PARTIALLY_FILLED") {
    return "LIVE_TESTNET_ORDER_PARTIALLY_FILLED";
  }

  if (status === "FILLED") {
    return "LIVE_TESTNET_ORDER_FILLED";
  }

  if (status === "CANCELED") {
    return "LIVE_TESTNET_ORDER_CANCELED";
  }

  if (status === "REJECTED") {
    return "LIVE_TESTNET_ORDER_REJECTED";
  }

  if (status === "EXPIRED") {
    return "LIVE_TESTNET_ORDER_EXPIRED";
  }

  return "binance_order_trade_update";
};

const liveTestnetOrderIntentSubmittedEventType = "LIVE_TESTNET_ORDER_INTENT_SUBMITTED";
const liveTestnetCancelIntentSubmittedEventType = "LIVE_TESTNET_CANCEL_INTENT_SUBMITTED";

interface LiveSubmittedIntentAuditPayload {
  intentId: string;
  action: "PLACE_ORDER";
  paperMode: false;
  symbol: string;
  side: OrderStatePayload["side"];
  orderType: OrderStatePayload["orderType"];
  quantity: number;
  price: number | null;
  stopPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  reduceOnly: boolean;
  decisionContextId: string | null;
  preflightId: string | null;
  preflightNonce: string | null;
  sourceWindowId: string | null;
  createdAt: number;
  clientOrderId: string;
  preSubmitIntentPersisted: boolean;
  preSubmitIntentPersistedAt: number;
  preSubmitIntentStatus: StoredPreSubmitOrderIntentRecord["status"];
  canonicalIntentOrderId: string;
}

interface LiveSubmittedCancelIntentAuditPayload {
  cancelIntentId: string;
  targetIntentId: string | null;
  targetClientOrderId: string;
  targetOrderId: string;
  symbol: string;
  classification: CancelRiskClassification;
  reason: string;
  paperMode: false;
  sourceWindowId: string | null;
  createdAt: number;
}

const buildLiveSubmittedIntentAuditPayload = (
  intent: NormalizedPlaceIntent,
  order: OrderStatePayload,
  preSubmitIntent: StoredPreSubmitOrderIntentRecord
): LiveSubmittedIntentAuditPayload => ({
  intentId: intent.intentId,
  action: "PLACE_ORDER",
  paperMode: false,
  symbol: order.symbol,
  side: order.side,
  orderType: order.orderType,
  quantity: order.quantity,
  price: order.price,
  stopPrice: order.stopPrice,
  stopLossPrice: order.stopLossPrice,
  takeProfitPrice: order.takeProfitPrice,
  reduceOnly: order.reduceOnly,
  decisionContextId: intent.decisionContextId,
  preflightId: intent.preflightId,
  preflightNonce: intent.preflightNonce,
  sourceWindowId: order.sourceWindowId,
  createdAt: intent.createdAt,
  clientOrderId: order.clientOrderId,
  preSubmitIntentPersisted: true,
  preSubmitIntentPersistedAt: preSubmitIntent.persistedAt,
  preSubmitIntentStatus: preSubmitIntent.status,
  canonicalIntentOrderId: preSubmitIntent.orderId
});

const buildLiveSubmittedCancelIntentAuditPayload = (
  intent: NormalizedCancelIntent,
  target: CancelTargetResolution
): LiveSubmittedCancelIntentAuditPayload => ({
  cancelIntentId: intent.intentId,
  targetIntentId: target.order?.intentId ?? null,
  targetClientOrderId: target.targetClientOrderId ?? intent.targetClientOrderId,
  targetOrderId: target.targetOrderId ?? intent.targetClientOrderId,
  symbol: target.order?.symbol ?? intent.symbol ?? "UNKNOWN",
  classification: target.classification,
  reason: target.reason,
  paperMode: false,
  sourceWindowId: intent.sourceWindowId,
  createdAt: intent.createdAt
});

const buildExecutionCommand = (input: {
  type: ExecutionCommand["type"];
  intentId: string | null;
  decisionId?: string | null;
  symbol: string;
  quantity: number;
  metadata?: Readonly<Record<string, unknown>>;
}): ExecutionCommand => ({
  type: input.type,
  intentId: normalizeText(input.intentId) ?? "UNKNOWN_INTENT",
  decisionId: normalizeText(input.decisionId),
  symbol: normalizeSymbol(input.symbol) ?? "UNKNOWN",
  quantity: Number.isFinite(input.quantity) ? input.quantity : 0,
  metadata: Object.freeze({ ...(input.metadata ?? {}) })
});

export class BinanceOrderService {
  private readonly pendingTimers = new Map<string, NodeJS.Timeout[]>();
  private readonly boundPreflights = new Map<string, BoundPreflightRecord>();
  private readonly execution: ExecutionFacade;
  private readonly riskLimits: OrderRiskLimits;
  private liveTradingDisabledByRuntime = false;
  private activePaperProtectiveLegs = 0;
  private paperProtectiveTriggers = 0;
  private lastPaperProtectiveTriggerAt: number | null = null;

  constructor(
    private readonly restBase: string,
    private readonly options: BinanceOrderServiceOptions
  ) {
    this.execution = new ExecutionFacade({
      auditEmitter: (message) => this.emit(message),
      lifecycleEmitter: (message) => this.emit(message)
    });
    this.riskLimits = mergeRiskLimits(options.riskLimits);
    if (options.apiKey?.trim() && options.apiSecret?.trim()) {
      ensureBinanceTimeSyncStarted(this.restBase);
    }
    this.recoverPendingPaperMarketOrders();
    if (!options.skipStartupRecovery) {
      void this.recoverLivePositionLifecyclesAuditOnly().catch((error) => {
        console.warn("Live position lifecycle startup recovery failed", error);
      });
    }
  }

  disableLiveTrading(reason = "Live trading disabled by runtime kill switch."): void {
    this.liveTradingDisabledByRuntime = true;
    this.emit({
      type: "order_error",
      generatedAt: Date.now(),
      payload: {
        intentId: null,
        code: "LIVE_TRADING_DISABLED",
        message: reason,
        retriable: false
      }
    });
  }

  dispose(): void {
    for (const timers of this.pendingTimers.values()) {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }

    this.pendingTimers.clear();
  }

  async handleIntent(
    payload: OrderIntentMessage["payload"],
    context: OrderIntentContext
  ): Promise<void> {
    const meta = this.normalizeIntentMeta(payload);

    if (!meta) {
      this.emitOrderError({
        intentId: normalizeText(payload.intentId),
        code: "invalid_intent",
        message: "order_intent requires a valid intentId and createdAt timestamp.",
        retriable: false
      });
      return;
    }

    const duplicate = orderRepository.getIntentResponse(meta.intentId);
    if (duplicate) {
      this.replayIntentResponse(duplicate);
      return;
    }

    if (!meta.paperMode && payload.action === "PLACE_ORDER") {
      const submittedIntentAudit = orderRepository.findOrderAuditEventByIntentIdAndType(
        meta.intentId,
        liveTestnetOrderIntentSubmittedEventType
      );
      if (submittedIntentAudit) {
        this.replaySubmittedIntentInFlight(meta.intentId);
        return;
      }
    }

    if (!meta.paperMode && payload.action === "CANCEL_ORDER") {
      const submittedCancelIntentAudit =
        orderRepository.findOrderAuditEventByIntentIdAndType<LiveSubmittedCancelIntentAuditPayload>(
          meta.intentId,
          liveTestnetCancelIntentSubmittedEventType
        );
      if (submittedCancelIntentAudit) {
        this.replayCancelIntentInFlight(meta.intentId, submittedCancelIntentAudit.payload);
        return;
      }
    }

    const decisionContextError = this.linkExplicitDecisionContext(meta, payload);
    if (decisionContextError) {
      this.persistIntentError(meta, decisionContextError);
      return;
    }

    if (!meta.paperMode) {
      const liveGateError = this.validateLiveGate(payload, meta);
      if (liveGateError) {
        this.persistLiveIntentRejectedAudit(payload, meta, liveGateError);
        this.persistIntentError(meta, liveGateError);
        return;
      }
    }

    if (payload.action === "CANCEL_ORDER") {
      const normalizedCancelIntent = this.normalizeCancelIntent(payload, meta);

      if (!normalizedCancelIntent) {
        this.persistIntentError(meta, {
          code: "invalid_cancel_intent",
          message: "Cancel intents require targetClientOrderId.",
          retriable: false
        });
        return;
      }

      await this.handleCancelIntent(normalizedCancelIntent, context);
      return;
    }

    if (payload.action === "CLOSE_PAPER_POSITION") {
      const normalizedCloseIntent = this.normalizeClosePaperPositionIntent(payload, meta);

      if (!normalizedCloseIntent) {
        this.persistIntentError(meta, {
          code: "invalid_close_paper_position_intent",
          message: "Close paper position intents require paperPositionId and symbol.",
          retriable: false
        });
        return;
      }

      this.handleClosePaperPositionIntent(normalizedCloseIntent, context);
      return;
    }

    const normalizedPlaceIntent = this.normalizePlaceIntent(payload, meta);

    if (!normalizedPlaceIntent) {
      this.persistIntentError(meta, {
        code: "invalid_place_intent",
        message:
          "Place intents require symbol, side, orderType, and a positive quantity.",
        retriable: false
      });
      return;
    }

    try {
      await this.handlePlaceIntent(normalizedPlaceIntent, context);
    } catch (error) {
      this.persistIntentError(meta, {
        code: "order_intent_failed",
        message: error instanceof Error ? error.message : "Order intent failed.",
        retriable: false
      });
    }
  }

  handleOrderTradeUpdate(event: OrderTradeUpdateEvent): void {
    const existing = orderRepository.getOrderByClientOrderId(event.o.c);
    const status = mapBinanceStatus(event.o.X);
    const price = safeNumber(event.o.p);
    const avgPrice = safeNumber(event.o.ap);
    const stopPrice = safeNumber(event.o.sp);
    const lastFilledQty = safeNumber(event.o.l);
    const lastFilledPrice = safeNumber(event.o.L);
    const realizedPnl = safeNumber(event.o.rp);
    const commission = safeNumber(event.o.n);
    const nextOrder: OrderStatePayload = {
      orderId: existing?.orderId ?? randomUUID(),
      intentId: existing?.intentId ?? null,
      symbol: event.o.s,
      side: event.o.S,
      orderType: mapBinanceOrderType(event.o.o),
      quantity: safeNumber(event.o.q),
      price: price > 0 ? price : existing?.price ?? null,
      stopPrice: stopPrice > 0 ? stopPrice : existing?.stopPrice ?? null,
      stopLossPrice: existing?.stopLossPrice ?? null,
      takeProfitPrice: existing?.takeProfitPrice ?? null,
      status,
      clientOrderId: event.o.c,
      exchangeOrderId: String(event.o.i),
      sourceWindowId: existing?.sourceWindowId ?? null,
      parentOrderId: existing?.parentOrderId ?? null,
      protectiveKind: existing?.protectiveKind ?? null,
      dryRun: existing?.dryRun ?? false,
      reduceOnly: Boolean(event.o.R ?? existing?.reduceOnly ?? false),
      executedQty: safeNumber(event.o.z),
      avgPrice: avgPrice > 0 ? avgPrice : existing?.avgPrice ?? null,
      lastFilledQty,
      realizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : existing?.realizedPnl ?? null,
      commission: Number.isFinite(commission) ? commission : existing?.commission ?? null,
      commissionAsset: event.o.N ?? existing?.commissionAsset ?? null,
      lastExecutionType: event.o.x,
      lastTradeTime: event.o.T ?? event.T ?? event.E,
      rejectReason:
        status === "REJECTED"
          ? existing?.rejectReason ?? "Binance rejected the order."
          : existing?.rejectReason ?? null,
      createdAt: existing?.createdAt ?? event.o.T ?? event.T ?? event.E,
      updatedAt: event.E,
      lastEventSource: "binance_stream"
    };

    orderRepository.upsertOrderState(nextOrder);
    if (Number.isFinite(realizedPnl) && realizedPnl !== 0) {
      orderRepository.appendRealizedPnlLedgerEntry({
        id: randomUUID(),
        idempotencyKey: [
          "binance-order-trade-update",
          event.o.c,
          String(event.o.t ?? "no-trade-id"),
          String(event.o.T ?? event.T ?? event.E),
          String(realizedPnl)
        ].join(":"),
        source: "binance_order_trade_update",
        eventTime: event.o.T ?? event.T ?? event.E,
        symbol: nextOrder.symbol,
        orderId: nextOrder.orderId,
        clientOrderId: nextOrder.clientOrderId,
        exchangeOrderId: nextOrder.exchangeOrderId,
        tradeId: event.o.t != null ? String(event.o.t) : null,
        realizedPnl,
        commission: Number.isFinite(commission) ? commission : null,
        commissionAsset: event.o.N ?? null
      });
    }

    if (isTerminalOrderStatus(nextOrder.status)) {
      this.clearPendingTimers(nextOrder.clientOrderId);
    }

    this.emitOrderStatus(nextOrder);
    const auditEventType = nextOrder.dryRun
      ? "binance_order_trade_update"
      : liveTestnetAuditEventForStatus(nextOrder.status);
    this.emitAuditEvent(
      nextOrder,
      auditEventType,
      `Binance user data stream updated order to ${nextOrder.status}.`,
      {
        executionType: event.o.x,
        exchangeOrderId: nextOrder.exchangeOrderId,
        lastFilledQty,
        lastFilledPrice,
        realizedPnl,
        commission,
        commissionAsset: event.o.N ?? null,
        tradeId: event.o.t ?? null
      },
      event.E
    );
  }

  handleMarketPriceBatch(prices: PaperProtectiveMarketPrice[]): void {
    const priceBySymbol = new Map<string, { markPrice: number | null; lastPrice: number | null }>();

    for (const price of prices) {
      const symbol = normalizeSymbol(price.symbol);
      if (!symbol) {
        continue;
      }

      const markPrice = safeNumber(price.markPrice);
      const lastPrice = safeNumber(price.lastPrice);
      priceBySymbol.set(symbol, {
        markPrice: markPrice > 0 ? markPrice : null,
        lastPrice: lastPrice > 0 ? lastPrice : null
      });
    }

    if (priceBySymbol.size === 0) {
      this.activePaperProtectiveLegs = 0;
      return;
    }

    this.updateOpenPaperPositions(priceBySymbol);
    this.fillTouchedPaperLimitOrders(priceBySymbol);

    const activeLegs = orderRepository.listActivePaperProtectiveLegsForSymbols(
      Array.from(priceBySymbol.keys())
    );
    this.activePaperProtectiveLegs = activeLegs.length;

    for (const leg of activeLegs) {
      const marketPrice = priceBySymbol.get(leg.symbol);
      const triggerPrice = leg.stopPrice ?? leg.price;
      const referencePrice = marketPrice?.markPrice ?? marketPrice?.lastPrice ?? null;

      if (!isPositiveNumber(triggerPrice) || !isPositiveNumber(referencePrice)) {
        continue;
      }

      const parent = leg.parentOrderId
        ? orderRepository.getOrderByOrderId(leg.parentOrderId)
        : null;
      const entrySide = parent?.side ?? flipOrderSide(leg.side);

      if (!this.shouldTriggerProtectiveLeg(leg, entrySide, referencePrice, triggerPrice)) {
        continue;
      }

      this.triggerPaperProtectiveLeg({
        leg,
        parent,
        referencePrice,
        triggerPrice,
        markPrice: marketPrice?.markPrice ?? null,
        lastPrice: marketPrice?.lastPrice ?? null
      });
    }
  }

  getPaperProtectiveTelemetry(): PaperProtectiveTelemetry {
    return {
      activePaperProtectiveLegs: this.activePaperProtectiveLegs,
      paperProtectiveTriggers: this.paperProtectiveTriggers,
      lastPaperProtectiveTriggerAt: this.lastPaperProtectiveTriggerAt
    };
  }

  async validateOrderPreflight(
    payload: RequestOrderPreflightMessage["payload"],
    context: OrderIntentContext
  ): Promise<OrderValidationPayload> {
    const paperMode = payload.paperMode ?? this.options.defaultPaperMode;
    const invalidValidation = (message: string): OrderValidationPayload => ({
      accepted: false,
      paperMode,
      checks: [
        {
          code: "preflight_payload",
          passed: false,
          blocking: true,
          message
        }
      ],
      normalizedQuantity: 0,
      normalizedPrice: null,
      notional: null,
      riskLimits: mergeRiskLimits(this.riskLimits)
    });
    const requestId = normalizeText(payload.requestId);
    const createdAt =
      typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt)
        ? payload.createdAt
        : null;

    if (!requestId) {
      return invalidValidation("order preflight requires a valid requestId.");
    }

    if (createdAt === null) {
      return invalidValidation("order preflight requires a valid createdAt timestamp.");
    }

    const normalizedIntent = this.normalizePreflightPlaceIntent(payload, paperMode);

    if (!normalizedIntent) {
      return invalidValidation("order preflight requires symbol, side, type and positive quantity.");
    }

    return this.validatePlaceIntent(normalizedIntent, context);
  }

  bindPreflight(input: BindPreflightInput): void {
    const normalizedIntent = this.normalizePreflightPlaceIntent(input.payload, input.paperMode);
    const canonicalPayload = normalizedIntent
      ? buildCanonicalPreflightPayload(normalizedIntent)
      : null;
    const { payload, ...boundRecord } = input;

    this.boundPreflights.set(input.preflightId, {
      ...boundRecord,
      canonicalPayload,
      lockedIntentId: null,
      lockedAt: null
    });
    this.gcBoundPreflights(Date.now());
  }

  hasRuntimeBoundPreflight(preflightId: string, now = Date.now()): boolean {
    const normalizedPreflightId = normalizeText(preflightId);
    if (!normalizedPreflightId) {
      return false;
    }

    const bound = this.boundPreflights.get(normalizedPreflightId);
    if (!bound) {
      return false;
    }

    if (now >= bound.expiresAt) {
      this.boundPreflights.delete(normalizedPreflightId);
      orderPreflightRepository.expireActivePreflight(
        normalizedPreflightId,
        now,
        "ACTIVE preflight expired before runtime reuse."
      );
      return false;
    }

    return true;
  }

  private markConsumedPreflight(intent: NormalizedPlaceIntent, consumedAt: number): void {
    if (!intent.preflightId) {
      return;
    }

    const persisted = orderPreflightRepository.markUsed(
      intent.preflightId,
      consumedAt,
      `Consumed by OrderIntent ${intent.intentId}.`
    );

    if (!persisted || persisted.status !== "USED") {
      return;
    }

    this.emit({
      type: "order_preflight_invalidated",
      generatedAt: consumedAt,
      payload: {
        preflightId: persisted.id,
        requestId: persisted.requestId,
        ticketKey: this.boundPreflights.get(persisted.id)?.ticketKey ?? null,
        status: "USED",
        reason: persisted.reason ?? "Preflight was consumed by a confirmed order.",
        occurredAt: persisted.usedAt ?? consumedAt
      }
    });
  }

  private normalizePreflightPlaceIntent(
    payload: RequestOrderPreflightMessage["payload"],
    paperMode: boolean
  ): NormalizedPlaceIntent | null {
    const requestId = normalizeText(payload.requestId);
    const createdAt =
      typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt)
        ? payload.createdAt
        : null;

    if (!requestId || createdAt === null) {
      return null;
    }

    return this.normalizePlaceIntent(
      {
        intentId: requestId,
        createdAt,
        action: "PLACE_ORDER",
        symbol: payload.symbol,
        side: payload.side,
        orderType: payload.type,
        quantity: payload.quantity,
        price: payload.price ?? null,
        stopPrice: payload.stopPrice ?? null,
        decisionContextId: null,
        reduceOnly: payload.reduceOnly === true,
        paperMode,
        ...(typeof payload.stopLossPrice === "number" && Number.isFinite(payload.stopLossPrice)
          ? { stopLossPrice: payload.stopLossPrice }
          : {}),
        ...(typeof payload.takeProfitPrice === "number" && Number.isFinite(payload.takeProfitPrice)
          ? { takeProfitPrice: payload.takeProfitPrice }
          : {})
      },
      {
        intentId: requestId,
        createdAt,
        sourceWindowId: null,
        paperMode,
        preflightId: null,
        preflightNonce: null,
        unifiedSignalId: null,
        decisionContextId: null,
        reviewCorrelationId: null
      }
    );
  }

  private linkExplicitDecisionContext(
    meta: NormalizedIntentMeta,
    payload: OrderIntentMessage["payload"]
  ): { code: string; message: string; retriable: boolean } | null {
    const requiresDecisionContext =
      !meta.paperMode && payload.action === "PLACE_ORDER";

    if (requiresDecisionContext && !meta.decisionContextId) {
      return {
        code: "NO_DECISION_CONTEXT",
        message: "NO_DECISION_CONTEXT: non-paper PLACE_ORDER requires decisionContextId.",
        retriable: false
      };
    }

    if (!meta.decisionContextId) {
      return null;
    }

    const context = tradeDecisionRepository.getTradeDecisionContextById(meta.decisionContextId);
    if (!context) {
      return {
        code: "DECISION_CONTEXT_NOT_FOUND",
        message: "DECISION_CONTEXT_NOT_FOUND: explicit decisionContextId was not found.",
        retriable: false
      };
    }

    if (requiresDecisionContext && context.decision !== "ENTER") {
      return {
        code: "DECISION_CONTEXT_NOT_ENTER",
        message: "DECISION_CONTEXT_NOT_ENTER: non-paper PLACE_ORDER requires an ENTER TradeDecisionContext.",
        retriable: false
      };
    }

    const submittedSymbol = normalizeSymbol(payload.symbol);
    const contextSymbol = normalizeSymbol(context.symbol);
    if (
      requiresDecisionContext &&
      submittedSymbol &&
      contextSymbol &&
      contextSymbol !== submittedSymbol
    ) {
      return {
        code: "DECISION_CONTEXT_SYMBOL_MISMATCH",
        message:
          "DECISION_CONTEXT_SYMBOL_MISMATCH: TradeDecisionContext symbol must match PLACE_ORDER symbol.",
        retriable: false
      };
    }

    tradeDecisionRepository.linkTradeDecisionContextToOrder({
      id: meta.decisionContextId,
      orderIntentId: meta.intentId,
      reviewCorrelationId: meta.reviewCorrelationId,
      updatedAt: Date.now()
    });

    return null;
  }

  private normalizeIntentMeta(
    payload: OrderIntentMessage["payload"]
  ): NormalizedIntentMeta | null {
    const intentId = normalizeText(payload.intentId);
    const createdAt =
      typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt)
        ? payload.createdAt
        : null;

    if (!intentId || createdAt === null) {
      return null;
    }

    return {
      intentId,
      createdAt,
      sourceWindowId: normalizeText(payload.sourceWindowId),
      paperMode: payload.paperMode ?? this.options.defaultPaperMode,
      preflightId: normalizeText(payload.preflightId),
      preflightNonce: normalizeText(payload.preflightNonce),
      unifiedSignalId: normalizeText(payload.unifiedSignalId),
      decisionContextId: normalizeText(payload.decisionContextId),
      reviewCorrelationId: normalizeText(payload.reviewCorrelationId)
    };
  }

  private validateLiveGate(
    payload: OrderIntentMessage["payload"],
    meta: NormalizedIntentMeta
  ): { code: string; message: string; retriable: boolean } | null {
    const decision = evaluateLiveReadiness({
      liveTradingEnabled: this.options.liveTradingEnabled,
      orderLiveModeEnabled: this.options.liveModeEnabled,
      paperModeDefault: this.options.defaultPaperMode,
      liveTradingRequiresTestnet: this.options.liveTradingRequiresTestnet,
      liveTradingRequireTypedConfirm: this.options.liveTradingRequireTypedConfirm,
      binanceFuturesTestnet: this.options.binanceFuturesTestnet,
      restBase: this.options.restBase ?? this.restBase,
      wsBase: this.options.wsBase,
      orderControlAuthRequired: this.options.orderControlAuthRequired,
      orderControlToken: this.options.orderControlToken,
      apiKey: this.options.apiKey,
      apiSecret: this.options.apiSecret,
      liveTradingKillSwitchEnabled: this.options.liveTradingKillSwitchEnabled,
      runtimeKillSwitchActive: this.liveTradingDisabledByRuntime,
      liveRiskLimits: this.options.liveRiskLimits
    });
    const preIntentReason = decision.disabledReasons.find(
      (reason) => reason.code !== "API_CREDENTIALS_MISSING" && reason.code !== "RISK_LIMIT_INVALID"
    );

    if (preIntentReason) {
      if (
        preIntentReason.code === "CONFIG_KILL_SWITCH_ACTIVE" ||
        preIntentReason.code === "RUNTIME_KILL_SWITCH_ACTIVE"
      ) {
        return {
          code: "LIVE_TRADING_DISABLED",
          message: "LIVE_TRADING_DISABLED: live trading kill switch is active.",
          retriable: false
        };
      }

      if (preIntentReason.code === "TESTNET_REQUIRED") {
        return {
          code: "LIVE_GATE_CHECK_FAILED",
          message: "LIVE_GATE_CHECK_FAILED: BINANCE_FUTURES_TESTNET=true is required.",
          retriable: false
        };
      }

      if (preIntentReason.code === "REST_BASE_NOT_TESTNET") {
        return {
          code: "LIVE_GATE_CHECK_FAILED",
          message: "LIVE_GATE_CHECK_FAILED: Binance testnet REST base is required.",
          retriable: false
        };
      }

      return {
        code: "LIVE_GATE_CHECK_FAILED",
        message: "LIVE_GATE_CHECK_FAILED: live trading is disabled by backend config.",
        retriable: false
      };
    }

    if (this.options.liveTradingRequireTypedConfirm && payload.confirmText !== "LIVE") {
      return {
        code: "LIVE_TYPED_CONFIRM_FAILED",
        message: "LIVE_TYPED_CONFIRM_FAILED: confirmText must exactly equal LIVE.",
        retriable: false
      };
    }

    const credentialsReason = decision.disabledReasons.find(
      (reason) => reason.code === "API_CREDENTIALS_MISSING"
    );
    if (credentialsReason) {
      return {
        code: "LIVE_GATE_CHECK_FAILED",
        message: "LIVE_GATE_CHECK_FAILED: Binance API credentials are required for testnet live execution.",
        retriable: false
      };
    }

    const riskLimitReason = decision.disabledReasons.find(
      (reason) => reason.code === "RISK_LIMIT_INVALID"
    );
    if (riskLimitReason) {
      return {
        code: "LIVE_GATE_CHECK_FAILED",
        message: `LIVE_GATE_CHECK_FAILED: ${riskLimitReason.message}`,
        retriable: false
      };
    }

    return null;
  }

  private normalizePlaceIntent(
    payload: OrderIntentMessage["payload"],
    meta: NormalizedIntentMeta
  ): NormalizedPlaceIntent | null {
    const symbol = normalizeSymbol(payload.symbol);
    const quantity =
      typeof payload.quantity === "number" && Number.isFinite(payload.quantity)
        ? payload.quantity
        : null;
    const price =
      typeof payload.price === "number" && Number.isFinite(payload.price)
        ? payload.price
        : null;
    const stopPrice =
      typeof payload.stopPrice === "number" && Number.isFinite(payload.stopPrice)
        ? payload.stopPrice
        : null;
    const stopLossPrice =
      typeof payload.stopLossPrice === "number" && Number.isFinite(payload.stopLossPrice)
        ? payload.stopLossPrice
        : payload.orderType === "MARKET" || payload.orderType === "LIMIT"
          ? stopPrice
          : null;
    const takeProfitPrice =
      typeof payload.takeProfitPrice === "number" && Number.isFinite(payload.takeProfitPrice)
        ? payload.takeProfitPrice
        : null;
    const clientOrderId =
      normalizeText(payload.clientOrderId) ??
      `paper-${meta.intentId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || randomUUID()}`;

    if (
      !symbol ||
      (payload.side !== "BUY" && payload.side !== "SELL") ||
      (payload.orderType !== "MARKET" &&
        payload.orderType !== "LIMIT" &&
        payload.orderType !== "STOP_MARKET" &&
        payload.orderType !== "TAKE_PROFIT_MARKET") ||
      quantity === null ||
      quantity <= 0
    ) {
      return null;
    }

    return {
      ...meta,
      action: "PLACE_ORDER",
      symbol,
      side: payload.side,
      orderType: payload.orderType,
      quantity,
      price,
      stopPrice,
      stopLossPrice,
      takeProfitPrice,
      clientOrderId,
      reduceOnly: payload.reduceOnly === true
    };
  }

  private normalizeCancelIntent(
    payload: OrderIntentMessage["payload"],
    meta: NormalizedIntentMeta
  ): NormalizedCancelIntent | null {
    const targetClientOrderId = normalizeText(payload.targetClientOrderId);

    if (!targetClientOrderId) {
      return null;
    }

    return {
      ...meta,
      action: "CANCEL_ORDER",
      symbol: normalizeSymbol(payload.symbol),
      targetClientOrderId
    };
  }

  private normalizeClosePaperPositionIntent(
    payload: OrderIntentMessage["payload"],
    meta: NormalizedIntentMeta
  ): NormalizedClosePaperPositionIntent | null {
    const paperPositionId = normalizeText(payload.paperPositionId);
    const symbol = normalizeSymbol(payload.symbol);
    const quantity =
      typeof payload.quantity === "number" && Number.isFinite(payload.quantity)
        ? payload.quantity
        : null;

    if (!paperPositionId || !symbol) {
      return null;
    }

    return {
      ...meta,
      action: "CLOSE_PAPER_POSITION",
      paperPositionId,
      symbol,
      quantity
    };
  }

  private async handlePlaceIntent(
    intent: NormalizedPlaceIntent,
    context: OrderIntentContext
  ): Promise<void> {
    const preflightFailure = this.validateBoundPreflight(intent);
    if (preflightFailure) {
      this.persistIntentError(
        {
          intentId: intent.intentId,
          createdAt: intent.createdAt,
          sourceWindowId: intent.sourceWindowId,
          paperMode: intent.paperMode,
          preflightId: intent.preflightId,
          preflightNonce: intent.preflightNonce,
          unifiedSignalId: intent.unifiedSignalId,
          decisionContextId: intent.decisionContextId,
          reviewCorrelationId: intent.reviewCorrelationId
        },
        preflightFailure
      );
      return;
    }

    const lockedAt = Date.now();
    this.markConsumedPreflight(intent, lockedAt);
    const validation = await this.validatePlaceIntent(intent, context);
    const executionPrice =
      validation.normalizedPrice ?? context.row?.markPrice ?? context.row?.lastPrice ?? null;

    if (!validation.accepted) {
      const rejectedOrder = this.buildOrderState({
        intentId: intent.intentId,
        symbol: intent.symbol,
        side: intent.side,
        orderType: intent.orderType,
        quantity: validation.normalizedQuantity || intent.quantity,
        price: validation.normalizedPrice ?? intent.price,
        stopPrice: intent.stopPrice,
        stopLossPrice: intent.stopLossPrice,
        takeProfitPrice: intent.takeProfitPrice,
        status: "REJECTED",
        clientOrderId: intent.clientOrderId,
        sourceWindowId: intent.sourceWindowId,
        parentOrderId: null,
        protectiveKind: null,
        dryRun: intent.paperMode,
        reduceOnly: intent.reduceOnly,
        rejectReason: this.firstBlockingValidationMessage(validation),
        lastEventSource: "validation",
        createdAt: intent.createdAt,
        updatedAt: Date.now()
      });

      orderRepository.upsertOrderState(rejectedOrder);
      this.emitAuditEvent(
        rejectedOrder,
        "EXECUTION_TICKET_LOCKED",
        "OrderIntent locked to backend preflight snapshot before validation rejection.",
        {
          lifecycle: "Locked",
          preflightId: intent.preflightId,
          preflightNonce: intent.preflightNonce,
          decisionContextId: intent.decisionContextId,
          lockedAt
        },
        lockedAt
      );

      const rejectedMessage: OrderRejectedMessage = {
        type: "order_rejected",
        generatedAt: Date.now(),
        payload: {
          intentId: intent.intentId,
          duplicate: false,
          order: rejectedOrder,
          validation,
          message: rejectedOrder.rejectReason ?? "Order intent rejected."
        }
      };

      orderRepository.saveIntentResponse({
        intentId: intent.intentId,
        createdAt: intent.createdAt,
        sourceWindowId: intent.sourceWindowId,
        orderId: rejectedOrder.orderId,
        responseType: rejectedMessage.type,
        dryRun: rejectedOrder.dryRun,
        response: rejectedMessage
      });
      this.emitAuditEvent(
        rejectedOrder,
        "validation_rejected",
        rejectedOrder.rejectReason ?? "Order intent rejected by pre-trade validation.",
        validation,
        rejectedOrder.updatedAt
      );
      this.emit(rejectedMessage);
      this.emitOrderStatus(rejectedOrder);
      return;
    }

    if (!intent.paperMode) {
      await this.handleLivePlaceIntent(intent, validation);
      return;
    }

    const acceptedOrder = this.buildOrderState({
      intentId: intent.intentId,
      symbol: intent.symbol,
      side: intent.side,
      orderType: intent.orderType,
      quantity: validation.normalizedQuantity,
      price: intent.orderType === "MARKET"
        ? executionPrice
        : validation.normalizedPrice ?? intent.price,
      stopPrice: intent.stopPrice,
      stopLossPrice: intent.stopLossPrice,
      takeProfitPrice: intent.takeProfitPrice,
      status: "NEW",
      clientOrderId: intent.clientOrderId,
      sourceWindowId: intent.sourceWindowId,
      parentOrderId: null,
      protectiveKind: null,
      dryRun: intent.paperMode,
      reduceOnly: intent.reduceOnly,
      rejectReason: null,
      lastEventSource: "paper_engine",
      createdAt: intent.createdAt,
      updatedAt: Date.now()
    });

    const paperCommand = buildExecutionCommand({
      type: "PAPER",
      intentId: intent.intentId,
      decisionId: intent.decisionContextId,
      symbol: acceptedOrder.symbol,
      quantity: acceptedOrder.quantity,
      metadata: {
        sourceWindowId: acceptedOrder.sourceWindowId,
        orderType: acceptedOrder.orderType,
        dryRun: acceptedOrder.dryRun
      }
    });
    this.execution.validatePaperCommand(paperCommand, acceptedOrder);
    orderRepository.upsertOrderState(acceptedOrder);
    this.emitAuditEvent(
      acceptedOrder,
      "EXECUTION_TICKET_LOCKED",
      "OrderIntent locked to backend preflight snapshot.",
      {
        lifecycle: "Locked",
        preflightId: intent.preflightId,
        preflightNonce: intent.preflightNonce,
        decisionContextId: intent.decisionContextId,
        lockedAt
      },
      lockedAt
    );

    const ackMessage: OrderAckMessage = {
      type: "order_ack",
      generatedAt: Date.now(),
      payload: {
        intentId: intent.intentId,
        duplicate: false,
        order: acceptedOrder,
        validation,
        message: this.buildAcceptedOrderMessage(acceptedOrder)
      }
    };

    orderRepository.saveIntentResponse({
      intentId: intent.intentId,
      createdAt: intent.createdAt,
      sourceWindowId: intent.sourceWindowId,
      orderId: acceptedOrder.orderId,
      responseType: ackMessage.type,
      dryRun: acceptedOrder.dryRun,
      response: ackMessage
    });

    this.emitAuditEvent(
      acceptedOrder,
      "intent_accepted",
      ackMessage.payload.message,
      validation,
      acceptedOrder.updatedAt
    );
    this.emit(ackMessage);
    this.emitOrderStatus(acceptedOrder);

    if (acceptedOrder.dryRun && acceptedOrder.orderType !== "LIMIT") {
      this.schedulePaperLifecycle(acceptedOrder, executionPrice, {
        decisionContextId: intent.decisionContextId,
        unifiedSignalId: intent.unifiedSignalId
      });
    }
  }

  private validateBoundPreflight(intent: NormalizedPlaceIntent): {
    code: string;
    message: string;
    retriable: boolean;
  } | null {
    if (intent.paperMode) {
      return null;
    }

    const preflightId = intent.preflightId;
    const preflightNonce = intent.preflightNonce;
    if (!preflightId || !preflightNonce) {
      return {
        code: "PREFLIGHT_REQUIRED",
        message: "PREFLIGHT_REQUIRED: submit requires a backend preflight binding.",
        retriable: false
      };
    }

    this.gcBoundPreflights(Date.now());
    const bound = this.boundPreflights.get(preflightId);
    if (!bound) {
      return {
        code: "PREFLIGHT_MISSING",
        message: "PREFLIGHT_MISSING: backend preflight binding was not found or expired.",
        retriable: false
      };
    }

    if (bound.preflightNonce !== preflightNonce) {
      return {
        code: "PREFLIGHT_MISMATCH",
        message: "PREFLIGHT_MISMATCH: backend preflight nonce did not match the submit request.",
        retriable: false
      };
    }

    if (Date.now() >= bound.expiresAt) {
      this.boundPreflights.delete(preflightId);
      const expired = orderPreflightRepository.expireActivePreflight(
        preflightId,
        Date.now(),
        "ACTIVE preflight expired before order submit."
      );
      if (expired?.status === "EXPIRED") {
        this.emit({
          type: "order_preflight_invalidated",
          generatedAt: Date.now(),
          payload: {
            preflightId: expired.id,
            requestId: expired.requestId,
            ticketKey: bound.ticketKey,
            status: "EXPIRED",
            reason: expired.reason ?? "Preflight expired before order submit.",
            occurredAt: Date.now()
          }
        });
      }
      return {
        code: "PREFLIGHT_STALE",
        message: "PREFLIGHT_STALE: backend preflight binding has expired.",
        retriable: false
      };
    }

    if (bound.safeToAddStatus !== "ALLOW") {
      return {
        code: "PREFLIGHT_NOT_ALLOW",
        message: `PREFLIGHT_NOT_ALLOW: backend preflight Safe-To-Add status is ${bound.safeToAddStatus}.`,
        retriable: false
      };
    }

    if (!bound.canonicalPayload) {
      return {
        code: "PREFLIGHT_PAYLOAD_MISMATCH",
        message: "PREFLIGHT_PAYLOAD_MISMATCH: backend preflight payload binding is unavailable.",
        retriable: false
      };
    }

    const submitPayload = buildCanonicalPreflightPayload(intent);
    const mismatchedField = findCanonicalPreflightPayloadMismatch(
      bound.canonicalPayload,
      submitPayload
    );
    if (mismatchedField) {
      return {
        code: "PREFLIGHT_PAYLOAD_MISMATCH",
        message: `PREFLIGHT_PAYLOAD_MISMATCH: backend preflight ${mismatchedField} did not match the submit request.`,
        retriable: false
      };
    }

    if (bound.lockedIntentId && bound.lockedIntentId !== intent.intentId) {
      return {
        code: "ORDER_INTENT_LOCKED",
        message: "ORDER_INTENT_LOCKED: backend preflight is already locked to another OrderIntent.",
        retriable: false
      };
    }

    bound.lockedIntentId = intent.intentId;
    bound.lockedAt = Date.now();
    this.boundPreflights.set(preflightId, bound);
    return null;
  }

  private gcBoundPreflights(now: number): void {
    for (const [preflightId, record] of this.boundPreflights.entries()) {
      if (now >= record.expiresAt) {
        this.boundPreflights.delete(preflightId);
        const expired = orderPreflightRepository.expireActivePreflight(
          preflightId,
          now,
          "ACTIVE preflight expired during runtime cleanup."
        );
        if (expired?.status === "EXPIRED") {
          this.emit({
            type: "order_preflight_invalidated",
            generatedAt: now,
            payload: {
              preflightId: expired.id,
              requestId: expired.requestId,
              ticketKey: record.ticketKey,
              status: "EXPIRED",
              reason: expired.reason ?? "Preflight expired during runtime cleanup.",
              occurredAt: now
            }
          });
        }
      }
    }
  }

  private async handleLivePlaceIntent(
    intent: NormalizedPlaceIntent,
    validation: OrderValidationPayload
  ): Promise<void> {
    const apiKey = this.options.apiKey;
    const apiSecret = this.options.apiSecret;

    if (!apiKey || !apiSecret) {
      this.persistIntentError(intent, {
        code: "LIVE_GATE_CHECK_FAILED",
        message: "LIVE_GATE_CHECK_FAILED: Binance API credentials are required for testnet live execution.",
        retriable: false
      });
      return;
    }

    const parentOrderId = this.resolveReduceOnlyLifecycleParentOrderId(intent);
    const pendingOrder = this.buildOrderState({
      intentId: intent.intentId,
      symbol: intent.symbol,
      side: intent.side,
      orderType: intent.orderType,
      quantity: validation.normalizedQuantity,
      price: validation.normalizedPrice ?? intent.price,
      stopPrice: intent.stopPrice,
      stopLossPrice: intent.stopLossPrice,
      takeProfitPrice: intent.takeProfitPrice,
      status: "NEW",
      clientOrderId: intent.clientOrderId,
      sourceWindowId: intent.sourceWindowId,
      parentOrderId,
      protectiveKind: null,
      dryRun: false,
      reduceOnly: intent.reduceOnly,
      rejectReason: null,
      lastEventSource: "paper_engine",
      createdAt: intent.createdAt,
      updatedAt: Date.now()
    });

    const liveCommand = buildExecutionCommand({
      type: "LIVE",
      intentId: intent.intentId,
      decisionId: intent.decisionContextId,
      symbol: pendingOrder.symbol,
      quantity: pendingOrder.quantity,
      metadata: {
        sourceWindowId: pendingOrder.sourceWindowId,
        orderType: pendingOrder.orderType,
        dryRun: pendingOrder.dryRun
      }
    });
    this.execution.validateLiveCommand(liveCommand, pendingOrder);
    let preSubmitIntent: StoredPreSubmitOrderIntentRecord;
    try {
      orderRepository.upsertOrderState(pendingOrder);
      preSubmitIntent = this.persistAndVerifyPreSubmitOrderIntent(intent, pendingOrder);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pre-submit intent durability failed.";
      const rejectedOrder: OrderStatePayload = {
        ...pendingOrder,
        status: "REJECTED",
        rejectReason: `ORDER_INTENT_DURABILITY_FAILED: ${message}`,
        updatedAt: Date.now(),
        lastEventSource: "validation"
      };
      const rejectedMessage: OrderRejectedMessage = {
        type: "order_rejected",
        generatedAt: Date.now(),
        payload: {
          intentId: intent.intentId,
          duplicate: false,
          order: rejectedOrder,
          validation,
          message: rejectedOrder.rejectReason ?? "Order intent durability failed."
        }
      };

      try {
        orderRepository.upsertOrderState(rejectedOrder);
        orderRepository.saveIntentResponse({
          intentId: intent.intentId,
          createdAt: intent.createdAt,
          sourceWindowId: intent.sourceWindowId,
          orderId: rejectedOrder.orderId,
          responseType: rejectedMessage.type,
          dryRun: false,
          response: rejectedMessage
        });
        this.emitAuditEvent(
          rejectedOrder,
          "ORDER_INTENT_DURABILITY_BLOCKED_SUBMIT",
          "Blocked Binance REST submit because canonical pre-submit intent persistence failed.",
          {
            gateCode: "ORDER_INTENT_DURABILITY_FAILED",
            orderIntentId: intent.intentId,
            clientOrderId: intent.clientOrderId,
            symbol: intent.symbol,
            reduceOnly: intent.reduceOnly,
            error: message,
            submitAttempted: false
          },
          rejectedOrder.updatedAt
        );
      } catch (persistError) {
        console.warn("Order intent durability failure evidence persistence failed", persistError);
      }

      this.emit(rejectedMessage);
      this.emitOrderStatus(rejectedOrder);
      return;
    }

    this.emitAuditEvent(
      pendingOrder,
      liveTestnetOrderIntentSubmittedEventType,
      "Persisted durable pre-submit order intent before Binance REST submit.",
      buildLiveSubmittedIntentAuditPayload(intent, pendingOrder, preSubmitIntent),
      pendingOrder.updatedAt
    );
    const submitAttemptedAt = Date.now();
    this.emitAuditEvent(
      pendingOrder,
      "LIVE_TESTNET_ORDER_SEND",
      "Submitted locked OrderIntent to Binance Futures testnet.",
      {
        lifecycle: "Submitted",
        validation,
        orderIntentId: intent.intentId,
        clientOrderId: pendingOrder.clientOrderId,
        preSubmitIntentPersisted: true,
        preSubmitIntentPersistedAt: preSubmitIntent.persistedAt,
        submitAttemptedAt,
        persistedBeforeSubmit: preSubmitIntent.persistedAt <= submitAttemptedAt
      },
      submitAttemptedAt
    );

    try {
      const response = await placeFuturesOrder(this.restBase, apiKey, apiSecret, {
        symbol: pendingOrder.symbol,
        side: pendingOrder.side,
        type: pendingOrder.orderType,
        quantity: pendingOrder.quantity,
        price: pendingOrder.price,
        stopPrice: pendingOrder.stopPrice,
        reduceOnly: pendingOrder.reduceOnly,
        newClientOrderId: pendingOrder.clientOrderId
      });
      const liveOrder = this.buildOrderStateFromRestOrder(response, pendingOrder, "binance_stream");

      this.execution.validateLiveCommand(liveCommand, liveOrder);
      orderRepository.upsertOrderState(liveOrder);

      const ackMessage: OrderAckMessage = {
        type: "order_ack",
        generatedAt: Date.now(),
        payload: {
          intentId: intent.intentId,
          duplicate: false,
          order: liveOrder,
          validation,
          message: "Binance Futures testnet order accepted."
        }
      };

      orderRepository.saveIntentResponse({
        intentId: intent.intentId,
        createdAt: intent.createdAt,
        sourceWindowId: intent.sourceWindowId,
        orderId: liveOrder.orderId,
        responseType: ackMessage.type,
        dryRun: false,
        response: ackMessage
      });
      this.emit(ackMessage);
      this.emitOrderStatus(liveOrder);
      this.emitAuditEvent(
        liveOrder,
        "LIVE_TESTNET_ORDER_ACK",
        "Binance Futures testnet order acknowledged by REST.",
        {
          lifecycle: "Acknowledged",
          response
        },
        liveOrder.updatedAt
      );
      this.recordLiveOrderLifecycleAck({
        order: liveOrder,
        timestamp: Date.now(),
        decisionContextId: intent.decisionContextId,
        unifiedSignalId: intent.unifiedSignalId
      });
      await this.reconcileLiveTestnetOrder(liveOrder, apiKey, apiSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Binance testnet order failed.";
      const rejectedOrder: OrderStatePayload = {
        ...pendingOrder,
        status: "REJECTED",
        rejectReason: message,
        updatedAt: Date.now(),
        lastEventSource: "validation"
      };
      const rejectedMessage: OrderRejectedMessage = {
        type: "order_rejected",
        generatedAt: Date.now(),
        payload: {
          intentId: intent.intentId,
          duplicate: false,
          order: rejectedOrder,
          validation,
          message
        }
      };

      orderRepository.upsertOrderState(rejectedOrder);
      orderRepository.saveIntentResponse({
        intentId: intent.intentId,
        createdAt: intent.createdAt,
        sourceWindowId: intent.sourceWindowId,
        orderId: rejectedOrder.orderId,
        responseType: rejectedMessage.type,
        dryRun: false,
        response: rejectedMessage
      });
      this.emit(rejectedMessage);
      this.emitOrderStatus(rejectedOrder);
      this.emitAuditEvent(
        rejectedOrder,
        "LIVE_TESTNET_ORDER_REJECTED",
        message,
        { error: message },
        rejectedOrder.updatedAt
      );
    }
  }

  private persistAndVerifyPreSubmitOrderIntent(
    intent: NormalizedPlaceIntent,
    pendingOrder: OrderStatePayload
  ): StoredPreSubmitOrderIntentRecord {
    const persistedAt = Date.now();
    orderRepository.savePreSubmitIntentRecord({
      intentId: intent.intentId,
      createdAt: intent.createdAt,
      sourceWindowId: intent.sourceWindowId,
      orderId: pendingOrder.orderId,
      clientOrderId: pendingOrder.clientOrderId,
      symbol: pendingOrder.symbol,
      side: pendingOrder.side,
      orderType: pendingOrder.orderType,
      quantity: pendingOrder.quantity,
      reduceOnly: pendingOrder.reduceOnly,
      decisionContextId: intent.decisionContextId,
      preflightId: intent.preflightId,
      preflightNonce: intent.preflightNonce,
      status: "INTENT_ACCEPTED_PRE_SUBMIT",
      persistedAt
    });

    const persisted = orderRepository.getPreSubmitIntentRecord(intent.intentId);
    if (!persisted) {
      throw new Error("canonical pre-submit OrderIntent readback was missing.");
    }

    const expectedDecisionContextId = normalizeText(intent.decisionContextId);
    const expectedPreflightId = normalizeText(intent.preflightId);
    const expectedPreflightNonce = normalizeText(intent.preflightNonce);
    const mismatches = [
      persisted.intentId !== intent.intentId ? "intentId" : null,
      persisted.orderId !== pendingOrder.orderId ? "orderId" : null,
      persisted.clientOrderId !== pendingOrder.clientOrderId ? "clientOrderId" : null,
      normalizeSymbol(persisted.symbol) !== normalizeSymbol(pendingOrder.symbol) ? "symbol" : null,
      persisted.side !== pendingOrder.side ? "side" : null,
      persisted.orderType !== pendingOrder.orderType ? "orderType" : null,
      persisted.quantity !== pendingOrder.quantity ? "quantity" : null,
      persisted.reduceOnly !== pendingOrder.reduceOnly ? "reduceOnly" : null,
      persisted.decisionContextId !== expectedDecisionContextId ? "decisionContextId" : null,
      persisted.preflightId !== expectedPreflightId ? "preflightId" : null,
      persisted.preflightNonce !== expectedPreflightNonce ? "preflightNonce" : null,
      persisted.status !== "INTENT_ACCEPTED_PRE_SUBMIT" ? "status" : null,
      persisted.persistedAt !== persistedAt ? "persistedAt" : null
    ].filter((field): field is string => field !== null);

    if (mismatches.length > 0) {
      throw new Error(`canonical pre-submit OrderIntent readback mismatch: ${mismatches.join(", ")}.`);
    }

    return persisted;
  }

  private async handleCancelIntent(
    intent: NormalizedCancelIntent,
    context: OrderIntentContext
  ): Promise<void> {
    const target = this.resolveCancelTarget(intent);
    const existingOrder = target.order;
    const validation = this.buildCancelValidation({
      paperMode: intent.paperMode,
      accountConnected: context.account.enabled && context.account.connected,
      target
    });

    if (!existingOrder || !validation.accepted) {
      const rejectedOrder = this.buildOrderState({
        intentId: intent.intentId,
        symbol: intent.symbol ?? existingOrder?.symbol ?? "UNKNOWN",
        side: existingOrder?.side ?? "BUY",
        orderType: existingOrder?.orderType ?? "MARKET",
        quantity: existingOrder?.quantity ?? 0,
        price: existingOrder?.price ?? null,
        stopPrice: existingOrder?.stopPrice ?? null,
        stopLossPrice: existingOrder?.stopLossPrice ?? null,
        takeProfitPrice: existingOrder?.takeProfitPrice ?? null,
        status: "REJECTED",
        clientOrderId: intent.targetClientOrderId,
        sourceWindowId: intent.sourceWindowId,
        parentOrderId: existingOrder?.parentOrderId ?? null,
        protectiveKind: existingOrder?.protectiveKind ?? null,
        dryRun: intent.paperMode,
        reduceOnly: existingOrder?.reduceOnly ?? false,
        rejectReason: this.firstBlockingValidationMessage(validation),
        lastEventSource: "validation",
        createdAt: intent.createdAt,
        updatedAt: Date.now()
      });

      orderRepository.upsertOrderState(rejectedOrder);

      const rejectedMessage: OrderRejectedMessage = {
        type: "order_rejected",
        generatedAt: Date.now(),
        payload: {
          intentId: intent.intentId,
          duplicate: false,
          order: rejectedOrder,
          validation,
          message: rejectedOrder.rejectReason ?? "Cancel intent rejected."
        }
      };

      orderRepository.saveIntentResponse({
        intentId: intent.intentId,
        createdAt: intent.createdAt,
        sourceWindowId: intent.sourceWindowId,
        orderId: rejectedOrder.orderId,
        responseType: rejectedMessage.type,
        dryRun: rejectedOrder.dryRun,
        response: rejectedMessage
      });
      this.emitAuditEvent(
        rejectedOrder,
        "cancel_rejected",
        rejectedOrder.rejectReason ?? "Cancel intent rejected.",
        validation,
        rejectedOrder.updatedAt
      );
      this.emit(rejectedMessage);
      this.emitOrderStatus(rejectedOrder);
      return;
    }

    if (!intent.paperMode) {
      await this.handleLiveCancelIntent(intent, target, validation);
      return;
    }

    const canceledOrder: OrderStatePayload = {
      ...existingOrder,
      intentId: intent.intentId,
      status: "CANCELED",
      dryRun: intent.paperMode,
      updatedAt: Date.now(),
      lastEventSource: "paper_engine",
      rejectReason: null
    };

    orderRepository.upsertOrderState(canceledOrder);
    this.clearPendingTimers(canceledOrder.clientOrderId);

    const ackMessage: OrderAckMessage = {
      type: "order_ack",
      generatedAt: Date.now(),
      payload: {
        intentId: intent.intentId,
        duplicate: false,
        order: canceledOrder,
        validation,
        message: "Paper cancel accepted."
      }
    };

    orderRepository.saveIntentResponse({
      intentId: intent.intentId,
      createdAt: intent.createdAt,
      sourceWindowId: intent.sourceWindowId,
      orderId: canceledOrder.orderId,
      responseType: ackMessage.type,
      dryRun: canceledOrder.dryRun,
      response: ackMessage
    });
    this.emitAuditEvent(
      canceledOrder,
      "cancel_accepted",
      ackMessage.payload.message,
      validation,
      canceledOrder.updatedAt
    );
    this.emit(ackMessage);
    this.emitOrderStatus(canceledOrder);
    this.detachCanceledPaperProtectiveLeg(canceledOrder);
  }

  private async handleLiveCancelIntent(
    intent: NormalizedCancelIntent,
    target: CancelTargetResolution,
    validation: OrderValidationPayload
  ): Promise<void> {
    const existingOrder = target.order;
    const apiKey = this.options.apiKey;
    const apiSecret = this.options.apiSecret;

    if (!existingOrder) {
      this.persistIntentError(intent, {
        code: "LIVE_TESTNET_CANCEL_FAILED",
        message: "LIVE_TESTNET_CANCEL_FAILED: local cancel target was unavailable.",
        retriable: false
      });
      return;
    }

    if (!apiKey || !apiSecret) {
      this.persistIntentError(intent, {
        code: "LIVE_GATE_CHECK_FAILED",
        message: "LIVE_GATE_CHECK_FAILED: Binance API credentials are required for testnet live cancel.",
        retriable: false
      });
      return;
    }

    const cancelAuditOrder: OrderStatePayload = {
      ...existingOrder,
      intentId: intent.intentId,
      sourceWindowId: intent.sourceWindowId ?? existingOrder.sourceWindowId,
      updatedAt: Date.now(),
      lastEventSource: "validation"
    };
    this.emitAuditEvent(
      cancelAuditOrder,
      liveTestnetCancelIntentSubmittedEventType,
      "Persisted durable pre-submit cancel intent before Binance REST cancel.",
      buildLiveSubmittedCancelIntentAuditPayload(intent, target),
      cancelAuditOrder.updatedAt
    );
    this.emitAuditEvent(
      existingOrder,
      "LIVE_TESTNET_CANCEL_SEND",
      "Sending signed Binance Futures testnet cancel.",
      {
        targetClientOrderId: intent.targetClientOrderId
      },
      Date.now()
    );

    try {
      const response = await cancelFuturesOrder(this.restBase, apiKey, apiSecret, {
        symbol: existingOrder.symbol,
        origClientOrderId: existingOrder.clientOrderId
      });
      const canceledOrder = this.buildOrderStateFromRestOrder(response, existingOrder, "binance_stream");
      const ackMessage: OrderAckMessage = {
        type: "order_ack",
        generatedAt: Date.now(),
        payload: {
          intentId: intent.intentId,
          duplicate: false,
          order: canceledOrder,
          validation,
          message: "Binance Futures testnet cancel accepted."
        }
      };

      orderRepository.upsertOrderState(canceledOrder);
      orderRepository.saveIntentResponse({
        intentId: intent.intentId,
        createdAt: intent.createdAt,
        sourceWindowId: intent.sourceWindowId,
        orderId: canceledOrder.orderId,
        responseType: ackMessage.type,
        dryRun: false,
        response: ackMessage
      });
      this.emit(ackMessage);
      this.emitOrderStatus(canceledOrder);
      this.emitAuditEvent(
        canceledOrder,
        "LIVE_TESTNET_CANCEL_ACK",
        "Binance Futures testnet cancel accepted by REST.",
        response,
        canceledOrder.updatedAt
      );
      await this.reconcileLiveTestnetOrder(canceledOrder, apiKey, apiSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Binance testnet cancel failed.";
      this.persistIntentError(intent, {
        code: "LIVE_TESTNET_CANCEL_FAILED",
        message,
        retriable: false
      });
      this.emitAuditEvent(
        existingOrder,
        "LIVE_TESTNET_CANCEL_REJECTED",
        message,
        { error: message },
        Date.now()
      );
    }
  }

  private handleClosePaperPositionIntent(
    intent: NormalizedClosePaperPositionIntent,
    context: OrderIntentContext
  ): void {
    if (!intent.paperMode) {
      this.persistIntentError(intent, {
        code: "live_close_not_supported",
        message: "Manual paper close is available only with paperMode=true.",
        retriable: false
      });
      return;
    }

    const position = orderRepository.getPaperPositionById(intent.paperPositionId);

    if (!position || position.status !== "OPEN" || position.symbol !== intent.symbol) {
      this.persistIntentError(intent, {
        code: "paper_position_not_open",
        message: "Open paper position was not found for manual close.",
        retriable: false
      });
      return;
    }

    const marketPrice = context.row?.markPrice ?? context.row?.lastPrice ?? null;

    if (!isPositiveNumber(marketPrice)) {
      this.persistIntentError(intent, {
        code: "market_price_unavailable",
        message: "Current market price is unavailable for manual paper close.",
        retriable: true
      });
      return;
    }

    const entryOrder = orderRepository.getOrderByOrderId(position.entryOrderId);

    if (!entryOrder) {
      this.persistIntentError(intent, {
        code: "paper_entry_order_missing",
        message: "Paper entry order state is missing for manual close.",
        retriable: false
      });
      return;
    }

    const timestamp = Date.now();
    const validation = this.buildClosePaperPositionValidation(
      intent.paperMode,
      true,
      true
    );
    const ackMessage: OrderAckMessage = {
      type: "order_ack",
      generatedAt: timestamp,
      payload: {
        intentId: intent.intentId,
        duplicate: false,
        order: entryOrder,
        validation,
        message: `Manual paper close accepted for ${position.symbol}.`
      }
    };

    this.emitAuditEvent(
      entryOrder,
      "PAPER_POSITION_MANUAL_CLOSE_REQUESTED",
      `Manual paper close requested at market price ${formatOrderPrice(marketPrice)}.`,
      {
        paperPositionId: position.paperPositionId,
        requestedQuantity: intent.quantity,
        closePrice: marketPrice,
        sourceWindowId: intent.sourceWindowId
      },
      timestamp
    );

    const closedPosition = orderRepository.closePaperPosition({
      paperPositionId: position.paperPositionId,
      closePrice: marketPrice,
      closeReason: "MANUAL_CLOSE",
      closedAt: timestamp
    });

    if (!closedPosition || closedPosition.status !== "CLOSED") {
      this.persistIntentError(intent, {
        code: "paper_position_close_failed",
        message: "Paper position could not be closed.",
        retriable: true
      });
      return;
    }

    orderRepository.saveIntentResponse({
      intentId: intent.intentId,
      createdAt: intent.createdAt,
      sourceWindowId: intent.sourceWindowId,
      orderId: entryOrder.orderId,
      responseType: ackMessage.type,
      dryRun: true,
      response: ackMessage
    });

    this.emit(ackMessage);
    this.emitOrderStatus(entryOrder);
    this.emitPaperPositionClosed(closedPosition, timestamp);
    this.closePaperPositionLifecycle(closedPosition, timestamp);
    const canceledLegs = this.cancelPaperProtectiveLegsForPosition(closedPosition, timestamp);

    this.emitAuditEvent(
      entryOrder,
      "PROTECTIVE_LEGS_CANCELED",
      `Canceled ${canceledLegs.length} paper protective leg(s) after manual close.`,
      {
        paperPositionId: closedPosition.paperPositionId,
        canceledOrderIds: canceledLegs.map((leg) => leg.orderId),
        canceledClientOrderIds: canceledLegs.map((leg) => leg.clientOrderId)
      },
      timestamp
    );

    this.emitAuditEvent(
      entryOrder,
      "PAPER_POSITION_CLOSED",
      `Simulated paper position manually closed at ${formatOrderPrice(marketPrice)}.`,
      {
        paperPositionId: closedPosition.paperPositionId,
        closeReason: closedPosition.closeReason,
        closePrice: closedPosition.closePrice,
        realizedPnl: closedPosition.realizedPnl
      },
      timestamp
    );
  }

  private async validatePlaceIntent(
    intent: NormalizedPlaceIntent,
    context: OrderIntentContext
  ): Promise<OrderValidationPayload> {
    const checks: OrderValidationCheck[] = [];
    const marketPrice = context.row?.markPrice || context.row?.lastPrice || null;
    const paperMode = intent.paperMode;
    const hasProtectivePrices =
      intent.stopLossPrice !== null || intent.takeProfitPrice !== null;

    checks.push({
      code: "account_connection",
      passed: paperMode || (context.account.enabled && context.account.connected),
      blocking: !paperMode,
      message: paperMode
        ? "Paper mode allows testing without a live account connection."
        : context.account.enabled && context.account.connected
          ? "Account connection is active."
          : "Live account connection is required for non-paper orders."
    });

    checks.push({
      code: "execution_mode",
      passed: paperMode || this.options.liveModeEnabled,
      blocking: true,
      message: paperMode
        ? "Paper mode is enabled."
        : this.options.liveModeEnabled
          ? "Live mode is enabled."
          : "Live mode is disabled for this infrastructure pass."
    });

    const existingClientOrder = orderRepository.getOrderByClientOrderId(intent.clientOrderId);
    const clientOrderIdSafety = evaluateClientOrderIdSafety({
      existingOrder: existingClientOrder,
      intentId: intent.intentId
    });

    checks.push({
      code: "client_order_id",
      passed: clientOrderIdSafety.passed,
      blocking: true,
      message: clientOrderIdSafety.message
    });

    checks.push(this.buildReduceOnlyValidation(intent, context));

    let exchangeFilters: Awaited<ReturnType<typeof getExchangeFilterMap>> | null = null;

    try {
      exchangeFilters = await getExchangeFilterMap(this.restBase);
    } catch {
      exchangeFilters = null;
    }

    const normalizedQuantityResult = normalizeQuantity(
      intent.symbol,
      intent.quantity,
      exchangeFilters
    );
    const symbolFilters = normalizedQuantityResult.filters;
    const priceReference =
      intent.orderType === "LIMIT" ||
      intent.orderType === "STOP_MARKET" ||
      intent.orderType === "TAKE_PROFIT_MARKET"
        ? intent.price ?? intent.stopPrice ?? null
        : marketPrice;
    const protectiveReferencePrice =
      intent.orderType === "LIMIT"
        ? intent.price
        : intent.orderType === "MARKET"
          ? marketPrice
          : priceReference;
    const normalizedPriceResult =
      priceReference !== null
        ? normalizePrice(intent.symbol, priceReference, exchangeFilters)
        : { price: priceReference, warnings: [], filters: symbolFilters };
    const notionalResult =
      normalizedQuantityResult.quantity > 0 && normalizedPriceResult.price && normalizedPriceResult.price > 0
        ? validateNotional(
            intent.symbol,
            normalizedQuantityResult.quantity,
            normalizedPriceResult.price,
            exchangeFilters
          )
        : {
            valid: false,
            notional: 0,
            warnings: ["Notional cannot be validated without a positive price reference."],
            filters: symbolFilters
          };

    checks.push({
      code: "exchange_filters",
      passed: Boolean(exchangeFilters && symbolFilters),
      blocking: true,
      message:
        exchangeFilters && symbolFilters
          ? "Exchange filters loaded."
          : "Binance exchange filters are unavailable for this symbol."
    });

    checks.push({
      code: "market_price",
      passed:
        intent.orderType === "LIMIT" ||
        intent.orderType === "STOP_MARKET" ||
        intent.orderType === "TAKE_PROFIT_MARKET"
          ? priceReference !== null && priceReference > 0
          : marketPrice !== null && marketPrice > 0,
      blocking: true,
      message:
        intent.orderType === "LIMIT" ||
        intent.orderType === "STOP_MARKET" ||
        intent.orderType === "TAKE_PROFIT_MARKET"
          ? priceReference !== null && priceReference > 0
            ? "Explicit order price is available."
            : "A positive price or stopPrice is required for this order type."
          : marketPrice !== null && marketPrice > 0
            ? "Current market price is available."
            : hasProtectivePrices
              ? "Current market price is unavailable, so stop loss/take profit cannot be validated for MARKET orders."
              : "Current market price is unavailable."
    });

    const protectiveValuesValid =
      (intent.stopLossPrice === null || intent.stopLossPrice > 0) &&
      (intent.takeProfitPrice === null || intent.takeProfitPrice > 0);

    checks.push({
      code: "protective_price",
      passed: protectiveValuesValid,
      blocking: hasProtectivePrices,
      message: !hasProtectivePrices
        ? "No protective prices were requested."
        : protectiveValuesValid
          ? "Protective prices are positive."
          : intent.stopLossPrice !== null && intent.stopLossPrice <= 0
            ? "stopLossPrice must be greater than 0."
            : "takeProfitPrice must be greater than 0."
    });

    checks.push({
      code: "protective_price_relation",
      passed: this.validateProtectivePriceRelation(
        intent,
        protectiveReferencePrice,
        hasProtectivePrices,
        protectiveValuesValid
      ),
      blocking: hasProtectivePrices && protectiveValuesValid,
      message: this.describeProtectivePriceRelation(
        intent,
        protectiveReferencePrice,
        hasProtectivePrices,
        protectiveValuesValid
      )
    });

    checks.push({
      code: "min_qty",
      passed:
        symbolFilters?.minQty === null || symbolFilters?.minQty === undefined
          ? true
          : intent.quantity >= symbolFilters.minQty,
      blocking: true,
      message:
        symbolFilters?.minQty === null || symbolFilters?.minQty === undefined
          ? "minQty filter is satisfied."
          : intent.quantity >= symbolFilters.minQty
            ? `Quantity meets minQty ${symbolFilters.minQty}.`
            : `Quantity must be at least ${symbolFilters.minQty}.`
    });

    checks.push({
      code: "step_size",
      passed: Math.abs(normalizedQuantityResult.quantity - intent.quantity) < 1e-12,
      blocking: true,
      message:
        Math.abs(normalizedQuantityResult.quantity - intent.quantity) < 1e-12
          ? "Quantity matches Binance stepSize."
          : `Quantity must align to stepSize; suggested normalized quantity is ${normalizedQuantityResult.quantity}.`
    });

    checks.push({
      code: "tick_size",
      passed:
        intent.orderType === "MARKET" ||
        priceReference === null ||
        Math.abs((normalizedPriceResult.price ?? 0) - priceReference) < 1e-12,
      blocking: intent.orderType !== "MARKET",
      message:
        intent.orderType === "MARKET"
          ? "tickSize does not apply to market orders."
          : priceReference === null
            ? "Price is unavailable for tickSize validation."
            : Math.abs((normalizedPriceResult.price ?? 0) - priceReference) < 1e-12
              ? "Price matches Binance tickSize."
              : `Price must align to tickSize; suggested normalized price is ${normalizedPriceResult.price}.`
    });

    checks.push({
      code: "notional",
      passed: notionalResult.valid,
      blocking: true,
      message: notionalResult.valid
        ? `Notional ${notionalResult.notional.toFixed(4)} passes Binance minimums.`
        : notionalResult.warnings[0] ?? "Notional validation failed."
    });

    const maxLeverageLimit = this.options.liveRiskLimits?.maxLeverage;
    const shouldFetchLeverageBrackets =
      !paperMode &&
      maxLeverageLimit?.enabled === true &&
      isPositiveNumber(maxLeverageLimit.value);
    const leverageBracket = shouldFetchLeverageBrackets
      ? await getCachedLeverageBrackets(
          this.restBase,
          this.options.apiKey,
          this.options.apiSecret,
          intent.symbol
        )
      : null;
    const accountEquityUsd =
      context.account.balances.marginBalanceUsd ??
      context.account.balances.walletBalanceUsd ??
      context.account.balances.availableBalanceUsd;

    checks.push(
      ...evaluateRiskAuthorityOrder({
        paperMode,
        reduceOnly: intent.reduceOnly,
        symbol: intent.symbol,
        orderNotional:
          typeof notionalResult.notional === "number" && Number.isFinite(notionalResult.notional)
            ? notionalResult.notional
            : null,
        account: context.account,
        marketPrice,
        availableBalanceUsd: context.account.balances.availableBalanceUsd,
        accountEquityUsd,
        leverageBracket,
        liveRiskLimits: this.options.liveRiskLimits,
        dailyRealizedPnl:
          !paperMode && this.options.liveRiskLimits?.maxDailyLossUsdt.enabled
            ? (() => {
                try {
                  const summary = orderRepository.getCurrentTradingDayRealizedPnlSummary();
                  return {
                    status: "AUTHORITATIVE" as const,
                    tradingDay: summary.tradingDay,
                    netRealizedPnl: summary.netRealizedPnl,
                    grossRealizedPnl: summary.grossRealizedPnl,
                    totalCommission: summary.totalCommission,
                    lastEventTime: summary.lastEventTime
                  };
                } catch {
                  return {
                    status: "ERROR" as const,
                    tradingDay: null,
                    netRealizedPnl: null,
                    grossRealizedPnl: null,
                    totalCommission: null,
                    lastEventTime: null
                  };
                }
              })()
            : undefined
      })
    );

    const accepted = checks.every((check) => check.passed || !check.blocking);

    return {
      accepted,
      paperMode,
      checks,
      normalizedQuantity: normalizedQuantityResult.quantity,
      normalizedPrice:
        typeof normalizedPriceResult.price === "number" && normalizedPriceResult.price > 0
          ? normalizedPriceResult.price
          : null,
      notional:
        typeof notionalResult.notional === "number" && Number.isFinite(notionalResult.notional)
          ? notionalResult.notional
          : null,
      riskLimits: mergeRiskLimits(this.riskLimits)
      };
  }

  private buildReduceOnlyValidation(
    intent: NormalizedPlaceIntent,
    context: OrderIntentContext
  ): OrderValidationCheck {
    const positionQuantity = intent.paperMode
      ? orderRepository
          .listOpenPaperPositions([intent.symbol])
          .reduce(
            (total, position) =>
              total + signedPaperPositionQuantity(position.side, position.quantity),
            0
          )
      : context.account.positions
          .filter((position) => position.symbol === intent.symbol)
          .reduce((total, position) => {
            if (position.positionSide === "LONG") {
              return total + Math.abs(position.quantity);
            }

            if (position.positionSide === "SHORT") {
              return total - Math.abs(position.quantity);
            }

            return total + position.quantity;
          }, 0);

    const decision = evaluateReduceOnlyPositionSafety({
      reduceOnly: intent.reduceOnly,
      paperMode: intent.paperMode,
      accountPositionAvailable: context.account.enabled && context.account.connected,
      side: intent.side,
      quantity: intent.quantity,
      signedPositionQuantity: positionQuantity
    });

    return {
      code: "reduce_only_position",
      passed: decision.passed,
      blocking: decision.blocking,
      message: decision.message
    };
  }

  private detachCanceledPaperProtectiveLeg(canceledOrder: OrderStatePayload): void {
    if (
      !canceledOrder.dryRun ||
      !canceledOrder.protectiveKind ||
      !canceledOrder.parentOrderId
    ) {
      return;
    }

    const position = orderRepository.getPaperPositionByEntryOrderId(canceledOrder.parentOrderId);

    if (!position || position.status !== "OPEN") {
      return;
    }

    const updated = orderRepository.clearPaperPositionProtectiveLeg({
      paperPositionId: position.paperPositionId,
      orderId: canceledOrder.orderId,
      updatedAt: canceledOrder.updatedAt
    });

    if (
      !updated ||
      (updated.stopLossOrderId === position.stopLossOrderId &&
        updated.takeProfitOrderId === position.takeProfitOrderId)
    ) {
      return;
    }

    this.emitPaperPositionUpdated(updated, canceledOrder.updatedAt);
    this.updatePaperPositionLifecycle(updated, canceledOrder.updatedAt);

    const entryOrder = orderRepository.getOrderByOrderId(updated.entryOrderId);
    if (entryOrder) {
      this.emitAuditEvent(
        entryOrder,
        "PROTECTIVE_LEG_CANCELED",
        `Detached canceled ${canceledOrder.protectiveKind} protective leg from open paper position.`,
        {
          paperPositionId: updated.paperPositionId,
          canceledOrderId: canceledOrder.orderId,
          canceledClientOrderId: canceledOrder.clientOrderId,
          protectiveKind: canceledOrder.protectiveKind
        },
        canceledOrder.updatedAt
      );
    }

    this.activePaperProtectiveLegs = Math.max(0, this.activePaperProtectiveLegs - 1);
  }

  private resolveCancelTarget(intent: NormalizedCancelIntent): CancelTargetResolution {
    const resolvedByClientOrderId = orderRepository.getOrderByClientOrderId(intent.targetClientOrderId);
    const resolvedByOrderId = orderRepository.getOrderByOrderId(intent.targetClientOrderId);

    if (
      resolvedByClientOrderId &&
      resolvedByOrderId &&
      resolvedByClientOrderId.orderId !== resolvedByOrderId.orderId
    ) {
      return {
        order: null,
        classification: "TERMINAL_OR_INVALID",
        reason: "Cancel target is ambiguous across clientOrderId and orderId lookups.",
        targetOrderId: null,
        targetClientOrderId: intent.targetClientOrderId
      };
    }

    const existingOrder = resolvedByClientOrderId ?? resolvedByOrderId;
    if (!existingOrder) {
      return {
        order: null,
        classification: "TERMINAL_OR_INVALID",
        reason: "Target order was not found in local order state.",
        targetOrderId: null,
        targetClientOrderId: intent.targetClientOrderId
      };
    }

    if (intent.symbol && intent.symbol !== existingOrder.symbol) {
      return {
        order: existingOrder,
        classification: "TERMINAL_OR_INVALID",
        reason: "Cancel symbol did not match the resolved local order.",
        targetOrderId: existingOrder.orderId,
        targetClientOrderId: existingOrder.clientOrderId
      };
    }

    if (isTerminalOrderStatus(existingOrder.status)) {
      return {
        order: existingOrder,
        classification: "TERMINAL_OR_INVALID",
        reason: `Target order is already ${existingOrder.status}.`,
        targetOrderId: existingOrder.orderId,
        targetClientOrderId: existingOrder.clientOrderId
      };
    }

    if (
      existingOrder.protectiveKind !== null ||
      existingOrder.reduceOnly ||
      existingOrder.orderType === "STOP_MARKET" ||
      existingOrder.orderType === "TAKE_PROFIT_MARKET"
    ) {
      return {
        order: existingOrder,
        classification: "PROTECTIVE_OR_RISK_INCREASING",
        reason: "Cancel target is protective or otherwise risk-increasing to remove.",
        targetOrderId: existingOrder.orderId,
        targetClientOrderId: existingOrder.clientOrderId
      };
    }

    if (
      (existingOrder.orderType === "MARKET" || existingOrder.orderType === "LIMIT") &&
      !existingOrder.reduceOnly &&
      existingOrder.protectiveKind === null
    ) {
      return {
        order: existingOrder,
        classification: "ENTRY_PENDING_RISK_REDUCING",
        reason: "Cancel target is a non-terminal entry order and cancel is risk-reducing.",
        targetOrderId: existingOrder.orderId,
        targetClientOrderId: existingOrder.clientOrderId
      };
    }

    return {
      order: existingOrder,
      classification: "UNKNOWN_RISK",
      reason: "Cancel target could not be confidently classified and is blocked by default.",
      targetOrderId: existingOrder.orderId,
      targetClientOrderId: existingOrder.clientOrderId
    };
  }

  private buildCancelValidation(input: {
    paperMode: boolean;
    accountConnected: boolean;
    target: CancelTargetResolution;
  }): OrderValidationPayload {
    if (input.paperMode) {
      const checks: OrderValidationCheck[] = [
        {
          code: "execution_mode",
          passed: true,
          blocking: true,
          message: "Paper mode is enabled."
        },
        {
          code: "account_connection",
          passed: true,
          blocking: false,
          message: "Paper cancel uses existing server-side order state."
        },
        {
          code: "exchange_filters",
          passed: Boolean(input.target.order),
          blocking: true,
          message: input.target.order
            ? "Target order exists in server-side state."
            : "Target order was not found in server-side order state."
        }
      ];

      return {
        accepted: checks.every((check) => check.passed || !check.blocking),
        paperMode: true,
        checks,
        normalizedQuantity: 0,
        normalizedPrice: null,
        notional: null,
        riskLimits: mergeRiskLimits(this.riskLimits)
      };
    }

    const checks: OrderValidationCheck[] = [
      {
        code: "execution_mode",
        passed: this.options.liveModeEnabled,
        blocking: true,
        message: this.options.liveModeEnabled
          ? "Live mode is enabled."
          : "Live mode is disabled for this infrastructure pass."
      },
      {
        code: "account_connection",
        passed: input.accountConnected,
        blocking: true,
        message: input.accountConnected
          ? "Account connection is active."
          : "Live cancel requires an active account connection."
      },
      {
        code: "cancel_target_resolution",
        passed: input.target.order !== null && input.target.classification !== "TERMINAL_OR_INVALID",
        blocking: true,
        message: input.target.reason
      },
      {
        code: "cancel_risk_classification",
        passed: input.target.classification === "ENTRY_PENDING_RISK_REDUCING",
        blocking: true,
        message:
          input.target.classification === "ENTRY_PENDING_RISK_REDUCING"
            ? "Cancel target is classified as entry-pending risk-reducing."
            : input.target.classification === "PROTECTIVE_OR_RISK_INCREASING"
              ? "Cancel target is classified as protective or risk-increasing and is blocked."
              : input.target.classification === "UNKNOWN_RISK"
                ? "Cancel target risk could not be confidently classified and is blocked."
                : input.target.reason
      }
    ];

    return {
      accepted: checks.every((check) => check.passed || !check.blocking),
      paperMode: false,
      checks,
      normalizedQuantity: 0,
      normalizedPrice: null,
      notional: null,
      riskLimits: mergeRiskLimits(this.riskLimits)
    };
  }

  private buildClosePaperPositionValidation(
    paperMode: boolean,
    hasOpenPosition: boolean,
    hasMarketPrice: boolean
  ): OrderValidationPayload {
    const checks: OrderValidationCheck[] = [
      {
        code: "execution_mode",
        passed: paperMode,
        blocking: true,
        message: paperMode
          ? "Paper mode is enabled."
          : "Manual paper close is available only with paperMode=true."
      },
      {
        code: "exchange_filters",
        passed: hasOpenPosition,
        blocking: true,
        message: hasOpenPosition
          ? "Open paper position exists."
          : "Open paper position was not found."
      },
      {
        code: "market_price",
        passed: hasMarketPrice,
        blocking: true,
        message: hasMarketPrice
          ? "Current market price is available."
          : "Current market price is unavailable for manual paper close."
      }
    ];

    return {
      accepted: checks.every((check) => check.passed || !check.blocking),
      paperMode,
      checks,
      normalizedQuantity: 0,
      normalizedPrice: null,
      notional: null,
      riskLimits: mergeRiskLimits(this.riskLimits)
    };
  }

  private buildOrderStateFromRestOrder(
    order: RestFuturesOrder,
    fallback: OrderStatePayload,
    lastEventSource: OrderStatePayload["lastEventSource"]
  ): OrderStatePayload {
    const updatedAt =
      typeof order.updateTime === "number" && Number.isFinite(order.updateTime)
        ? order.updateTime
        : Date.now();
    const price = safeNumber(order.price);
    const avgPrice = safeNumber(order.avgPrice);
    const stopPrice = safeNumber(order.stopPrice);
    const quantity = safeNumber(order.origQty);
    const executedQty = safeNumber(order.executedQty ?? order.cumQty);
    const status = isTerminalOrderStatus(order.status as OrderLifecycleStatus) ||
      order.status === "NEW" ||
      order.status === "PARTIALLY_FILLED"
      ? (order.status as OrderLifecycleStatus)
      : fallback.status;
    const orderType =
      order.type === "MARKET" ||
      order.type === "LIMIT" ||
      order.type === "STOP_MARKET" ||
      order.type === "TAKE_PROFIT_MARKET"
        ? order.type
        : fallback.orderType;

    return {
      ...fallback,
      symbol: order.symbol || fallback.symbol,
      side: order.side ?? fallback.side,
      orderType,
      quantity: quantity > 0 ? quantity : fallback.quantity,
      price: price > 0 ? price : fallback.price,
      stopPrice: stopPrice > 0 ? stopPrice : fallback.stopPrice,
      status,
      clientOrderId: order.clientOrderId || fallback.clientOrderId,
      exchangeOrderId: String(order.orderId),
      reduceOnly: order.reduceOnly ?? fallback.reduceOnly,
      executedQty,
      avgPrice: avgPrice > 0 ? avgPrice : fallback.avgPrice,
      lastFilledQty: fallback.lastFilledQty,
      realizedPnl: fallback.realizedPnl,
      commission: fallback.commission,
      commissionAsset: fallback.commissionAsset,
      lastExecutionType: fallback.lastExecutionType,
      lastTradeTime: fallback.lastTradeTime,
      rejectReason: null,
      updatedAt,
      lastEventSource
    };
  }

  private async reconcileLiveTestnetOrder(
    order: OrderStatePayload,
    apiKey: string,
    apiSecret: string
  ): Promise<void> {
    try {
      const [openOrders, positionRisk] = await Promise.all([
        getOpenOrders(this.restBase, apiKey, apiSecret, order.symbol),
        getPositionRisk(this.restBase, apiKey, apiSecret)
      ]);
      const matchedOpenOrder = openOrders.find(
        (item) => item.clientOrderId === order.clientOrderId
      );

      if (matchedOpenOrder) {
        const reconciled = this.buildOrderStateFromRestOrder(
          matchedOpenOrder,
          order,
          "binance_stream"
        );
        const latest = orderRepository.getOrderByClientOrderId(order.clientOrderId);
        const streamIsFresher =
          latest?.lastEventSource === "binance_stream" &&
          latest.updatedAt > order.updatedAt &&
          latest.updatedAt >= reconciled.updatedAt;

        if (streamIsFresher) {
          this.emitAuditEvent(
            latest,
            "LIVE_TESTNET_RECONCILED",
            "Skipped stale openOrders reconciliation because ORDER_TRADE_UPDATE is fresher.",
            {
              openOrders: openOrders.length,
              activePositions: positionRisk.filter((position) => Math.abs(safeNumber(position.positionAmt)) > 0)
                .length
            },
            Date.now()
          );
          return;
        }

        orderRepository.upsertOrderState(reconciled);
        this.emitOrderStatus(reconciled);
        this.emitAuditEvent(
          reconciled,
          "LIVE_TESTNET_RECONCILED",
          "Live testnet order reconciled from Binance open orders.",
          {
            openOrders: openOrders.length,
            activePositions: positionRisk.filter((position) => Math.abs(safeNumber(position.positionAmt)) > 0)
              .length
          },
          Date.now()
        );
        return;
      }

      try {
        const exchangeOrder = await getFuturesOrder(this.restBase, apiKey, apiSecret, {
          symbol: order.symbol,
          origClientOrderId: order.clientOrderId
        });
        const reconciled = this.buildOrderStateFromRestOrder(
          exchangeOrder,
          order,
          "binance_stream"
        );

        orderRepository.upsertOrderState(reconciled);
        this.emitOrderStatus(reconciled);
        this.emitAuditEvent(
          reconciled,
          "LIVE_TESTNET_RECONCILED",
          "Live testnet order reconciled from Binance order lookup.",
          {
            openOrders: openOrders.length,
            exchangeStatus: exchangeOrder.status,
            activePositions: positionRisk.filter((position) => Math.abs(safeNumber(position.positionAmt)) > 0)
              .length
          },
          Date.now()
        );
        return;
      } catch (orderLookupError) {
        this.emitAuditEvent(
          order,
          "LIVE_TESTNET_RECONCILE_ORDER_LOOKUP_FAILED",
          "Live testnet order lookup failed after open-order reconciliation.",
          {
            error: orderLookupError instanceof Error ? orderLookupError.message : String(orderLookupError),
            openOrders: openOrders.length,
            activePositions: positionRisk.filter((position) => Math.abs(safeNumber(position.positionAmt)) > 0).length
          },
          Date.now()
        );
      }

      this.emitAuditEvent(
        order,
        "LIVE_TESTNET_RECONCILED",
        "Live testnet reconciliation completed; order is not currently open on Binance.",
        {
          openOrders: openOrders.length,
          activePositions: positionRisk.filter((position) => Math.abs(safeNumber(position.positionAmt)) > 0).length
        },
        Date.now()
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live testnet reconciliation failed.";
      this.emitAuditEvent(
        order,
        "LIVE_TESTNET_RECONCILE_FAILED",
        message,
        { error: message },
        Date.now()
      );
    }
  }

  async reconcileLiveTestnetOrderByClientOrderId(clientOrderId: string): Promise<void> {
    const order = orderRepository.getOrderByClientOrderId(clientOrderId);

    if (!order) {
      throw new Error(`Order ${clientOrderId} was not found for testnet reconciliation.`);
    }

    const apiKey = this.options.apiKey;
    const apiSecret = this.options.apiSecret;

    if (!apiKey || !apiSecret) {
      throw new Error("Binance API credentials are required for testnet reconciliation.");
    }

    await this.reconcileLiveTestnetOrder(order, apiKey, apiSecret);
  }

  async runLivePositionLifecycleRecoveryAudit(): Promise<void> {
    await this.recoverLivePositionLifecyclesAuditOnly();
  }

  private buildOrderState(input: {
    intentId: string | null;
    symbol: string;
    side: OrderStatePayload["side"];
    orderType: OrderStatePayload["orderType"];
    quantity: number;
    price: number | null;
    stopPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    status: OrderLifecycleStatus;
    clientOrderId: string;
    sourceWindowId: string | null;
    parentOrderId: string | null;
    protectiveKind: OrderProtectiveKind | null;
    dryRun: boolean;
    reduceOnly: boolean;
    rejectReason: string | null;
    lastEventSource: OrderStatePayload["lastEventSource"];
    createdAt: number;
    updatedAt: number;
  }): OrderStatePayload {
    return {
      orderId: randomUUID(),
      intentId: input.intentId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      quantity: input.quantity,
      price: input.price,
      stopPrice: input.stopPrice,
      stopLossPrice: input.stopLossPrice,
      takeProfitPrice: input.takeProfitPrice,
      status: input.status,
      clientOrderId: input.clientOrderId,
      exchangeOrderId: null,
      sourceWindowId: input.sourceWindowId,
      parentOrderId: input.parentOrderId,
      protectiveKind: input.protectiveKind,
      dryRun: input.dryRun,
      reduceOnly: input.reduceOnly,
      executedQty: input.status === "FILLED" ? input.quantity : 0,
      avgPrice: input.status === "FILLED" ? input.price : null,
      lastFilledQty: null,
      realizedPnl: null,
      commission: null,
      commissionAsset: null,
      lastExecutionType: null,
      lastTradeTime: null,
      rejectReason: input.rejectReason,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      lastEventSource: input.lastEventSource
    };
  }

  private firstBlockingValidationMessage(
    validation: OrderValidationPayload
  ): string {
    return (
      validation.checks.find((check) => check.blocking && !check.passed)?.message ??
      "Order intent rejected."
    );
  }

  private buildAcceptedOrderMessage(order: OrderStatePayload): string {
    const protectiveSummary = this.buildProtectiveSummary(
      order.stopLossPrice,
      order.takeProfitPrice
    );

    if (order.dryRun) {
      return protectiveSummary
        ? `Paper order accepted. Protective plan received (${protectiveSummary}). Binance live execution remains disabled.`
        : "Paper order accepted. Binance live execution remains disabled.";
    }

    return protectiveSummary
      ? `Order accepted with protective plan (${protectiveSummary}).`
      : "Order accepted.";
  }

  private buildProtectiveSummary(
    stopLossPrice: number | null,
    takeProfitPrice: number | null
  ): string | null {
    const parts: string[] = [];

    if (isPositiveNumber(stopLossPrice)) {
      parts.push(`SL ${formatOrderPrice(stopLossPrice)}`);
    }

    if (isPositiveNumber(takeProfitPrice)) {
      parts.push(`TP ${formatOrderPrice(takeProfitPrice)}`);
    }

    return parts.length > 0 ? parts.join(" / ") : null;
  }

  private validateProtectivePriceRelation(
    intent: NormalizedPlaceIntent,
    referencePrice: number | null,
    hasProtectivePrices: boolean,
    protectiveValuesValid: boolean
  ): boolean {
    if (!hasProtectivePrices || !protectiveValuesValid) {
      return true;
    }

    if (!isPositiveNumber(referencePrice)) {
      return false;
    }

    if (
      intent.side === "BUY" &&
      isPositiveNumber(intent.stopLossPrice) &&
      intent.stopLossPrice >= referencePrice
    ) {
      return false;
    }

    if (
      intent.side === "BUY" &&
      isPositiveNumber(intent.takeProfitPrice) &&
      intent.takeProfitPrice <= referencePrice
    ) {
      return false;
    }

    if (
      intent.side === "SELL" &&
      isPositiveNumber(intent.stopLossPrice) &&
      intent.stopLossPrice <= referencePrice
    ) {
      return false;
    }

    if (
      intent.side === "SELL" &&
      isPositiveNumber(intent.takeProfitPrice) &&
      intent.takeProfitPrice >= referencePrice
    ) {
      return false;
    }

    return true;
  }

  private describeProtectivePriceRelation(
    intent: NormalizedPlaceIntent,
    referencePrice: number | null,
    hasProtectivePrices: boolean,
    protectiveValuesValid: boolean
  ): string {
    if (!hasProtectivePrices) {
      return "No protective TP/SL relation to validate.";
    }

    if (!protectiveValuesValid) {
      return "Protective TP/SL relation will be validated after prices are positive.";
    }

    if (!isPositiveNumber(referencePrice)) {
      return intent.orderType === "MARKET"
        ? "Current market price is unavailable, so stop loss/take profit cannot be validated for MARKET orders."
        : "Reference price is unavailable for stop loss/take profit validation.";
    }

    if (
      intent.side === "BUY" &&
      isPositiveNumber(intent.stopLossPrice) &&
      intent.stopLossPrice >= referencePrice
    ) {
      return `For LONG orders, stopLossPrice must be below reference price ${formatOrderPrice(referencePrice)}.`;
    }

    if (
      intent.side === "BUY" &&
      isPositiveNumber(intent.takeProfitPrice) &&
      intent.takeProfitPrice <= referencePrice
    ) {
      return `For LONG orders, takeProfitPrice must be above reference price ${formatOrderPrice(referencePrice)}.`;
    }

    if (
      intent.side === "SELL" &&
      isPositiveNumber(intent.stopLossPrice) &&
      intent.stopLossPrice <= referencePrice
    ) {
      return `For SHORT orders, stopLossPrice must be above reference price ${formatOrderPrice(referencePrice)}.`;
    }

    if (
      intent.side === "SELL" &&
      isPositiveNumber(intent.takeProfitPrice) &&
      intent.takeProfitPrice >= referencePrice
    ) {
      return `For SHORT orders, takeProfitPrice must be below reference price ${formatOrderPrice(referencePrice)}.`;
    }

    return "Protective TP/SL prices align with the order direction.";
  }

  private armPaperProtectiveLegs(order: OrderStatePayload, timestamp: number): OrderStatePayload[] {
    const legs = this.buildPaperProtectiveLegs(order, timestamp);

    if (legs.length === 0) {
      return [];
    }

    for (const leg of legs) {
      orderRepository.upsertOrderState(leg);
      this.emitOrderStatus(leg);
      this.emitAuditEvent(
        leg,
        "PROTECTIVE_ARMED",
        `Paper mode armed ${leg.protectiveKind} protective leg at ${formatOrderPrice(
          leg.stopPrice ?? leg.price ?? 0
        )}.`,
        {
          parentOrderId: order.orderId,
          triggerPrice: leg.stopPrice,
          protectiveKind: leg.protectiveKind
        },
        timestamp
      );
    }

    this.emitAuditEvent(
      order,
      "PROTECTIVE_ARMED",
      `Paper mode armed ${legs.length} protective leg(s) for the filled order.`,
      {
        parentOrderId: order.orderId,
        legs: legs.map((leg) => ({
          orderId: leg.orderId,
          clientOrderId: leg.clientOrderId,
          orderType: leg.orderType,
          protectiveKind: leg.protectiveKind,
          triggerPrice: leg.stopPrice
        }))
      },
      timestamp
    );

    return legs;
  }

  private buildPaperProtectiveLegs(
    order: OrderStatePayload,
    timestamp: number
  ): OrderStatePayload[] {
    const quantity = order.executedQty > 0 ? order.executedQty : order.quantity;

    if (quantity <= 0) {
      return [];
    }

    const legs: OrderStatePayload[] = [];
    const exitSide = flipOrderSide(order.side);

    if (isPositiveNumber(order.stopLossPrice)) {
      legs.push(
        this.buildOrderState({
          intentId: null,
          symbol: order.symbol,
          side: exitSide,
          orderType: "STOP_MARKET",
          quantity,
          price: order.stopLossPrice,
          stopPrice: order.stopLossPrice,
          stopLossPrice: null,
          takeProfitPrice: null,
          status: "NEW",
          clientOrderId: `paper-sl-${order.orderId}`,
          sourceWindowId: order.sourceWindowId,
          parentOrderId: order.orderId,
          protectiveKind: "STOP_LOSS",
          dryRun: true,
          reduceOnly: true,
          rejectReason: null,
          lastEventSource: "paper_engine",
          createdAt: timestamp,
          updatedAt: timestamp
        })
      );
    }

    if (isPositiveNumber(order.takeProfitPrice)) {
      legs.push(
        this.buildOrderState({
          intentId: null,
          symbol: order.symbol,
          side: exitSide,
          orderType: "TAKE_PROFIT_MARKET",
          quantity,
          price: order.takeProfitPrice,
          stopPrice: order.takeProfitPrice,
          stopLossPrice: null,
          takeProfitPrice: null,
          status: "NEW",
          clientOrderId: `paper-tp-${order.orderId}`,
          sourceWindowId: order.sourceWindowId,
          parentOrderId: order.orderId,
          protectiveKind: "TAKE_PROFIT",
          dryRun: true,
          reduceOnly: true,
          rejectReason: null,
          lastEventSource: "paper_engine",
          createdAt: timestamp,
          updatedAt: timestamp
        })
      );
    }

    return legs;
  }

  private emitPositionLifecycleEventMessage(input: {
    lifecycleId: string;
    eventType: PositionLifecycleEventType;
    timestamp: number;
    payload?: unknown;
  }): void {
    this.execution.lifecycleManager.emitPositionLifecycleEventMessage(input);
  }

  private appendAndEmitPositionLifecycleEvent(input: {
    lifecycleId: string;
    eventType: PositionLifecycleEventType;
    timestamp: number;
    payload?: unknown;
  }): void {
    this.execution.lifecycleManager.appendAndEmitPositionLifecycleEvent(input);
  }

  private resolvePaperPositionLifecycle(position: PaperPositionPayload): PositionLifecycle | null {
    return this.execution.lifecycleManager.resolvePaperPositionLifecycle(position);
  }

  private createOrOpenPositionLifecycle(input: {
    order: OrderStatePayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    this.execution.lifecycleManager.createOrOpenPositionLifecycle(input);
  }

  private recordLiveOrderLifecycleAck(input: {
    order: OrderStatePayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    this.execution.lifecycleManager.recordLiveOrderLifecycleAck(input);
  }

  private resolveReduceOnlyLifecycleParentOrderId(intent: NormalizedPlaceIntent): string | null {
    return this.execution.lifecycleManager.resolveReduceOnlyLifecycleParentOrderId({
      reduceOnly: intent.reduceOnly,
      decisionContextId: intent.decisionContextId,
      symbol: intent.symbol
    });
  }

  private recordReduceOnlyLifecycleOrder(input: {
    order: OrderStatePayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    this.execution.lifecycleManager.recordReduceOnlyLifecycleOrder(input);
  }

  private createOrOpenPaperPositionLifecycle(input: {
    filledOrder: OrderStatePayload;
    position: PaperPositionPayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    this.execution.lifecycleManager.createOrOpenPaperPositionLifecycle(input);
  }

  private updatePaperPositionLifecycle(position: PaperPositionPayload, timestamp: number): void {
    this.execution.lifecycleManager.updatePaperPositionLifecycle(position, timestamp);
  }

  private closePaperPositionLifecycle(position: PaperPositionPayload, timestamp: number): void {
    this.execution.lifecycleManager.closePaperPositionLifecycle(position, timestamp);
  }

  private createDecisionReviewFromClosedLifecycle(
    lifecycle: PositionLifecycle,
    timestamp: number
  ): void {
    this.execution.lifecycleManager.createDecisionReviewFromClosedLifecycle(lifecycle, timestamp);
  }

  private fillTouchedPaperLimitOrders(
    priceBySymbol: Map<string, { markPrice: number | null; lastPrice: number | null }>
  ): void {
    const activeLimitOrders = orderRepository.listActivePaperLimitOrdersForSymbols(
      Array.from(priceBySymbol.keys())
    );

    for (const order of activeLimitOrders) {
      const marketPrice = priceBySymbol.get(order.symbol);
      const referencePrice = marketPrice?.markPrice ?? marketPrice?.lastPrice ?? null;

      if (!isPositiveNumber(order.price) || !isPositiveNumber(referencePrice)) {
        continue;
      }

      const touched =
        order.side === "BUY"
          ? referencePrice <= order.price
          : referencePrice >= order.price;

      if (!touched) {
        continue;
      }

      this.fillPaperLimitOrder(order, referencePrice);
    }
  }

  private fillPaperLimitOrder(order: OrderStatePayload, marketPrice: number): void {
    const current = orderRepository.getOrderByClientOrderId(order.clientOrderId);

    if (
      !current ||
      current.status !== "NEW" ||
      !current.dryRun ||
      current.orderType !== "LIMIT" ||
      current.reduceOnly ||
      current.protectiveKind ||
      !isPositiveNumber(current.price)
    ) {
      return;
    }

    const timestamp = Date.now();
    const filledOrder: OrderStatePayload = {
      ...current,
      status: "FILLED",
      executedQty: current.quantity,
      avgPrice: current.price,
      updatedAt: timestamp,
      lastEventSource: "paper_engine",
      rejectReason: null
    };

    this.execution.validatePaperCommand(
      buildExecutionCommand({
        type: "PAPER",
        intentId: filledOrder.intentId,
        decisionId: null,
        symbol: filledOrder.symbol,
        quantity: filledOrder.quantity,
        metadata: {
          clientOrderId: filledOrder.clientOrderId,
          orderType: filledOrder.orderType,
          dryRun: filledOrder.dryRun
        }
      }),
      filledOrder
    );
    orderRepository.upsertOrderState(filledOrder);
    this.emitOrderStatus(filledOrder);
    this.emitAuditEvent(
      filledOrder,
      "paper_limit_touched",
      `Paper LIMIT order touched at market price ${formatOrderPrice(marketPrice)} and filled at ${formatOrderPrice(
        current.price
      )}.`,
      {
        marketPrice,
        limitPrice: current.price,
        executedQty: filledOrder.executedQty
      },
      timestamp
    );

    const protectiveLegs = this.armPaperProtectiveLegs(filledOrder, timestamp);
    this.openPaperPosition(filledOrder, protectiveLegs, timestamp);
  }

  private recoverPendingPaperMarketOrders(): void {
    const pendingOrders = orderRepository.listRecoverablePaperMarketOrders();

    for (const order of pendingOrders) {
      if (orderRepository.getPaperPositionByEntryOrderId(order.orderId)) {
        continue;
      }

      const executionPrice = order.avgPrice ?? order.price;
      const timestamp = Date.now();

      if (!isPositiveNumber(executionPrice)) {
        this.emitAuditEvent(
          order,
          "PAPER_MARKET_RECOVERY_SKIPPED",
          "Pending paper MARKET order could not be recovered because no execution price was persisted.",
          {
            orderId: order.orderId,
            intentId: order.intentId,
            clientOrderId: order.clientOrderId
          },
          timestamp
        );
        continue;
      }

      this.completePaperMarketOrder(
        order,
        executionPrice,
        timestamp,
        "PAPER_MARKET_RECOVERED",
        "Recovered pending paper MARKET order after backend restart."
      );
    }
  }

  private generateRecoveryFingerprint(input: {
    eventType: string;
    symbol: string | null;
    lifecycleId: string | null;
    orderIntentId: string | null;
    decisionContextId: string | null;
    clientOrderId: string | null;
    exchangeOrderId: string | null;
    matchMethod: string | null;
    reason: string;
  }): string {
    const parts = [
      input.eventType,
      input.symbol ?? "",
      input.lifecycleId ?? "",
      input.orderIntentId ?? "",
      input.decisionContextId ?? "",
      input.clientOrderId ?? "",
      input.exchangeOrderId ?? "",
      input.matchMethod ?? "",
      input.reason
    ];
    return parts.join("|");
  }

  private applyLiveLifecycleClosureFromRecovery(input: {
    lifecycle: PositionLifecycle;
    relatedLocalOrders: OrderStatePayload[] | null;
    closureEvaluation: LiveLifecycleClosureEvaluation;
    recoveryRunId: string;
    dedupWindowMs: number;
    timestamp: number;
  }): LiveLifecycleClosureApplyResult {
    const emptyResult: LiveLifecycleClosureApplyResult = {
      closed: false,
      markerType: null,
      skippedDuplicate: false,
      error: null
    };

    if (
      input.closureEvaluation.decision === "AMBIGUOUS" ||
      input.closureEvaluation.decision === "CANNOT_CLOSE"
    ) {
      return emptyResult;
    }

    if (input.closureEvaluation.decision !== "CAN_CLOSE") {
      return emptyResult;
    }

    const orderIntentId = normalizeText(input.lifecycle.orderIntentId);
    if (
      !orderIntentId ||
      input.closureEvaluation.matchMethod !== "orderIntentId" ||
      (input.lifecycle.status !== "OPEN" && input.lifecycle.status !== "MANAGING") ||
      input.relatedLocalOrders === null ||
      input.relatedLocalOrders.length === 0
    ) {
      return emptyResult;
    }

    const anchorOrder =
      input.relatedLocalOrders.find(
        (order) =>
          normalizeText(order.intentId) === orderIntentId &&
          normalizeText(order.parentOrderId) === null
      ) ?? input.relatedLocalOrders[0];

    if (!anchorOrder) {
      return emptyResult;
    }

    const markerType = "LIVE_RECOVERY_LIFECYCLE_CLOSED";
    const markerReason = "Evaluator returned CAN_CLOSE during live lifecycle recovery.";
    const fingerprint = this.generateRecoveryFingerprint({
      eventType: markerType,
      symbol: input.lifecycle.symbol,
      lifecycleId: input.lifecycle.id,
      orderIntentId,
      decisionContextId: input.lifecycle.decisionContextId ?? null,
      clientOrderId: anchorOrder.clientOrderId,
      exchangeOrderId: anchorOrder.exchangeOrderId,
      matchMethod: input.closureEvaluation.matchMethod,
      reason: markerReason
    });
    const existingMarker = orderRepository.findRecentOrderAuditEventByFingerprint(
      markerType,
      fingerprint,
      input.dedupWindowMs
    );

    try {
      const closed = this.execution.lifecycleManager.closeLiveRecoveryLifecycle({
        lifecycle: input.lifecycle,
        timestamp: input.timestamp,
        payload: {
          recoveryRunId: input.recoveryRunId,
          reason: markerReason,
          orderIntentId,
          decisionContextId: input.lifecycle.decisionContextId,
          symbol: input.lifecycle.symbol,
          closureEvaluation: input.closureEvaluation
        }
      });

      if (!existingMarker) {
        this.emitAuditEvent(
          anchorOrder,
          markerType,
          "Live lifecycle closed by recovery after evaluator returned CAN_CLOSE.",
          {
            recoveryRunId: input.recoveryRunId,
            fingerprint,
            reason: markerReason,
            lifecycleId: closed.id,
            orderIntentId,
            decisionContextId: closed.decisionContextId,
            symbol: closed.symbol,
            closureEvaluation: input.closureEvaluation,
            timestamp: input.timestamp
          },
          input.timestamp
        );
      }

      return {
        closed: true,
        markerType,
        skippedDuplicate: Boolean(existingMarker),
        error: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorMarkerType = "LIVE_RECOVERY_LIFECYCLE_CLOSE_ERROR";
      const errorReason = "Live lifecycle recovery closure failed.";
      const errorFingerprint = this.generateRecoveryFingerprint({
        eventType: errorMarkerType,
        symbol: input.lifecycle.symbol,
        lifecycleId: input.lifecycle.id,
        orderIntentId,
        decisionContextId: input.lifecycle.decisionContextId ?? null,
        clientOrderId: anchorOrder.clientOrderId,
        exchangeOrderId: anchorOrder.exchangeOrderId,
        matchMethod: input.closureEvaluation.matchMethod,
        reason: `${errorReason} ${message}`
      });
      const existingErrorMarker = orderRepository.findRecentOrderAuditEventByFingerprint(
        errorMarkerType,
        errorFingerprint,
        input.dedupWindowMs
      );

      if (!existingErrorMarker) {
        try {
          this.emitAuditEvent(
            anchorOrder,
            errorMarkerType,
            errorReason,
            {
              recoveryRunId: input.recoveryRunId,
              fingerprint: errorFingerprint,
              reason: errorReason,
              error: message,
              lifecycleId: input.lifecycle.id,
              orderIntentId,
              decisionContextId: input.lifecycle.decisionContextId,
              symbol: input.lifecycle.symbol,
              closureEvaluation: input.closureEvaluation,
              timestamp: input.timestamp
            },
            input.timestamp
          );
        } catch (emitError) {
          console.warn("Live lifecycle recovery close error marker failed", emitError);
        }
      }

      console.warn("Live lifecycle recovery close failed", error);
      return {
        closed: false,
        markerType: errorMarkerType,
        skippedDuplicate: Boolean(existingErrorMarker),
        error: message
      };
    }
  }

  private async recoverLivePositionLifecyclesAuditOnly(): Promise<void> {
    const startedAt = Date.now();
    const recoveryRunId = `live-recovery-${startedAt}-${randomUUID().slice(0, 8)}`;
    const dedupWindowMs = 24 * 60 * 60 * 1000; // 24 hours

    try {
      const apiKey = this.options.apiKey;
      const apiSecret = this.options.apiSecret;

      if (!apiKey || !apiSecret) {
        return;
      }

      const [exchangeOrders, exchangePositions] = await Promise.all([
        getOpenOrders(this.restBase, apiKey, apiSecret),
        fetchPositionRiskSnapshot(this.restBase, apiKey, apiSecret)
      ]);

      const localLifecycles = this.execution.lifecycleManager.listOpenPositionLifecycles(100);
      const localActiveOrders = orderRepository.listActiveNonPaperOrders(100);

      const exchangeOrderMap = new Map<string, RestFuturesOrder>();
      for (const order of exchangeOrders) {
        exchangeOrderMap.set(order.clientOrderId, order);
        if (order.orderId) {
          exchangeOrderMap.set(String(order.orderId), order);
        }
      }

      const exchangePositionMap = new Map<string, RestPositionRiskV3>();
      for (const position of exchangePositions) {
        const key = `${position.symbol}_${position.positionSide}`;
        exchangePositionMap.set(key, position);
      }

      const localOrderMap = new Map<string, OrderStatePayload>();
      for (const order of localActiveOrders) {
        localOrderMap.set(order.clientOrderId, order);
        if (order.exchangeOrderId) {
          localOrderMap.set(order.exchangeOrderId, order);
        }
      }

      let lifecyclePositionClosedCount = 0;
      let lifecycleOrphanCount = 0;
      let orderOrphanCount = 0;
      let exchangeOrderOrphanCount = 0;
      let positionNoLifecycleCount = 0;
      let lifecycleClosedByRecoveryCount = 0;
      let lifecycleCloseErrorCount = 0;
      let skippedDuplicateCount = 0;
      const markerCountsByType: Record<string, number> = {};
      const closureDecisionCounts: Record<LiveLifecycleClosureDecision, number> = {
        CAN_CLOSE: 0,
        CANNOT_CLOSE: 0,
        AMBIGUOUS: 0
      };

      for (const lifecycle of localLifecycles) {
        let relatedLocalOrders: OrderStatePayload[] | null = null;
        if (lifecycle.orderIntentId) {
          try {
            relatedLocalOrders = orderRepository.listOrdersForIntentChain(lifecycle.orderIntentId);
        } catch {
          relatedLocalOrders = null;
        }
      }
        const lifecycleSymbol = normalizeSymbol(lifecycle.symbol);
        const exchangePositionsForClosure =
          lifecycleSymbol &&
          !exchangePositions.some((position) => normalizeSymbol(position.symbol) === lifecycleSymbol)
            ? [...exchangePositions, buildFlatPositionRisk(lifecycleSymbol)]
            : exchangePositions;
        const closureEvaluation = evaluateLiveLifecycleClosure({
          lifecycle,
          relatedLocalOrders,
          exchangeOpenOrders: exchangeOrders,
          exchangePositions: exchangePositionsForClosure,
          timestamp: startedAt
        });
        closureDecisionCounts[closureEvaluation.decision] += 1;

        const exchangePosition = exchangePositionMap.get(`${lifecycle.symbol}_BOTH`) ||
                                exchangePositionMap.get(`${lifecycle.symbol}_LONG`) ||
                                exchangePositionMap.get(`${lifecycle.symbol}_SHORT`);

        if (!exchangePosition) {
          if (closureEvaluation.decision === "CAN_CLOSE") {
            const closureApplyResult = this.applyLiveLifecycleClosureFromRecovery({
              lifecycle,
              relatedLocalOrders,
              closureEvaluation: {
                ...closureEvaluation,
                reason:
                  "Signed positionRisk returned no row for symbol; local terminal order chain and open-order evidence prove flat."
              },
              recoveryRunId,
              dedupWindowMs,
              timestamp: startedAt
            });
            if (closureApplyResult.closed) {
              lifecycleClosedByRecoveryCount++;
            }
            if (closureApplyResult.error) {
              lifecycleCloseErrorCount++;
            }
            if (closureApplyResult.skippedDuplicate) {
              skippedDuplicateCount++;
            }
            if (closureApplyResult.markerType) {
              markerCountsByType[closureApplyResult.markerType] =
                (markerCountsByType[closureApplyResult.markerType] || 0) + 1;
            }
            continue;
          }

          lifecycleOrphanCount++;
          const fingerprint = this.generateRecoveryFingerprint({
            eventType: "LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION",
            symbol: lifecycle.symbol,
            lifecycleId: lifecycle.id,
            orderIntentId: lifecycle.orderIntentId ?? null,
            decisionContextId: lifecycle.decisionContextId ?? null,
            clientOrderId: null,
            exchangeOrderId: null,
            matchMethod: "symbol",
            reason: "Lifecycle exists but no exchange position found for symbol."
          });
          const existing = recoveryAuditRepository.findRecentRecoveryAuditEventByFingerprint(
            "LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION",
            fingerprint,
            dedupWindowMs
          );
          if (existing) {
            skippedDuplicateCount++;
            markerCountsByType["LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION"] =
              (markerCountsByType["LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION"] || 0) + 1;
            continue;
          }
          this.emitRecoveryAuditEvent({
            eventType: "LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION",
            fingerprint,
            message: "Lifecycle exists but no exchange position found for symbol.",
            payload: {
              recoveryRunId,
              fingerprint,
              reason: "Lifecycle exists but no exchange position found for symbol.",
              symbol: lifecycle.symbol,
              lifecycleId: lifecycle.id,
              orderIntentId: lifecycle.orderIntentId,
              decisionContextId: lifecycle.decisionContextId,
              clientOrderId: null,
              exchangeOrderId: null,
              exchangePositionAmt: null,
              matchMethod: "symbol",
              closureEvaluation,
              timestamp: startedAt
            },
            timestamp: startedAt,
            symbol: lifecycle.symbol,
            intentId: lifecycle.orderIntentId ?? null,
            lifecycleId: lifecycle.id,
            decisionContextId: lifecycle.decisionContextId ?? null
          });
          markerCountsByType["LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION"] =
            (markerCountsByType["LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION"] || 0) + 1;
          continue;
        }

        const positionAmt = safeNumber(exchangePosition.positionAmt);
        if (Math.abs(positionAmt) <= 0) {
          if (closureEvaluation.decision === "CAN_CLOSE") {
            const closureApplyResult = this.applyLiveLifecycleClosureFromRecovery({
              lifecycle,
              relatedLocalOrders,
              closureEvaluation,
              recoveryRunId,
              dedupWindowMs,
              timestamp: startedAt
            });
            if (closureApplyResult.closed) {
              lifecycleClosedByRecoveryCount++;
            }
            if (closureApplyResult.error) {
              lifecycleCloseErrorCount++;
            }
            if (closureApplyResult.skippedDuplicate) {
              skippedDuplicateCount++;
            }
            if (closureApplyResult.markerType) {
              markerCountsByType[closureApplyResult.markerType] =
                (markerCountsByType[closureApplyResult.markerType] || 0) + 1;
            }
            continue;
          }

          lifecyclePositionClosedCount++;
          const fingerprint = this.generateRecoveryFingerprint({
            eventType: "LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED",
            symbol: lifecycle.symbol,
            lifecycleId: lifecycle.id,
            orderIntentId: lifecycle.orderIntentId ?? null,
            decisionContextId: lifecycle.decisionContextId ?? null,
            clientOrderId: null,
            exchangeOrderId: null,
            matchMethod: "symbol",
            reason: "Lifecycle is OPEN/MANAGING but exchange positionAmt is zero."
          });
          const existing = recoveryAuditRepository.findRecentRecoveryAuditEventByFingerprint(
            "LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED",
            fingerprint,
            dedupWindowMs
          );
          if (existing) {
            skippedDuplicateCount++;
            markerCountsByType["LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED"] =
              (markerCountsByType["LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED"] || 0) + 1;
            continue;
          }
          this.emitRecoveryAuditEvent({
            eventType: "LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED",
            fingerprint,
            message: "Lifecycle is OPEN/MANAGING but exchange positionAmt is zero.",
            payload: {
              recoveryRunId,
              fingerprint,
              reason: "Lifecycle is OPEN/MANAGING but exchange positionAmt is zero.",
              symbol: lifecycle.symbol,
              lifecycleId: lifecycle.id,
              orderIntentId: lifecycle.orderIntentId,
              decisionContextId: lifecycle.decisionContextId,
              clientOrderId: null,
              exchangeOrderId: null,
              exchangePositionAmt: positionAmt,
              matchMethod: "symbol",
              closureEvaluation,
              timestamp: startedAt
            },
            timestamp: startedAt,
            symbol: lifecycle.symbol,
            intentId: lifecycle.orderIntentId ?? null,
            lifecycleId: lifecycle.id,
            decisionContextId: lifecycle.decisionContextId ?? null
          });
          markerCountsByType["LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED"] =
            (markerCountsByType["LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED"] || 0) + 1;
        }
      }

      for (const order of localActiveOrders) {
        const exchangeOrder = exchangeOrderMap.get(order.clientOrderId) ||
                               exchangeOrderMap.get(order.exchangeOrderId || "");

        if (!exchangeOrder) {
          orderOrphanCount++;
          const fingerprint = this.generateRecoveryFingerprint({
            eventType: "LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER",
            symbol: order.symbol,
            lifecycleId: null,
            orderIntentId: order.intentId,
            decisionContextId: null,
            clientOrderId: order.clientOrderId,
            exchangeOrderId: order.exchangeOrderId,
            matchMethod: "clientOrderId",
            reason: "Local active order has no matching exchange open order."
          });
          const existing = orderRepository.findRecentOrderAuditEventByFingerprint(
            "LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER",
            fingerprint,
            dedupWindowMs
          );
          if (existing) {
            skippedDuplicateCount++;
            markerCountsByType["LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER"] =
              (markerCountsByType["LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER"] || 0) + 1;
            continue;
          }
          this.emitAuditEvent(
            order,
            "LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER",
            "Local active order has no matching exchange open order.",
            {
              recoveryRunId,
              fingerprint,
              reason: "Local active order has no matching exchange open order.",
              symbol: order.symbol,
              lifecycleId: null,
              orderIntentId: order.intentId,
              decisionContextId: null,
              clientOrderId: order.clientOrderId,
              exchangeOrderId: order.exchangeOrderId,
              exchangePositionAmt: null,
              matchMethod: "clientOrderId",
              timestamp: startedAt
            },
            startedAt
          );
          markerCountsByType["LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER"] =
            (markerCountsByType["LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER"] || 0) + 1;
        }
      }

      for (const exchangeOrder of exchangeOrders) {
        const localOrder = localOrderMap.get(exchangeOrder.clientOrderId) ||
                           localOrderMap.get(exchangeOrder.orderId ? String(exchangeOrder.orderId) : "");

        if (!localOrder) {
          exchangeOrderOrphanCount++;
          const fingerprint = this.generateRecoveryFingerprint({
            eventType: "LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER",
            symbol: exchangeOrder.symbol,
            lifecycleId: null,
            orderIntentId: null,
            decisionContextId: null,
            clientOrderId: exchangeOrder.clientOrderId,
            exchangeOrderId: exchangeOrder.orderId ? String(exchangeOrder.orderId) : null,
            matchMethod: "clientOrderId",
            reason: "Exchange open order has no matching local order."
          });
          const existing = recoveryAuditRepository.findRecentRecoveryAuditEventByFingerprint(
            "LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER",
            fingerprint,
            dedupWindowMs
          );
          if (existing) {
            skippedDuplicateCount++;
            markerCountsByType["LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER"] =
              (markerCountsByType["LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER"] || 0) + 1;
            continue;
          }
          this.emitRecoveryAuditEvent({
            eventType: "LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER",
            fingerprint,
            message: "Exchange open order has no matching local order.",
            payload: {
              recoveryRunId,
              fingerprint,
              reason: "Exchange open order has no matching local order.",
              symbol: exchangeOrder.symbol,
              lifecycleId: null,
              orderIntentId: null,
              decisionContextId: null,
              clientOrderId: exchangeOrder.clientOrderId,
              exchangeOrderId: exchangeOrder.orderId ? String(exchangeOrder.orderId) : null,
              exchangePositionAmt: null,
              matchMethod: "clientOrderId",
              timestamp: startedAt
            },
            timestamp: startedAt,
            symbol: exchangeOrder.symbol,
            clientOrderId: exchangeOrder.clientOrderId,
            exchangeOrderId: exchangeOrder.orderId ? String(exchangeOrder.orderId) : null
          });
          markerCountsByType["LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER"] =
            (markerCountsByType["LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER"] || 0) + 1;
        }
      }

      for (const position of exchangePositions) {
        const positionAmt = safeNumber(position.positionAmt);
        if (Math.abs(positionAmt) <= 0) {
          continue;
        }

        const hasLifecycle = localLifecycles.some(
          lifecycle => lifecycle.symbol === position.symbol
        );

        if (!hasLifecycle) {
          positionNoLifecycleCount++;
          const fingerprint = this.generateRecoveryFingerprint({
            eventType: "LIVE_RECOVERY_POSITION_NO_LIFECYCLE",
            symbol: position.symbol,
            lifecycleId: null,
            orderIntentId: null,
            decisionContextId: null,
            clientOrderId: null,
            exchangeOrderId: null,
            matchMethod: "symbol",
            reason: "Exchange position exists but no lifecycle can be safely matched."
          });
          const existing = recoveryAuditRepository.findRecentRecoveryAuditEventByFingerprint(
            "LIVE_RECOVERY_POSITION_NO_LIFECYCLE",
            fingerprint,
            dedupWindowMs
          );
          if (existing) {
            skippedDuplicateCount++;
            markerCountsByType["LIVE_RECOVERY_POSITION_NO_LIFECYCLE"] =
              (markerCountsByType["LIVE_RECOVERY_POSITION_NO_LIFECYCLE"] || 0) + 1;
            continue;
          }
          this.emitRecoveryAuditEvent({
            eventType: "LIVE_RECOVERY_POSITION_NO_LIFECYCLE",
            fingerprint,
            message: "Exchange position exists but no lifecycle can be safely matched.",
            payload: {
              recoveryRunId,
              fingerprint,
              reason: "Exchange position exists but no lifecycle can be safely matched.",
              symbol: position.symbol,
              lifecycleId: null,
              orderIntentId: null,
              decisionContextId: null,
              clientOrderId: null,
              exchangeOrderId: null,
              exchangePositionAmt: positionAmt,
              matchMethod: "symbol",
              timestamp: startedAt
            },
            timestamp: startedAt,
            symbol: position.symbol
          });
          markerCountsByType["LIVE_RECOVERY_POSITION_NO_LIFECYCLE"] =
            (markerCountsByType["LIVE_RECOVERY_POSITION_NO_LIFECYCLE"] || 0) + 1;
        }
      }

      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      const emittedMarkerCount = Object.values(markerCountsByType).reduce((sum, count) => sum + count, 0);

      const summaryAnchor =
        localActiveOrders[0] ??
        localLifecycles
          .map((lifecycle) =>
            lifecycle.orderIntentId
              ? orderRepository.getOrderByIntentId(lifecycle.orderIntentId)
              : null
          )
          .find((order): order is OrderStatePayload => order !== null);
      if (summaryAnchor) {
        this.emitAuditEvent(
          summaryAnchor,
          "LIVE_RECOVERY_SUMMARY",
          "Live lifecycle recovery audit summary.",
          {
            recoveryRunId,
            startedAt,
            finishedAt,
            durationMs,
            localLifecycleCount: localLifecycles.length,
            localActiveOrderCount: localActiveOrders.length,
            exchangeOpenOrderCount: exchangeOrders.length,
            exchangeOpenPositionCount: exchangePositions.length,
            emittedMarkerCount,
            skippedDuplicateCount,
            errors: null,
            markerCountsByType,
            closureDecisionCounts,
            summary: {
              lifecyclePositionClosed: lifecyclePositionClosedCount,
              lifecycleClosedByRecovery: lifecycleClosedByRecoveryCount,
              lifecycleCloseError: lifecycleCloseErrorCount,
              lifecycleOrphan: lifecycleOrphanCount,
              orderOrphan: orderOrphanCount,
              exchangeOrderOrphan: exchangeOrderOrphanCount,
              positionNoLifecycle: positionNoLifecycleCount,
              localLifecyclesChecked: localLifecycles.length,
              localActiveOrdersChecked: localActiveOrders.length,
              exchangeOrdersChecked: exchangeOrders.length,
              exchangePositionsChecked: exchangePositions.length
            }
          },
          startedAt
        );
      }
    } catch (error) {
      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      const fingerprint = this.generateRecoveryFingerprint({
        eventType: "LIVE_RECOVERY_ERROR",
        symbol: null,
        lifecycleId: null,
        orderIntentId: null,
        decisionContextId: null,
        clientOrderId: null,
        exchangeOrderId: null,
        matchMethod: null,
        reason: `Live lifecycle recovery audit failed. ${
          error instanceof Error ? error.message : String(error)
        }`
      });
      this.emitRecoveryAuditEvent({
        eventType: "LIVE_RECOVERY_ERROR",
        fingerprint,
        message: "Live lifecycle recovery audit failed.",
        payload: {
          recoveryRunId,
          fingerprint,
          startedAt,
          finishedAt,
          durationMs,
          localLifecycleCount: 0,
          localActiveOrderCount: 0,
          exchangeOpenOrderCount: 0,
          exchangeOpenPositionCount: 0,
          emittedMarkerCount: 0,
          skippedDuplicateCount: 0,
          errors: error instanceof Error ? error.message : String(error),
          markerCountsByType: {},
          reason: "Live lifecycle recovery audit failed.",
          symbol: null,
          lifecycleId: null,
          orderIntentId: null,
          decisionContextId: null,
          clientOrderId: null,
          exchangeOrderId: null,
          exchangePositionAmt: null,
          matchMethod: null,
          timestamp: startedAt
        },
        timestamp: startedAt
      });
    }
  }

  private completePaperMarketOrder(
    order: OrderStatePayload,
    executionPrice: number,
    timestamp: number,
    auditEventType: string,
    auditMessage: string,
    links: {
      decisionContextId?: string | null;
      unifiedSignalId?: string | null;
    } = {}
  ): void {
    const current = orderRepository.getOrderByClientOrderId(order.clientOrderId);

    if (
      !current ||
      isTerminalOrderStatus(current.status) ||
      !current.dryRun ||
      current.orderType !== "MARKET" ||
      current.reduceOnly ||
      current.protectiveKind
    ) {
      return;
    }

    const filledOrder: OrderStatePayload = {
      ...current,
      status: "FILLED",
      executedQty: current.quantity,
      avgPrice: executionPrice,
      price: current.price ?? executionPrice,
      updatedAt: timestamp,
      lastEventSource: "paper_engine"
    };

    this.execution.validatePaperCommand(
      buildExecutionCommand({
        type: "PAPER",
        intentId: filledOrder.intentId,
        decisionId: links.decisionContextId ?? null,
        symbol: filledOrder.symbol,
        quantity: filledOrder.quantity,
        metadata: {
          clientOrderId: filledOrder.clientOrderId,
          orderType: filledOrder.orderType,
          dryRun: filledOrder.dryRun
        }
      }),
      filledOrder
    );
    orderRepository.upsertOrderState(filledOrder);
    this.emitOrderStatus(filledOrder);
    this.emitAuditEvent(
      filledOrder,
      auditEventType,
      auditMessage,
      {
        executedQty: filledOrder.executedQty,
        executionPrice
      },
      timestamp
    );
    const protectiveLegs = this.armPaperProtectiveLegs(filledOrder, timestamp);
    this.openPaperPosition(filledOrder, protectiveLegs, timestamp, links);
    this.clearPendingTimers(order.clientOrderId);
  }

  private schedulePaperLifecycle(
    order: OrderStatePayload,
    executionPrice: number | null,
    links: {
      decisionContextId?: string | null;
      unifiedSignalId?: string | null;
    } = {}
  ): void {
    this.clearPendingTimers(order.clientOrderId);

    const partialTimer = setTimeout(() => {
      const current = orderRepository.getOrderByClientOrderId(order.clientOrderId);

      if (!current || isTerminalOrderStatus(current.status)) {
        return;
      }

      const partialQty = current.quantity > 0 ? current.quantity / 2 : 0;
      const partialOrder: OrderStatePayload = {
        ...current,
        status: "PARTIALLY_FILLED",
        executedQty: partialQty,
        avgPrice: executionPrice ?? current.price ?? null,
        updatedAt: Date.now(),
        lastEventSource: "paper_engine"
      };

      orderRepository.upsertOrderState(partialOrder);
      this.emitOrderStatus(partialOrder);
      this.emitAuditEvent(
        partialOrder,
        "paper_partial_fill",
        "Paper mode simulated a partial fill.",
        {
          executedQty: partialQty
        },
        partialOrder.updatedAt
      );
    }, 50);

    const fillTimer = setTimeout(() => {
      const current = orderRepository.getOrderByClientOrderId(order.clientOrderId);

      if (!current || isTerminalOrderStatus(current.status)) {
        return;
      }

      const fillTimestamp = Date.now();
      const fillPrice = executionPrice ?? current.price;

      if (!isPositiveNumber(fillPrice)) {
        return;
      }

      if (current.orderType === "MARKET") {
        this.completePaperMarketOrder(
          current,
          fillPrice,
          fillTimestamp,
          "paper_filled",
          "Paper mode simulated a full fill.",
          links
        );
        return;
      }

      const filledOrder: OrderStatePayload = {
        ...current,
        status: "FILLED",
        executedQty: current.quantity,
        avgPrice: fillPrice,
        updatedAt: fillTimestamp,
        lastEventSource: "paper_engine"
      };

      orderRepository.upsertOrderState(filledOrder);
      this.emitOrderStatus(filledOrder);
      this.emitAuditEvent(
        filledOrder,
        "paper_filled",
        "Paper mode simulated a full fill.",
        {
          executedQty: filledOrder.executedQty
        },
        filledOrder.updatedAt
      );
      const protectiveLegs = this.armPaperProtectiveLegs(filledOrder, filledOrder.updatedAt);
      this.openPaperPosition(filledOrder, protectiveLegs, filledOrder.updatedAt, links);
      this.clearPendingTimers(order.clientOrderId);
    }, 100);

    this.pendingTimers.set(order.clientOrderId, [partialTimer, fillTimer]);
  }

  private resolvePaperOrderDecisionLinks(
    filledOrder: OrderStatePayload,
    links: {
      decisionContextId?: string | null;
      unifiedSignalId?: string | null;
    } = {}
  ): {
    decisionContextId: string | null;
    unifiedSignalId: string | null;
  } {
    const existingDecisionContextId = links.decisionContextId ?? null;
    const existingUnifiedSignalId = links.unifiedSignalId ?? null;

    if ((existingDecisionContextId && existingUnifiedSignalId) || !filledOrder.intentId) {
      return {
        decisionContextId: existingDecisionContextId,
        unifiedSignalId: existingUnifiedSignalId
      };
    }

    const decisionContext = tradeDecisionRepository.getTradeDecisionContextByOrderIntentId(
      filledOrder.intentId
    );

    return {
      decisionContextId: existingDecisionContextId ?? decisionContext?.id ?? null,
      unifiedSignalId:
        existingUnifiedSignalId ??
        decisionContext?.unifiedSignalId ??
        decisionContext?.signalId ??
        null
    };
  }

  private openPaperPosition(
    filledOrder: OrderStatePayload,
    protectiveLegs: OrderStatePayload[],
    timestamp: number,
    links: {
      decisionContextId?: string | null;
      unifiedSignalId?: string | null;
    } = {}
  ): void {
    if (!filledOrder.dryRun || filledOrder.protectiveKind || filledOrder.reduceOnly) {
      return;
    }

    const quantity = filledOrder.executedQty > 0 ? filledOrder.executedQty : filledOrder.quantity;
    const entryPrice = filledOrder.avgPrice ?? filledOrder.price;

    if (quantity <= 0 || !isPositiveNumber(entryPrice)) {
      return;
    }

    const lifecycleLinks = this.resolvePaperOrderDecisionLinks(filledOrder, links);
    const position = orderRepository.createPaperPosition({
      paperPositionId: randomUUID(),
      symbol: filledOrder.symbol,
      side: filledOrder.side === "BUY" ? "LONG" : "SHORT",
      quantity,
      entryPrice,
      entryOrderId: filledOrder.orderId,
      stopLossOrderId:
        protectiveLegs.find((leg) => leg.protectiveKind === "STOP_LOSS")?.orderId ?? null,
      takeProfitOrderId:
        protectiveLegs.find((leg) => leg.protectiveKind === "TAKE_PROFIT")?.orderId ?? null,
      openedAt: timestamp
    });

    this.emitPaperPositionOpened(position, timestamp);
    this.createOrOpenPaperPositionLifecycle({
      filledOrder,
      position,
      timestamp,
      decisionContextId: lifecycleLinks.decisionContextId,
      unifiedSignalId: lifecycleLinks.unifiedSignalId
    });
    this.emitAuditEvent(
      filledOrder,
      "PAPER_POSITION_OPENED",
      `Opened ${position.side} paper position at ${formatOrderPrice(position.entryPrice)}.`,
      {
        paperPositionId: position.paperPositionId,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        stopLossOrderId: position.stopLossOrderId,
        takeProfitOrderId: position.takeProfitOrderId
      },
      timestamp
    );
  }

  private updateOpenPaperPositions(
    priceBySymbol: Map<string, { markPrice: number | null; lastPrice: number | null }>
  ): void {
    const timestamp = Date.now();
    const openPositions = orderRepository.listOpenPaperPositions(Array.from(priceBySymbol.keys()));

    for (const position of openPositions) {
      const marketPrice = priceBySymbol.get(position.symbol);
      const referencePrice = marketPrice?.markPrice ?? marketPrice?.lastPrice ?? null;

      if (!isPositiveNumber(referencePrice)) {
        continue;
      }

      const updated = orderRepository.updateUnrealizedPnl({
        paperPositionId: position.paperPositionId,
        marketPrice: referencePrice,
        updatedAt: timestamp
      });

      if (!updated || updated.unrealizedPnl === position.unrealizedPnl) {
        continue;
      }

      this.emitPaperPositionUpdated(updated, timestamp);
      this.updatePaperPositionLifecycle(updated, timestamp);

      const entryOrder = orderRepository.getOrderByOrderId(updated.entryOrderId);
      if (entryOrder) {
        this.emitAuditEvent(
          entryOrder,
          "PAPER_POSITION_UPDATED",
          `Updated paper position unrealized PnL to ${updated.unrealizedPnl?.toFixed(8) ?? "0"}.`,
          {
            paperPositionId: updated.paperPositionId,
            marketPrice: referencePrice,
            markPrice: marketPrice?.markPrice ?? null,
            lastPrice: marketPrice?.lastPrice ?? null,
            unrealizedPnl: updated.unrealizedPnl
          },
          timestamp
        );
      }
    }
  }

  private cancelPaperProtectiveLegsForPosition(
    position: PaperPositionPayload,
    timestamp: number
  ): OrderStatePayload[] {
    const protectiveOrderIds = [
      position.stopLossOrderId,
      position.takeProfitOrderId
    ].filter((orderId): orderId is string => Boolean(orderId));
    const canceledLegs: OrderStatePayload[] = [];

    for (const orderId of protectiveOrderIds) {
      const leg = orderRepository.getOrderByOrderId(orderId);

      if (
        !leg ||
        !leg.dryRun ||
        !leg.protectiveKind ||
        isTerminalOrderStatus(leg.status)
      ) {
        continue;
      }

      const canceledLeg: OrderStatePayload = {
        ...leg,
        status: "CANCELED",
        updatedAt: timestamp,
        lastEventSource: "paper_engine",
        rejectReason: null
      };

      orderRepository.upsertOrderState(canceledLeg);
      canceledLegs.push(canceledLeg);
      this.emitOrderStatus(canceledLeg);
      this.emitAuditEvent(
        canceledLeg,
        "SIBLING_CANCELED",
        "Paper protective leg canceled by manual paper position control.",
        {
          paperPositionId: position.paperPositionId,
          closeReason: position.closeReason
        },
        timestamp
      );
    }

    if (canceledLegs.length > 0) {
      this.activePaperProtectiveLegs = Math.max(
        0,
        this.activePaperProtectiveLegs - canceledLegs.length
      );
    }

    return canceledLegs;
  }

  private shouldTriggerProtectiveLeg(
    leg: OrderStatePayload,
    entrySide: OrderStatePayload["side"],
    marketPrice: number,
    triggerPrice: number
  ): boolean {
    if (leg.protectiveKind === "STOP_LOSS") {
      return entrySide === "BUY"
        ? marketPrice <= triggerPrice
        : marketPrice >= triggerPrice;
    }

    if (leg.protectiveKind === "TAKE_PROFIT") {
      return entrySide === "BUY"
        ? marketPrice >= triggerPrice
        : marketPrice <= triggerPrice;
    }

    return false;
  }

  private triggerPaperProtectiveLeg(input: {
    leg: OrderStatePayload;
    parent: OrderStatePayload | null;
    referencePrice: number;
    triggerPrice: number;
    markPrice: number | null;
    lastPrice: number | null;
  }): void {
    const currentLeg = orderRepository.getOrderByClientOrderId(input.leg.clientOrderId);

    if (!currentLeg || isTerminalOrderStatus(currentLeg.status) || !currentLeg.dryRun) {
      return;
    }

    const timestamp = Date.now();
    this.emitAuditEvent(
      currentLeg,
      "PROTECTIVE_TRIGGERED",
      `Paper ${currentLeg.protectiveKind} triggered at market price ${formatOrderPrice(
        input.referencePrice
      )}.`,
      {
        triggerPrice: input.triggerPrice,
        marketPrice: input.referencePrice,
        markPrice: input.markPrice,
        lastPrice: input.lastPrice,
        parentOrderId: currentLeg.parentOrderId
      },
      timestamp
    );

    const filledLeg: OrderStatePayload = {
      ...currentLeg,
      status: "FILLED",
      executedQty: currentLeg.quantity,
      avgPrice: input.referencePrice,
      updatedAt: timestamp,
      lastEventSource: "paper_engine",
      rejectReason: null
    };

    orderRepository.upsertOrderState(filledLeg);
    this.emitOrderStatus(filledLeg);
    this.emitAuditEvent(
      filledLeg,
      "PROTECTIVE_FILLED",
      `Paper ${filledLeg.protectiveKind} protective leg filled and closed the simulated position.`,
      {
        fillPrice: input.referencePrice,
        triggerPrice: input.triggerPrice,
        parentOrderId: filledLeg.parentOrderId
      },
      timestamp
    );

    const parent = input.parent ?? (filledLeg.parentOrderId
      ? orderRepository.getOrderByOrderId(filledLeg.parentOrderId)
      : null);
    const openPosition = parent
      ? orderRepository.getPaperPositionByEntryOrderId(parent.orderId)
      : null;
    const closedPosition =
      openPosition?.status === "OPEN" && filledLeg.protectiveKind
        ? orderRepository.closePaperPosition({
            paperPositionId: openPosition.paperPositionId,
            closePrice: input.referencePrice,
            closeReason: filledLeg.protectiveKind,
            closedAt: timestamp
          })
        : null;

    if (closedPosition?.status === "CLOSED") {
      if (typeof closedPosition.realizedPnl === "number" && Number.isFinite(closedPosition.realizedPnl)) {
        orderRepository.appendRealizedPnlLedgerEntry({
          id: randomUUID(),
          idempotencyKey: [
            "paper-position-close",
            closedPosition.paperPositionId,
            String(closedPosition.closedAt ?? timestamp),
            String(closedPosition.realizedPnl)
          ].join(":"),
          source: "paper_position_close",
          eventTime: closedPosition.closedAt ?? timestamp,
          symbol: closedPosition.symbol,
          orderId: parent?.orderId ?? null,
          clientOrderId: parent?.clientOrderId ?? null,
          exchangeOrderId: parent?.exchangeOrderId ?? null,
          tradeId: null,
          realizedPnl: closedPosition.realizedPnl,
          commission: null,
          commissionAsset: null
        });
      }
      this.emitPaperPositionClosed(closedPosition, timestamp);
      this.closePaperPositionLifecycle(closedPosition, timestamp);
    }

    let canceledSiblingCount = 0;

    if (filledLeg.parentOrderId) {
      const siblings = orderRepository.listActivePaperProtectiveSiblings(
        filledLeg.parentOrderId,
        filledLeg.orderId
      );

      for (const sibling of siblings) {
        const canceledSibling: OrderStatePayload = {
          ...sibling,
          status: "CANCELED",
          updatedAt: timestamp,
          lastEventSource: "paper_engine",
          rejectReason: null
        };

        orderRepository.upsertOrderState(canceledSibling);
        canceledSiblingCount += 1;
        this.emitOrderStatus(canceledSibling);
        this.emitAuditEvent(
          canceledSibling,
          "SIBLING_CANCELED",
          `Paper sibling protective leg canceled after ${filledLeg.protectiveKind} filled.`,
          {
            filledOrderId: filledLeg.orderId,
            filledClientOrderId: filledLeg.clientOrderId,
            parentOrderId: filledLeg.parentOrderId
          },
          timestamp
        );
      }
    }

    if (parent) {
      this.emitAuditEvent(
        parent,
        "PAPER_POSITION_CLOSED",
        `Simulated paper position closed by ${filledLeg.protectiveKind} at ${formatOrderPrice(
          input.referencePrice
        )}.`,
        {
          closingOrderId: filledLeg.orderId,
          closingClientOrderId: filledLeg.clientOrderId,
          fillPrice: input.referencePrice,
          triggerPrice: input.triggerPrice,
          protectiveKind: filledLeg.protectiveKind,
          paperPositionId: closedPosition?.paperPositionId ?? null,
          realizedPnl: closedPosition?.realizedPnl ?? null
        },
        timestamp
      );
    }

    this.paperProtectiveTriggers += 1;
    this.lastPaperProtectiveTriggerAt = timestamp;
    this.activePaperProtectiveLegs = Math.max(
      0,
      this.activePaperProtectiveLegs - 1 - canceledSiblingCount
    );
  }

  private clearPendingTimers(clientOrderId: string): void {
    const timers = this.pendingTimers.get(clientOrderId);
    if (!timers) {
      return;
    }

    for (const timer of timers) {
      clearTimeout(timer);
    }

    this.pendingTimers.delete(clientOrderId);
  }

  private replayIntentResponse(record: StoredOrderIntentResponse): void {
    if (record.response.type === "order_ack") {
      this.emit({
        ...record.response,
        generatedAt: Date.now(),
        payload: {
          ...record.response.payload,
          duplicate: true,
          validation: cloneValidation(record.response.payload.validation)
        }
      });
    } else if (record.response.type === "order_rejected") {
      this.emit({
        ...record.response,
        generatedAt: Date.now(),
        payload: {
          ...record.response.payload,
          duplicate: true,
          validation: cloneValidation(record.response.payload.validation)
        }
      });
    } else {
      this.emit({
        ...record.response,
        generatedAt: Date.now()
      });
    }

    const currentOrder =
      orderRepository.getOrderByIntentId(record.intentId) ??
      (record.response.type === "order_ack" || record.response.type === "order_rejected"
        ? record.response.payload.order
        : null);

    if (currentOrder) {
      this.emitAuditEvent(
        currentOrder,
        "duplicate_intent_ignored",
        "Duplicate intentId received; original result was replayed without re-executing.",
        {
          responseType: record.response.type
        },
        Date.now()
      );
      this.emitOrderStatus(currentOrder);
    }
  }

  private replaySubmittedIntentInFlight(intentId: string): void {
    const currentOrder = orderRepository.getOrderByIntentId(intentId);

    if (currentOrder) {
      this.emitAuditEvent(
        currentOrder,
        "duplicate_intent_in_flight",
        "Duplicate intentId ignored because a durable pre-submit order intent audit already exists.",
        {
          gateCode: "ORDER_INTENT_IN_FLIGHT"
        },
        Date.now()
      );
      this.emitOrderStatus(currentOrder);
    }

    this.emitOrderError({
      intentId,
      code: "ORDER_INTENT_IN_FLIGHT",
      message:
        "ORDER_INTENT_IN_FLIGHT: non-paper PLACE_ORDER was already durably submitted before final response persistence.",
      retriable: false
    });
  }

  private replayCancelIntentInFlight(
    intentId: string,
    payload: LiveSubmittedCancelIntentAuditPayload | null
  ): void {
    const currentOrder =
      (payload?.targetOrderId ? orderRepository.getOrderByOrderId(payload.targetOrderId) : null) ??
      (payload?.targetClientOrderId
        ? orderRepository.getOrderByClientOrderId(payload.targetClientOrderId)
        : null);

    if (currentOrder) {
      this.emitAuditEvent(
        {
          ...currentOrder,
          intentId
        },
        "duplicate_cancel_intent_in_flight",
        "Duplicate cancel intent ignored because a durable pre-submit cancel audit already exists.",
        {
          gateCode: "CANCEL_INTENT_IN_FLIGHT",
          classification: payload?.classification ?? null
        },
        Date.now()
      );
      this.emitOrderStatus(currentOrder);
    }

    this.emitOrderError({
      intentId,
      code: "CANCEL_INTENT_IN_FLIGHT",
      message:
        "CANCEL_INTENT_IN_FLIGHT: non-paper CANCEL_ORDER was already durably submitted before final response persistence.",
      retriable: false
    });
  }

  private persistIntentError(
    meta: NormalizedIntentMeta,
    error: {
      code: string;
      message: string;
      retriable: boolean;
    }
  ): void {
    const response: OrderErrorMessage = {
      type: "order_error",
      generatedAt: Date.now(),
      payload: {
        intentId: meta.intentId,
        code: error.code,
        message: error.message,
        retriable: error.retriable
      }
    };

    orderRepository.saveIntentResponse({
      intentId: meta.intentId,
      createdAt: meta.createdAt,
      sourceWindowId: meta.sourceWindowId,
      orderId: null,
      responseType: response.type,
      dryRun: meta.paperMode,
      response
    });
    this.emit(response);
  }

  private persistLiveIntentRejectedAudit(
    payload: OrderIntentMessage["payload"],
    meta: NormalizedIntentMeta,
    error: { code: string; message: string; retriable: boolean }
  ): void {
    const symbol = normalizeSymbol(payload.symbol) ?? "UNKNOWN";
    const side = payload.side === "SELL" ? "SELL" : "BUY";
    const orderType =
      payload.orderType === "LIMIT" ||
      payload.orderType === "STOP_MARKET" ||
      payload.orderType === "TAKE_PROFIT_MARKET"
        ? payload.orderType
        : "MARKET";
    const quantity =
      typeof payload.quantity === "number" && Number.isFinite(payload.quantity)
        ? Math.max(payload.quantity, 0)
        : 0;
    const timestamp = Date.now();
    const rejectedOrder = this.buildOrderState({
      intentId: meta.intentId,
      symbol,
      side,
      orderType,
      quantity,
      price:
        typeof payload.price === "number" && Number.isFinite(payload.price)
          ? payload.price
          : null,
      stopPrice:
        typeof payload.stopPrice === "number" && Number.isFinite(payload.stopPrice)
          ? payload.stopPrice
          : null,
      stopLossPrice:
        typeof payload.stopLossPrice === "number" && Number.isFinite(payload.stopLossPrice)
          ? payload.stopLossPrice
          : null,
      takeProfitPrice:
        typeof payload.takeProfitPrice === "number" && Number.isFinite(payload.takeProfitPrice)
          ? payload.takeProfitPrice
          : null,
      status: "REJECTED",
      clientOrderId:
        normalizeText(payload.clientOrderId) ??
        `live-rejected-${meta.intentId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || randomUUID()}`,
      sourceWindowId: meta.sourceWindowId,
      parentOrderId: null,
      protectiveKind: null,
      dryRun: false,
      reduceOnly: payload.reduceOnly === true,
      rejectReason: error.message,
      lastEventSource: "validation",
      createdAt: meta.createdAt,
      updatedAt: timestamp
    });

    orderRepository.upsertOrderState(rejectedOrder);
    this.emitAuditEvent(
      rejectedOrder,
      error.code === "LIVE_TRADING_DISABLED"
        ? "LIVE_TRADING_DISABLED"
        : error.code === "LIVE_TYPED_CONFIRM_FAILED"
          ? "LIVE_TYPED_CONFIRM_FAILED"
          : "LIVE_GATE_CHECK_FAILED",
      error.message,
      {
        action: payload.action,
        paperMode: meta.paperMode,
        retriable: error.retriable
      },
      timestamp
    );
    this.emitAuditEvent(
      rejectedOrder,
      "LIVE_INTENT_REJECTED",
      "Live order_intent rejected before Binance execution.",
      {
        gateCode: error.code,
        action: payload.action
      },
      timestamp
    );
    this.emitOrderStatus(rejectedOrder);
  }

  private emitAuditEvent(
    order: OrderStatePayload,
    eventType: string,
    message: string,
    payload: unknown,
    timestamp: number
  ): void {
    this.execution.audit.emitAuditEvent({ order, eventType, message, payload, timestamp });
  }

  private emitRecoveryAuditEvent(input: {
    eventType: string;
    fingerprint: string;
    message: string;
    payload: unknown;
    timestamp: number;
    symbol?: string | null;
    orderId?: string | null;
    intentId?: string | null;
    lifecycleId?: string | null;
    decisionContextId?: string | null;
    reviewId?: string | null;
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }): void {
    recoveryAuditRepository.appendRecoveryAuditEvent({
      eventType: input.eventType,
      fingerprint: input.fingerprint,
      timestamp: input.timestamp,
      symbol: input.symbol ?? null,
      orderId: input.orderId ?? null,
      intentId: input.intentId ?? null,
      lifecycleId: input.lifecycleId ?? null,
      decisionContextId: input.decisionContextId ?? null,
      reviewId: input.reviewId ?? null,
      clientOrderId: input.clientOrderId ?? null,
      exchangeOrderId: input.exchangeOrderId ?? null,
      message: input.message,
      payload: input.payload
    });
  }

  private emitOrderStatus(order: OrderStatePayload): void {
    this.emit({
      type: "order_status",
      generatedAt: Date.now(),
      payload: order
    });
  }

  private emitPaperPositionOpened(position: PaperPositionPayload, timestamp = Date.now()): void {
    this.emit({
      type: "paper_position_opened",
      generatedAt: timestamp,
      payload: position
    });
  }

  private emitPaperPositionUpdated(position: PaperPositionPayload, timestamp = Date.now()): void {
    this.emit({
      type: "paper_position_updated",
      generatedAt: timestamp,
      payload: position
    });
  }

  private emitPaperPositionClosed(position: PaperPositionPayload, timestamp = Date.now()): void {
    this.emit({
      type: "paper_position_closed",
      generatedAt: timestamp,
      payload: position
    });
  }

  private emitOrderError(payload: OrderErrorMessage["payload"]): void {
    this.emit({
      type: "order_error",
      generatedAt: Date.now(),
      payload
    });
  }

  private emit(message: OrderServerMessage): void {
    this.options.onMessage(message);
  }
}
