import type {
  OrderSide,
  OrderValidationCheck,
  SafeToAddReason,
  SafeToAddResult,
  SafeToAddStatus
} from "../types/messages";
import type { DoNotTradeResult } from "../do-not-trade/do-not-trade-engine";
import type { PositionSizingResult } from "../risk/position-sizing-engine";

export type OrderSafetySide = "BUY" | "SELL";
export type OrderSafetyStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "EXPIRED"
  | "REJECTED";

const TERMINAL_ORDER_STATUSES = new Set<OrderSafetyStatus>([
  "FILLED",
  "CANCELED",
  "EXPIRED",
  "REJECTED"
]);

export interface OrderSafetyDecision {
  passed: boolean;
  message: string;
}

export interface OrderRiskLimitConfig {
  enabled: boolean;
  value: number | null;
}

export interface OrderRiskSafetyInput {
  paperMode: boolean;
  reduceOnly: boolean;
  orderNotional: number | null;
  currentSymbolNotional: number;
  hasCurrentSymbolPosition: boolean;
  openPositionsCount: number;
  availableBalanceUsd: number | null;
  accountEquityUsd?: number | null;
  leverageBracket?: OrderLeverageBracketSnapshot | null;
  liveRiskLimits?: {
    maxOrderNotionalUsdt?: OrderRiskLimitConfig | undefined;
    maxPositionNotionalUsdt?: OrderRiskLimitConfig | undefined;
    maxOpenPositions?: OrderRiskLimitConfig | undefined;
    maxDailyLossUsdt?: OrderRiskLimitConfig | undefined;
    maxLeverage?: OrderRiskLimitConfig | undefined;
  } | undefined;
  dailyRealizedPnl?: {
    status: "AUTHORITATIVE" | "MISSING" | "STALE" | "ERROR";
    tradingDay: string | null;
    netRealizedPnl: number | null;
    grossRealizedPnl: number | null;
    totalCommission: number | null;
    lastEventTime: number | null;
  } | undefined;
}

export type OrderLeverageSourceStatus = "AUTHORITATIVE" | "MISSING" | "STALE" | "ERROR";

export interface OrderLeverageBracket {
  bracket: number;
  initialLeverage: number;
  notionalFloor: number;
  notionalCap: number;
  maintMarginRatio: number;
  cum: number;
}

export interface OrderLeverageBracketSnapshot {
  status: OrderLeverageSourceStatus;
  brackets: OrderLeverageBracket[];
  fetchedAt: number | null;
  error?: string | null;
}

export interface OrderRiskSafetyCheck extends OrderSafetyDecision {
  code:
    | "max_order_notional"
    | "max_position_notional"
    | "max_open_positions"
    | "max_daily_loss"
    | "max_leverage"
    | "margin_available";
  blocking: true;
  projectedLeverage?: number | null;
  exchangeMaxLeverage?: number | null;
  effectiveMaxLeverage?: number | null;
  leverageSource?: OrderLeverageSourceStatus;
  leverageAuthoritative?: boolean;
  leverageBracket?: OrderLeverageBracket | null;
}

export interface BuildSafeToAddInput {
  symbol: string;
  direction?: PositionSizingResult["direction"];
  side?: OrderSide | null;
  generatedAt: number;
  staleAfterMs?: number;
  sizing?: PositionSizingResult | null;
  doNotTrade?: DoNotTradeResult | null;
  checks?: OrderValidationCheck[];
  forceStatus?: SafeToAddStatus | null;
}

export const isTerminalOrderStatus = (status: OrderSafetyStatus): boolean =>
  TERMINAL_ORDER_STATUSES.has(status);

export const evaluateClientOrderIdSafety = (input: {
  existingOrder:
    | {
        intentId: string | null;
        status: OrderSafetyStatus;
        clientOrderId: string;
      }
    | null
    | undefined;
  intentId: string;
}): OrderSafetyDecision => {
  const existingOrder = input.existingOrder;
  const passed =
    !existingOrder ||
    existingOrder.intentId === input.intentId ||
    isTerminalOrderStatus(existingOrder.status);

  return {
    passed,
    message: passed
      ? "clientOrderId is available for this intent."
      : `clientOrderId already belongs to active order ${existingOrder.clientOrderId}.`
  };
};

export const evaluateReduceOnlyPositionSafety = (input: {
  reduceOnly: boolean;
  paperMode: boolean;
  accountPositionAvailable: boolean;
  side: OrderSafetySide;
  quantity: number;
  signedPositionQuantity: number;
}): OrderSafetyDecision & { blocking: boolean } => {
  if (!input.reduceOnly) {
    return {
      passed: true,
      blocking: false,
      message: "Order is not reduce-only."
    };
  }

  if (!input.paperMode && !input.accountPositionAvailable) {
    return {
      passed: false,
      blocking: true,
      message: "Live reduce-only orders require an active account position snapshot."
    };
  }

  const absPositionQuantity = Math.abs(input.signedPositionQuantity);
  const hasPosition = absPositionQuantity > 0;
  const closesExistingSide =
    input.side === "BUY" ? input.signedPositionQuantity < 0 : input.signedPositionQuantity > 0;
  const quantityWithinPosition =
    hasPosition && input.quantity <= absPositionQuantity + 1e-12;
  const passed = hasPosition && closesExistingSide && quantityWithinPosition;

  return {
    passed,
    blocking: true,
    message: !hasPosition
      ? input.paperMode
        ? "Reduce-only paper orders require an open paper position for this symbol."
        : "Reduce-only live orders require an open account position for this symbol."
      : !closesExistingSide
        ? input.side === "BUY"
          ? "BUY reduce-only is allowed only against a short position."
          : "SELL reduce-only is allowed only against a long position."
        : quantityWithinPosition
          ? "Reduce-only quantity is within the existing position size."
          : `Reduce-only quantity cannot exceed existing position size ${absPositionQuantity}.`
  };
};

const isPositiveLimitValue = (limit: OrderRiskLimitConfig | null | undefined): limit is {
  enabled: true;
  value: number;
} => limit?.enabled === true && typeof limit.value === "number" && Number.isFinite(limit.value) && limit.value > 0;

const hasPositiveNotional = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const pickLeverageBracket = (
  brackets: OrderLeverageBracket[],
  projectedNotional: number
): OrderLeverageBracket | null => {
  const sorted = [...brackets].sort((left, right) => left.notionalFloor - right.notionalFloor);

  return (
    sorted.find(
      (bracket) =>
        projectedNotional >= bracket.notionalFloor &&
        projectedNotional < bracket.notionalCap
    ) ??
    sorted.find(
      (bracket) =>
        projectedNotional >= bracket.notionalFloor &&
        projectedNotional <= bracket.notionalCap
    ) ??
    null
  );
};

const buildMaxLeverageCheck = (input: OrderRiskSafetyInput): OrderRiskSafetyCheck | null => {
  const maxLeverage = input.liveRiskLimits?.maxLeverage;

  if (!isPositiveLimitValue(maxLeverage)) {
    return null;
  }

  const projectedSymbolNotional = input.reduceOnly
    ? Math.max(input.currentSymbolNotional - (hasPositiveNotional(input.orderNotional) ? input.orderNotional : 0), 0)
    : input.currentSymbolNotional + (hasPositiveNotional(input.orderNotional) ? input.orderNotional : 0);
  const accountEquityUsd =
    typeof input.accountEquityUsd === "number" && Number.isFinite(input.accountEquityUsd)
      ? input.accountEquityUsd
      : null;
  const source = input.leverageBracket?.status ?? "MISSING";
  const baseCheck = {
    code: "max_leverage" as const,
    blocking: true as const,
    leverageSource: source,
    leverageAuthoritative: source === "AUTHORITATIVE"
  };

  if (source !== "AUTHORITATIVE") {
    return {
      ...baseCheck,
      passed: false,
      projectedLeverage: null,
      exchangeMaxLeverage: null,
      effectiveMaxLeverage: maxLeverage.value,
      leverageBracket: null,
      message:
        source === "STALE"
          ? "Leverage bracket data is stale; max leverage validation rejects conservatively."
          : source === "ERROR"
            ? "Leverage bracket lookup failed; max leverage validation rejects conservatively."
            : "Leverage bracket data is missing; max leverage validation rejects conservatively."
    };
  }

  if (!hasPositiveNotional(input.orderNotional) || !Number.isFinite(projectedSymbolNotional)) {
    return {
      ...baseCheck,
      passed: false,
      projectedLeverage: null,
      exchangeMaxLeverage: null,
      effectiveMaxLeverage: maxLeverage.value,
      leverageBracket: null,
      message: "Order notional is unavailable for max leverage validation."
    };
  }

  if (!accountEquityUsd || accountEquityUsd <= 0) {
    return {
      ...baseCheck,
      passed: false,
      projectedLeverage: null,
      exchangeMaxLeverage: null,
      effectiveMaxLeverage: maxLeverage.value,
      leverageBracket: null,
      message: "Account equity is unavailable for max leverage validation."
    };
  }

  const bracket = pickLeverageBracket(input.leverageBracket?.brackets ?? [], projectedSymbolNotional);

  if (!bracket) {
    return {
      ...baseCheck,
      passed: false,
      projectedLeverage: null,
      exchangeMaxLeverage: null,
      effectiveMaxLeverage: maxLeverage.value,
      leverageBracket: null,
      message: `No Binance leverage bracket matched projected notional ${projectedSymbolNotional.toFixed(4)}.`
    };
  }

  const exchangeMaxLeverage = bracket.initialLeverage;
  const effectiveMaxLeverage = Math.min(maxLeverage.value, exchangeMaxLeverage);
  const projectedLeverage = projectedSymbolNotional / accountEquityUsd;
  const passed = projectedLeverage <= effectiveMaxLeverage;

  return {
    ...baseCheck,
    passed,
    projectedLeverage,
    exchangeMaxLeverage,
    effectiveMaxLeverage,
    leverageBracket: { ...bracket },
    message: passed
      ? `Projected leverage ${projectedLeverage.toFixed(4)}x is within effective max leverage ${effectiveMaxLeverage}x.`
      : `Projected leverage ${projectedLeverage.toFixed(4)}x exceeds effective max leverage ${effectiveMaxLeverage}x.`
  };
};

const buildMaxDailyLossCheck = (input: OrderRiskSafetyInput): OrderRiskSafetyCheck | null => {
  const maxDailyLoss = input.liveRiskLimits?.maxDailyLossUsdt;

  if (!isPositiveLimitValue(maxDailyLoss) || input.reduceOnly) {
    return null;
  }

  const status = input.dailyRealizedPnl?.status ?? "MISSING";
  const netRealizedPnl = input.dailyRealizedPnl?.netRealizedPnl ?? null;
  const realizedLoss =
    typeof netRealizedPnl === "number" && Number.isFinite(netRealizedPnl) && netRealizedPnl < 0
      ? Math.abs(netRealizedPnl)
      : 0;

  if (status !== "AUTHORITATIVE") {
    return {
      code: "max_daily_loss",
      passed: false,
      blocking: true,
      message:
        status === "STALE"
          ? "Current-day realized PnL source is stale; max daily loss validation rejects conservatively."
          : status === "ERROR"
            ? "Current-day realized PnL source failed; max daily loss validation rejects conservatively."
            : "Current-day realized PnL source is missing; max daily loss validation rejects conservatively."
    };
  }

  return {
    code: "max_daily_loss",
    passed: realizedLoss < maxDailyLoss.value,
    blocking: true,
    message:
      realizedLoss < maxDailyLoss.value
        ? `Current-day realized loss ${realizedLoss.toFixed(4)} is within max daily loss ${maxDailyLoss.value}.`
        : `Current-day realized loss ${realizedLoss.toFixed(4)} has reached or exceeded max daily loss ${maxDailyLoss.value}.`
  };
};

export const evaluateOrderRiskSafety = (input: OrderRiskSafetyInput): OrderRiskSafetyCheck[] => {
  const checks: OrderRiskSafetyCheck[] = [];
  const orderNotional = input.orderNotional;
  const maxOrderNotional = input.liveRiskLimits?.maxOrderNotionalUsdt;
  const maxPositionNotional = input.liveRiskLimits?.maxPositionNotionalUsdt;
  const maxOpenPositions = input.liveRiskLimits?.maxOpenPositions;
  const maxDailyLossCheck = buildMaxDailyLossCheck(input);
  const maxLeverageCheck = buildMaxLeverageCheck(input);

  if (input.paperMode) {
    return checks;
  }

  if (isPositiveLimitValue(maxOrderNotional)) {
    checks.push({
      code: "max_order_notional",
      passed: hasPositiveNotional(orderNotional) && orderNotional <= maxOrderNotional.value,
      blocking: true,
      message:
        hasPositiveNotional(orderNotional) && orderNotional <= maxOrderNotional.value
          ? `Order notional ${orderNotional.toFixed(4)} is within max order notional ${maxOrderNotional.value}.`
          : hasPositiveNotional(orderNotional)
            ? `Order notional ${orderNotional.toFixed(4)} exceeds max order notional ${maxOrderNotional.value}.`
            : "Order notional is unavailable for max order notional validation."
    });
  }

  if (isPositiveLimitValue(maxPositionNotional) && !input.reduceOnly) {
    const projectedPositionNotional =
      input.currentSymbolNotional + (hasPositiveNotional(orderNotional) ? orderNotional : 0);

    checks.push({
      code: "max_position_notional",
      passed: hasPositiveNotional(orderNotional) && projectedPositionNotional <= maxPositionNotional.value,
      blocking: true,
      message:
        hasPositiveNotional(orderNotional) && projectedPositionNotional <= maxPositionNotional.value
          ? `Projected symbol notional ${projectedPositionNotional.toFixed(4)} is within max position notional ${maxPositionNotional.value}.`
          : hasPositiveNotional(orderNotional)
            ? `Projected symbol notional ${projectedPositionNotional.toFixed(4)} exceeds max position notional ${maxPositionNotional.value}.`
            : "Order notional is unavailable for max position notional validation."
    });
  }

  if (isPositiveLimitValue(maxOpenPositions) && !input.reduceOnly && !input.hasCurrentSymbolPosition) {
    checks.push({
      code: "max_open_positions",
      passed: input.openPositionsCount < maxOpenPositions.value,
      blocking: true,
      message:
        input.openPositionsCount < maxOpenPositions.value
          ? `Open positions count ${input.openPositionsCount} is within max open positions ${maxOpenPositions.value}.`
          : `Open positions count ${input.openPositionsCount} has reached max open positions ${maxOpenPositions.value}.`
    });
  }

  if (maxDailyLossCheck) {
    checks.push(maxDailyLossCheck);
  }

  if (maxLeverageCheck) {
    checks.push(maxLeverageCheck);
  }

  checks.push({
    code: "margin_available",
    passed:
      hasPositiveNotional(orderNotional) &&
      typeof input.availableBalanceUsd === "number" &&
      Number.isFinite(input.availableBalanceUsd) &&
      input.availableBalanceUsd >= orderNotional,
    blocking: true,
    message:
      typeof input.availableBalanceUsd !== "number" || !Number.isFinite(input.availableBalanceUsd)
        ? "Available balance is unavailable for margin validation."
        : !hasPositiveNotional(orderNotional)
          ? "Order notional is unavailable for margin validation."
          : input.availableBalanceUsd >= orderNotional
            ? `Available balance ${input.availableBalanceUsd.toFixed(4)} covers conservative required margin ${orderNotional.toFixed(4)}.`
            : `Available balance ${input.availableBalanceUsd.toFixed(4)} is below conservative required margin ${orderNotional.toFixed(4)}.`
  });

  return checks;
};

const DEFAULT_SAFE_TO_ADD_STALE_AFTER_MS = 15_000;

const hasNumberAtOrBelowZero = (value: number | null | undefined): boolean =>
  typeof value === "number" && Number.isFinite(value) && value <= 0;

const isLowLiquidationBuffer = (value: number | null | undefined): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 5 && value < 10;

const normalizeMessageList = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));

const normalizeReasonCode = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "reason";

const addSafeToAddReason = (
  reasons: SafeToAddReason[],
  seen: Set<string>,
  reason: SafeToAddReason
): void => {
  const label = reason.label.trim();
  if (!label) {
    return;
  }

  const normalized = { ...reason, label };
  const key = `${normalized.source}:${normalized.severity}:${normalized.label}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  reasons.push(normalized);
};

export const buildSafeToAddAccountBlockers = (input: {
  checks: OrderValidationCheck[];
  sizing: PositionSizingResult | null;
  doNotTrade: DoNotTradeResult | null;
  blockers: string[];
  warnings: string[];
  constraints: string[];
  reasons: string[];
}): SafeToAddReason[] => {
  const accountBlockers: SafeToAddReason[] = [];
  const seen = new Set<string>();

  for (const check of input.checks) {
    if (check.passed) {
      continue;
    }

    addSafeToAddReason(accountBlockers, seen, {
      source: "order_validation",
      code: check.code,
      label: check.message,
      severity: check.blocking ? "critical" : "warning"
    });
  }

  for (const blocker of input.doNotTrade?.blockers ?? []) {
    addSafeToAddReason(accountBlockers, seen, {
      source: "do_not_trade",
      code: input.doNotTrade?.action ?? "blocker",
      label: blocker,
      severity: "critical"
    });
  }

  for (const warning of input.doNotTrade?.warnings ?? []) {
    addSafeToAddReason(accountBlockers, seen, {
      source: "do_not_trade",
      code: input.doNotTrade?.action ?? "warning",
      label: warning,
      severity: "warning"
    });
  }

  for (const constraint of input.constraints) {
    addSafeToAddReason(accountBlockers, seen, {
      source: "position_sizing",
      code: normalizeReasonCode(constraint),
      label: constraint,
      severity: input.blockers.includes(constraint) ? "critical" : "warning"
    });
  }

  for (const warning of input.warnings) {
    addSafeToAddReason(accountBlockers, seen, {
      source: input.doNotTrade?.warnings.includes(warning) ? "do_not_trade" : "position_sizing",
      code: normalizeReasonCode(warning),
      label: warning,
      severity: "warning"
    });
  }

  for (const blocker of input.blockers) {
    addSafeToAddReason(accountBlockers, seen, {
      source:
        input.checks.some((check) => !check.passed && check.message === blocker)
          ? "order_validation"
          : input.doNotTrade?.blockers.includes(blocker)
            ? "do_not_trade"
            : "position_sizing",
      code: normalizeReasonCode(blocker),
      label: blocker,
      severity: "critical"
    });
  }

  for (const reason of input.reasons) {
    addSafeToAddReason(accountBlockers, seen, {
      source: input.doNotTrade?.reasons.includes(reason) ? "do_not_trade" : "position_sizing",
      code: normalizeReasonCode(reason),
      label: reason,
      severity: "info"
    });
  }

  return accountBlockers;
};

export const buildSafeToAddResult = (input: BuildSafeToAddInput): SafeToAddResult => {
  const sizing = input.sizing ?? null;
  const doNotTrade = input.doNotTrade ?? null;
  const checks = input.checks ?? [];
  const direction = input.direction ?? sizing?.direction ?? "unknown";
  const blockers = normalizeMessageList([
    ...checks
      .filter((check) => check.blocking && !check.passed)
      .map((check) => check.message),
    ...(doNotTrade && (!doNotTrade.allowed || doNotTrade.action === "BLOCK")
      ? doNotTrade.blockers.length > 0
        ? doNotTrade.blockers
        : doNotTrade.reasons
      : []),
    sizing?.riskLevel === "EXTREME" ? "EXTREME risk level blocks adding size." : null,
    // A zero sizing result is the sizing engine's conservative "not tradable" output.
    sizing && hasNumberAtOrBelowZero(sizing.recommendedNotional)
      ? "Recommended notional is zero; sizing engine constrained this setup as not tradable."
      : null,
    sizing && hasNumberAtOrBelowZero(sizing.normalizedQty)
      ? "Normalized quantity is zero; sizing engine constrained this setup as not tradable."
      : null,
    typeof sizing?.liquidationBufferPct === "number" && sizing.liquidationBufferPct < 5
      ? "Critical liquidation safety buffer below 5%."
      : null
  ]);
  const warnings = normalizeMessageList([
    ...(sizing?.warnings ?? []),
    ...(sizing?.exchangeFilterWarnings ?? []),
    ...(doNotTrade?.warnings ?? []),
    ...(doNotTrade?.action === "WAIT" || doNotTrade?.action === "REDUCE_SIZE"
      ? doNotTrade.reasons
      : []),
    sizing?.riskLevel === "HIGH" ? "HIGH risk level requires review before adding size." : null,
    direction === "unknown" ? "Direction is unknown." : null,
    isLowLiquidationBuffer(sizing?.liquidationBufferPct)
      ? "Low liquidation safety buffer below 10%."
      : null
  ]);
  const constraints = normalizeMessageList(sizing?.constraints ?? []);
  const reasons = normalizeMessageList([
    ...(sizing?.reasons ?? []),
    ...(doNotTrade?.reasons ?? [])
  ]);
  const shouldWait =
    warnings.length > 0 ||
    constraints.length > 0 ||
    doNotTrade?.action === "WAIT" ||
    doNotTrade?.action === "REDUCE_SIZE" ||
    sizing?.riskLevel === "HIGH" ||
    direction === "unknown" ||
    isLowLiquidationBuffer(sizing?.liquidationBufferPct);
  const computedStatus: SafeToAddStatus =
    blockers.length > 0 ? "BLOCK" : shouldWait ? "WAIT" : "ALLOW";
  const status = input.forceStatus ?? computedStatus;
  const accountBlockers = buildSafeToAddAccountBlockers({
    checks,
    sizing,
    doNotTrade,
    blockers,
    warnings,
    constraints,
    reasons
  });

  return {
    symbol: input.symbol.trim().toUpperCase(),
    direction,
    side: input.side ?? null,
    status,
    allowed: status === "ALLOW",
    generatedAt: input.generatedAt,
    staleAfterMs: input.staleAfterMs ?? DEFAULT_SAFE_TO_ADD_STALE_AFTER_MS,
    ...(sizing
      ? {
          recommendedNotional: sizing.recommendedNotional,
          maxNotional: sizing.maxNotional,
          recommendedQty: sizing.recommendedQty,
          normalizedQty: sizing.normalizedQty,
          suggestedLeverage: sizing.suggestedLeverage,
          riskLevel: sizing.riskLevel,
          liquidationBufferPct: sizing.liquidationBufferPct
        }
      : {}),
    doNotTrade,
    checks,
    blockers,
    warnings,
    constraints,
    reasons,
    ...(accountBlockers.length > 0 ? { accountBlockers } : {}),
    source: {
      sizing: Boolean(sizing),
      orderSafety: checks.length > 0,
      doNotTrade: Boolean(doNotTrade)
    }
  };
};
