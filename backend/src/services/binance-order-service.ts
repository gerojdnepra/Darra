import { randomUUID } from "node:crypto";
import { safeNumber } from "../lib/math";
import { evaluateLiveReadiness } from "../safety/live-readiness";
import {
  evaluateClientOrderIdSafety,
  evaluateOrderRiskSafety,
  evaluateReduceOnlyPositionSafety,
  isTerminalOrderStatus
} from "../safety/order-safety";
import {
  orderRepository,
  type StoredOrderIntentResponse
} from "../storage/order-repository";
import { decisionReviewRepository } from "../storage/decision-review-repository";
import {
  PositionLifecycleRepository,
  type PositionLifecycleEventType
} from "../storage/position-lifecycle-repository";
import { tradeDecisionRepository } from "../storage/trade-decision-repository";
import type { OrderTradeUpdateEvent } from "../types/binance";
import type { RestFuturesOrder } from "../types/binance";
import type {
  OrderAckMessage,
  OrderAuditEventMessage,
  OrderErrorMessage,
  OrderIntentMessage,
  OrderLifecycleStatus,
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
  getCachedLeverageBrackets,
  getOpenOrders,
  getPositionRisk,
  placeFuturesOrder
} from "./binance-rest";
import type {
  AccountStreamHealth,
  BinanceAccountRiskSnapshot
} from "./binance-account-stream";

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
  | PositionLifecycleEventMessage;

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

interface BoundPreflightRecord {
  preflightId: string;
  preflightNonce: string;
  ticketKey: string;
  paperMode: boolean;
  generatedAt: number;
  expiresAt: number;
  safeToAddStatus: "ALLOW" | "WAIT" | "STALE" | "BLOCK";
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

const positionLifecycleRepository = new PositionLifecycleRepository();

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

export class BinanceOrderService {
  private readonly pendingTimers = new Map<string, NodeJS.Timeout[]>();
  private readonly boundPreflights = new Map<string, BoundPreflightRecord>();
  private readonly riskLimits: OrderRiskLimits;
  private liveTradingDisabledByRuntime = false;
  private activePaperProtectiveLegs = 0;
  private paperProtectiveTriggers = 0;
  private lastPaperProtectiveTriggerAt: number | null = null;

  constructor(
    private readonly restBase: string,
    private readonly options: BinanceOrderServiceOptions
  ) {
    this.riskLimits = mergeRiskLimits(options.riskLimits);
    this.recoverPendingPaperMarketOrders();
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

    const decisionContextError = this.linkExplicitDecisionContext(meta);
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

      await this.handleCancelIntent(normalizedCancelIntent);
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

    const normalizedIntent = this.normalizePlaceIntent(
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
        reduceOnly: payload.reduceOnly === true,
        paperMode
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

    if (!normalizedIntent) {
      return invalidValidation("order preflight requires symbol, side, type and positive quantity.");
    }

    return this.validatePlaceIntent(normalizedIntent, context);
  }

  bindPreflight(input: BoundPreflightRecord): void {
    this.boundPreflights.set(input.preflightId, input);
    this.gcBoundPreflights(Date.now());
  }

  private linkExplicitDecisionContext(
    meta: NormalizedIntentMeta
  ): { code: string; message: string; retriable: boolean } | null {
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

    orderRepository.upsertOrderState(acceptedOrder);

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

    return null;
  }

  private gcBoundPreflights(now: number): void {
    for (const [preflightId, record] of this.boundPreflights.entries()) {
      if (now >= record.expiresAt) {
        this.boundPreflights.delete(preflightId);
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
      parentOrderId: null,
      protectiveKind: null,
      dryRun: false,
      reduceOnly: intent.reduceOnly,
      rejectReason: null,
      lastEventSource: "paper_engine",
      createdAt: intent.createdAt,
      updatedAt: Date.now()
    });

    orderRepository.upsertOrderState(pendingOrder);
    this.emitAuditEvent(
      pendingOrder,
      "LIVE_TESTNET_ORDER_SEND",
      "Sending signed Binance Futures testnet order.",
      validation,
      pendingOrder.updatedAt
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
        "Binance Futures testnet order accepted by REST.",
        response,
        liveOrder.updatedAt
      );
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

  private async handleCancelIntent(intent: NormalizedCancelIntent): Promise<void> {
    const existingOrder =
      orderRepository.getOrderByClientOrderId(intent.targetClientOrderId) ??
      orderRepository.getOrderByOrderId(intent.targetClientOrderId);
    const validation = this.buildCancelValidation(intent.paperMode, Boolean(existingOrder));

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
      await this.handleLiveCancelIntent(intent, existingOrder, validation);
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
    existingOrder: OrderStatePayload,
    validation: OrderValidationPayload
  ): Promise<void> {
    const apiKey = this.options.apiKey;
    const apiSecret = this.options.apiSecret;

    if (!apiKey || !apiSecret) {
      this.persistIntentError(intent, {
        code: "LIVE_GATE_CHECK_FAILED",
        message: "LIVE_GATE_CHECK_FAILED: Binance API credentials are required for testnet live cancel.",
        retriable: false
      });
      return;
    }

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

    const currentSymbolPositions = context.account.positions.filter(
      (position) => position.symbol === intent.symbol && Math.abs(position.quantity) > 0
    );
    const currentSymbolNotional = currentSymbolPositions.reduce((sum, position) => {
      const markPrice = position.markPrice > 0 ? position.markPrice : marketPrice;
      return sum + (markPrice && markPrice > 0 ? Math.abs(position.quantity) * markPrice : 0);
    }, 0);
    const openPositionSymbols = new Set(
      context.account.positions
        .filter((position) => Math.abs(position.quantity) > 0)
        .map((position) => position.symbol)
    );
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
      ...evaluateOrderRiskSafety({
        paperMode,
        reduceOnly: intent.reduceOnly,
        orderNotional:
          typeof notionalResult.notional === "number" && Number.isFinite(notionalResult.notional)
            ? notionalResult.notional
            : null,
        currentSymbolNotional,
        hasCurrentSymbolPosition: currentSymbolPositions.length > 0,
        openPositionsCount: openPositionSymbols.size,
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

  private buildCancelValidation(
    paperMode: boolean,
    hasOrder: boolean
  ): OrderValidationPayload {
    const checks: OrderValidationCheck[] = [
      {
        code: "execution_mode",
        passed: paperMode || this.options.liveModeEnabled,
        blocking: true,
        message: paperMode
          ? "Paper mode is enabled."
          : this.options.liveModeEnabled
            ? "Live mode is enabled."
            : "Live mode is disabled for this infrastructure pass."
      },
      {
        code: "account_connection",
        passed: true,
        blocking: false,
        message: "Cancel intent uses existing server-side order state."
      },
      {
        code: "exchange_filters",
        passed: hasOrder,
        blocking: true,
        message: hasOrder
          ? "Target order exists in server-side state."
          : "Target order was not found in server-side order state."
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
    const message: PositionLifecycleEventMessage = {
      type: "position_lifecycle_event",
      generatedAt: input.timestamp,
      payload: {
        lifecycleId: input.lifecycleId,
        eventType: input.eventType,
        timestamp: input.timestamp,
        ...(input.payload === undefined ? {} : { payload: input.payload })
      }
    };

    this.emit(message);
  }

  private appendAndEmitPositionLifecycleEvent(input: {
    lifecycleId: string;
    eventType: PositionLifecycleEventType;
    timestamp: number;
    payload?: unknown;
  }): void {
    const event = positionLifecycleRepository.appendLifecycleEvent({
      lifecycleId: input.lifecycleId,
      eventType: input.eventType,
      timestamp: input.timestamp,
      payload: input.payload
    });

    this.emitPositionLifecycleEventMessage({
      lifecycleId: event.lifecycleId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      payload: event.payload
    });
  }

  private resolvePaperPositionLifecycle(position: PaperPositionPayload): PositionLifecycle | null {
    const entryOrder = orderRepository.getOrderByOrderId(position.entryOrderId);
    if (!entryOrder?.intentId) {
      return null;
    }

    return positionLifecycleRepository.getPositionLifecycleByOrderIntentId(entryOrder.intentId);
  }

  private createOrOpenPaperPositionLifecycle(input: {
    filledOrder: OrderStatePayload;
    position: PaperPositionPayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    if (!input.filledOrder.intentId) {
      return;
    }

    try {
      const existing = positionLifecycleRepository.getPositionLifecycleByOrderIntentId(
        input.filledOrder.intentId
      );
      if (existing) {
        return;
      }

      const lifecycle = positionLifecycleRepository.createPositionLifecycle({
        symbol: input.position.symbol,
        orderIntentId: input.filledOrder.intentId,
        decisionContextId: input.decisionContextId ?? null,
        unifiedSignalId: input.unifiedSignalId ?? null,
        status: "OPEN",
        openedAt: input.position.openedAt,
        createdAt: input.timestamp
      });
      const createdMessage: PositionLifecycleCreatedMessage = {
        type: "position_lifecycle_created",
        generatedAt: input.timestamp,
        payload: lifecycle
      };

      this.emit(createdMessage);
      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "CREATED",
        timestamp: input.timestamp,
        payload: {
          orderIntentId: input.filledOrder.intentId,
          decisionContextId: input.decisionContextId ?? null,
          unifiedSignalId: input.unifiedSignalId ?? null,
          paperPositionId: input.position.paperPositionId,
          entryOrderId: input.position.entryOrderId
        }
      });
      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_OPENED",
        timestamp: input.timestamp,
        payload: {
          paperPositionId: input.position.paperPositionId,
          entryOrderId: input.position.entryOrderId,
          side: input.position.side,
          quantity: input.position.quantity,
          entryPrice: input.position.entryPrice,
          stopLossOrderId: input.position.stopLossOrderId,
          takeProfitOrderId: input.position.takeProfitOrderId
        }
      });
    } catch (error) {
      console.warn("Paper position lifecycle open integration failed", error);
    }
  }

  private updatePaperPositionLifecycle(position: PaperPositionPayload, timestamp: number): void {
    try {
      const lifecycle = this.resolvePaperPositionLifecycle(position);
      if (!lifecycle) {
        return;
      }

      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_UPDATED",
        timestamp,
        payload: {
          paperPositionId: position.paperPositionId,
          entryOrderId: position.entryOrderId,
          unrealizedPnl: position.unrealizedPnl,
          quantity: position.quantity,
          updatedAt: timestamp
        }
      });

      const updated = positionLifecycleRepository.updatePositionLifecycle({
        id: lifecycle.id,
        status: lifecycle.status === "OPEN" ? "MANAGING" : lifecycle.status,
        updatedAt: timestamp
      });
      if (!updated) {
        return;
      }

      const message: PositionLifecycleUpdatedMessage = {
        type: "position_lifecycle_updated",
        generatedAt: timestamp,
        payload: updated
      };
      this.emit(message);
    } catch (error) {
      console.warn("Paper position lifecycle update integration failed", error);
    }
  }

  private closePaperPositionLifecycle(position: PaperPositionPayload, timestamp: number): void {
    try {
      const lifecycle = this.resolvePaperPositionLifecycle(position);
      if (!lifecycle) {
        return;
      }

      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_CLOSED",
        timestamp,
        payload: {
          paperPositionId: position.paperPositionId,
          entryOrderId: position.entryOrderId,
          closePrice: position.closePrice,
          closeReason: position.closeReason,
          closedAt: position.closedAt
        }
      });

      if (typeof position.realizedPnl === "number" && Number.isFinite(position.realizedPnl)) {
        this.appendAndEmitPositionLifecycleEvent({
          lifecycleId: lifecycle.id,
          eventType: "PNL_REALIZED",
          timestamp,
          payload: {
            paperPositionId: position.paperPositionId,
            realizedPnl: position.realizedPnl,
            closePrice: position.closePrice,
            closeReason: position.closeReason
          }
        });
      }

      const closed = positionLifecycleRepository.closePositionLifecycle({
        id: lifecycle.id,
        closedAt: position.closedAt ?? timestamp
      });
      if (!closed) {
        return;
      }

      const message: PositionLifecycleClosedMessage = {
        type: "position_lifecycle_closed",
        generatedAt: timestamp,
        payload: closed
      };
      this.emit(message);
      this.createDecisionReviewFromClosedLifecycle(closed, timestamp);
    } catch (error) {
      console.warn("Paper position lifecycle close integration failed", error);
    }
  }

  private createDecisionReviewFromClosedLifecycle(
    lifecycle: PositionLifecycle,
    timestamp: number
  ): void {
    try {
      decisionReviewRepository.createDecisionReviewFromLifecycle({
        lifecycle,
        createdAt: timestamp
      });
    } catch (error) {
      console.warn("DecisionReview creation from paper lifecycle failed", error);
    }
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
    const event = orderRepository.appendAuditEvent({
      order,
      eventType,
      message,
      payload,
      timestamp
    });

    this.emit({
      type: "order_audit_event",
      generatedAt: timestamp,
      payload: event
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
