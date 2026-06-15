import { clamp, round } from "../lib/math";
import type { MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type {
  OrderSide,
  OrderValidationCheck,
  SafeToAddReason,
  SafeToAddResult,
  SafeToAddStatus
} from "../types/messages";
import type { DoNotTradeResult } from "../do-not-trade/do-not-trade-engine";
import type { PositionSizingDirection, PositionSizingResult } from "./position-sizing-engine";
import type { RiskPositionState, RiskState } from "./types";
import type {
  PositionRiskKillSwitchState,
  PositionRiskStressLevel
} from "../position-risk-orchestrator/types";
import type { BinanceAccountRiskSnapshot } from "../services/binance-account-stream";

export interface RiskLimitConfig {
  enabled: boolean;
  value: number | null;
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

export interface RiskAuthorityOrderInput {
  paperMode: boolean;
  reduceOnly: boolean;
  symbol?: string | null;
  orderNotional: number | null;
  account?: BinanceAccountRiskSnapshot | null;
  marketPrice?: number | null;
  currentSymbolNotional?: number;
  hasCurrentSymbolPosition?: boolean;
  openPositionsCount?: number;
  availableBalanceUsd: number | null;
  accountEquityUsd?: number | null;
  leverageBracket?: OrderLeverageBracketSnapshot | null;
  liveRiskLimits?: {
    maxOrderNotionalUsdt?: RiskLimitConfig | undefined;
    maxPositionNotionalUsdt?: RiskLimitConfig | undefined;
    maxOpenPositions?: RiskLimitConfig | undefined;
    maxDailyLossUsdt?: RiskLimitConfig | undefined;
    maxLeverage?: RiskLimitConfig | undefined;
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

export interface RiskAuthorityOrderCheck extends OrderValidationCheck {
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

export interface RiskAuthorityAccountInput {
  generatedAt: number;
  risk: RiskState;
  walletBalanceUsd?: number | null;
  availableBalanceUsd?: number | null;
  marginBalanceUsd?: number | null;
  totalInitialMarginUsd?: number | null;
  totalMaintMarginUsd?: number | null;
  totalUnrealizedPnlUsd?: number | null;
  tradePermission: MetaRegimeGovernorState["tradePermission"];
  marketMode: MetaRegimeGovernorState["marketMode"];
  systemDampener: number;
  overlayMultiplier: number;
}

export interface RiskAuthorityAccountDecision {
  accountRiskLoad: number;
  riskBudgetLeft: number;
  maxExposure: {
    currentGrossExposureUsd: number;
    remainingBudgetPct: number;
    globalRiskMultiplier: number;
  };
  liquidationSafety: {
    liquidationStressScore: number;
    liquidationStressLevel: PositionRiskStressLevel;
    minDistancePct: number | null;
    avgDistancePct: number | null;
    criticalPositions: number;
    warningPositions: number;
  };
  marginSafety: {
    marginUsagePct: number;
    maintenanceMarginRatio: number;
    availableBalancePct: number;
    marginStressScore: number;
    marginStressLevel: PositionRiskStressLevel;
  };
  killSwitch: PositionRiskKillSwitchState;
  canAddPosition: boolean;
}

const DEFAULT_SAFE_TO_ADD_STALE_AFTER_MS = 15_000;

const toPct = (value: number | null | undefined, total: number | null | undefined): number => {
  if (
    value === null ||
    value === undefined ||
    total === null ||
    total === undefined ||
    !Number.isFinite(value) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return 0;
  }

  return round((value / total) * 100, 2);
};

const average = (values: Array<number | null | undefined>): number | null => {
  const numericValues = values.filter((value): value is number => typeof value === "number");
  if (numericValues.length === 0) {
    return null;
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
};

const resolveStressLevel = (score: number): PositionRiskStressLevel => {
  if (score >= 85) {
    return "EXTREME";
  }
  if (score >= 65) {
    return "HIGH";
  }
  if (score >= 35) {
    return "MEDIUM";
  }
  return "LOW";
};

const resolveLiquidationScore = (position: RiskPositionState): number => {
  const distancePct = position.distancePct;
  const riskLevelPenalty =
    position.riskLevel === "critical" ? 100 : position.riskLevel === "warning" ? 65 : 20;

  if (distancePct === null || !Number.isFinite(distancePct)) {
    return riskLevelPenalty;
  }

  const distancePenalty =
    distancePct <= 1.5
      ? 100
      : distancePct <= 3
        ? 88
        : distancePct <= 5
          ? 72
          : distancePct <= 8
            ? 50
            : distancePct <= 12
              ? 30
              : 12;

  return round(clamp(distancePenalty * 0.7 + riskLevelPenalty * 0.3, 0, 100), 2);
};

const resolveKillSwitchState = (input: {
  accountRiskLoad: number;
  criticalPositions: number;
  warningPositions: number;
  marginStressLevel: PositionRiskStressLevel;
  liquidationStressLevel: PositionRiskStressLevel;
  tradePermission: MetaRegimeGovernorState["tradePermission"];
  marketMode: MetaRegimeGovernorState["marketMode"];
}): PositionRiskKillSwitchState => {
  if (
    input.tradePermission === "BLOCKED" ||
    input.marketMode === "EXTREME_UNCERTAINTY" ||
    input.accountRiskLoad >= 92 ||
    input.criticalPositions >= 2
  ) {
    return "EMERGENCY";
  }

  if (
    input.accountRiskLoad >= 82 ||
    input.marginStressLevel === "EXTREME" ||
    input.liquidationStressLevel === "EXTREME"
  ) {
    return "REDUCE_RISK";
  }

  if (
    input.accountRiskLoad >= 68 ||
    input.tradePermission === "REDUCED" ||
    input.criticalPositions >= 1
  ) {
    return "STOP_ADDING";
  }

  if (
    input.accountRiskLoad >= 45 ||
    input.warningPositions >= 2 ||
    input.marginStressLevel === "HIGH" ||
    input.liquidationStressLevel === "HIGH"
  ) {
    return "CAUTION";
  }

  return "NORMAL";
};

const resolveGlobalRiskMultiplier = (
  killSwitchState: PositionRiskKillSwitchState,
  overlayMultiplier: number,
  riskBudgetLeft: number
): number => {
  const killSwitchMultiplier =
    killSwitchState === "EMERGENCY"
      ? 0
      : killSwitchState === "REDUCE_RISK"
        ? 0.2
        : killSwitchState === "STOP_ADDING"
          ? 0
          : killSwitchState === "CAUTION"
            ? 0.5
            : 1;

  const budgetMultiplier = clamp(riskBudgetLeft / 100, 0, 1);
  return round(clamp(killSwitchMultiplier * clamp(overlayMultiplier, 0, 1) * budgetMultiplier, 0, 1), 4);
};

const isPositiveLimitValue = (limit: RiskLimitConfig | null | undefined): limit is {
  enabled: true;
  value: number;
} => limit?.enabled === true && typeof limit.value === "number" && Number.isFinite(limit.value) && limit.value > 0;

const hasPositiveNotional = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const normalizeSymbol = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
};

const resolveOrderExposureSnapshot = (input: RiskAuthorityOrderInput): {
  currentSymbolNotional: number;
  hasCurrentSymbolPosition: boolean;
  openPositionsCount: number;
} => {
  const symbol = normalizeSymbol(input.symbol);
  if (!input.account || !symbol) {
    return {
      currentSymbolNotional: input.currentSymbolNotional ?? 0,
      hasCurrentSymbolPosition: input.hasCurrentSymbolPosition ?? false,
      openPositionsCount: input.openPositionsCount ?? 0
    };
  }

  const currentSymbolPositions = input.account.positions.filter(
    (position) => position.symbol === symbol && Math.abs(position.quantity) > 0
  );
  const currentSymbolNotional = currentSymbolPositions.reduce((sum, position) => {
    const markPrice = position.markPrice > 0 ? position.markPrice : input.marketPrice;
    return sum + (markPrice && markPrice > 0 ? Math.abs(position.quantity) * markPrice : 0);
  }, 0);
  const openPositionSymbols = new Set(
    input.account.positions
      .filter((position) => Math.abs(position.quantity) > 0)
      .map((position) => position.symbol)
  );

  return {
    currentSymbolNotional,
    hasCurrentSymbolPosition: currentSymbolPositions.length > 0,
    openPositionsCount: openPositionSymbols.size
  };
};

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

const buildMaxLeverageCheck = (input: RiskAuthorityOrderInput): RiskAuthorityOrderCheck | null => {
  const maxLeverage = input.liveRiskLimits?.maxLeverage;

  if (!isPositiveLimitValue(maxLeverage)) {
    return null;
  }

  const exposure = resolveOrderExposureSnapshot(input);
  const projectedSymbolNotional = input.reduceOnly
    ? Math.max(exposure.currentSymbolNotional - (hasPositiveNotional(input.orderNotional) ? input.orderNotional : 0), 0)
    : exposure.currentSymbolNotional + (hasPositiveNotional(input.orderNotional) ? input.orderNotional : 0);
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

const buildMaxDailyLossCheck = (input: RiskAuthorityOrderInput): RiskAuthorityOrderCheck | null => {
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

export const evaluateRiskAuthorityOrder = (
  input: RiskAuthorityOrderInput
): RiskAuthorityOrderCheck[] => {
  const checks: RiskAuthorityOrderCheck[] = [];
  const orderNotional = input.orderNotional;
  const maxOrderNotional = input.liveRiskLimits?.maxOrderNotionalUsdt;
  const maxPositionNotional = input.liveRiskLimits?.maxPositionNotionalUsdt;
  const maxOpenPositions = input.liveRiskLimits?.maxOpenPositions;
  const maxDailyLossCheck = buildMaxDailyLossCheck(input);
  const maxLeverageCheck = buildMaxLeverageCheck(input);
  const exposure = resolveOrderExposureSnapshot(input);

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
      exposure.currentSymbolNotional + (hasPositiveNotional(orderNotional) ? orderNotional : 0);

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

  if (isPositiveLimitValue(maxOpenPositions) && !input.reduceOnly && !exposure.hasCurrentSymbolPosition) {
    checks.push({
      code: "max_open_positions",
      passed: exposure.openPositionsCount < maxOpenPositions.value,
      blocking: true,
      message:
        exposure.openPositionsCount < maxOpenPositions.value
          ? `Open positions count ${exposure.openPositionsCount} is within max open positions ${maxOpenPositions.value}.`
          : `Open positions count ${exposure.openPositionsCount} has reached max open positions ${maxOpenPositions.value}.`
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

export const buildRiskAuthoritySafeToAddAccountBlockers = (input: {
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

export const buildRiskAuthoritySafeToAddResult = (input: BuildSafeToAddInput): SafeToAddResult => {
  const sizing = input.sizing ?? null;
  const doNotTrade = input.doNotTrade ?? null;
  const checks = input.checks ?? [];
  const direction: PositionSizingDirection = input.direction ?? sizing?.direction ?? "unknown";
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
  const accountBlockers = buildRiskAuthoritySafeToAddAccountBlockers({
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

export const evaluateRiskAuthorityAccount = (
  input: RiskAuthorityAccountInput
): RiskAuthorityAccountDecision => {
  const walletBalanceUsd =
    input.walletBalanceUsd ?? input.risk.summary.walletBalanceUsd.value ?? 0;
  const availableBalanceUsd =
    input.availableBalanceUsd ?? input.risk.summary.availableBalanceUsd.value ?? 0;
  const marginBalanceUsd =
    input.marginBalanceUsd ?? input.risk.summary.marginBalanceUsd.value ?? 0;
  const totalInitialMarginUsd =
    input.totalInitialMarginUsd ??
    round(input.risk.positions.reduce((sum, position) => sum + position.initialMarginUsd, 0), 2);
  const totalMaintMarginUsd =
    input.totalMaintMarginUsd ??
    round(input.risk.positions.reduce((sum, position) => sum + position.maintMarginUsd, 0), 2);
  const totalUnrealizedPnlUsd =
    input.totalUnrealizedPnlUsd ?? input.risk.summary.unrealizedPnlUsd.value ?? 0;

  const marginUsagePct = round(
    input.risk.summary.marginUsagePct.value ?? toPct(totalInitialMarginUsd, marginBalanceUsd),
    2
  );
  const maintenanceMarginRatio = round(toPct(totalMaintMarginUsd, marginBalanceUsd), 2);
  const availableBalancePct = round(toPct(availableBalanceUsd, marginBalanceUsd), 2);
  const marginUsageScore = clamp((marginUsagePct / 100) * 100, 0, 100);
  const maintenancePressureScore = clamp((maintenanceMarginRatio / 12) * 100, 0, 100);
  const availableBalanceDepletionScore = clamp(100 - availableBalancePct, 0, 100);
  const drawdownPressureScore =
    totalUnrealizedPnlUsd < 0
      ? clamp((Math.abs(totalUnrealizedPnlUsd) / Math.max(walletBalanceUsd || marginBalanceUsd || 1, 1)) * 100, 0, 100)
      : 0;
  const governorPenaltyScore = round(clamp(input.systemDampener * 100, 0, 100), 2);
  const minDistancePct =
    input.risk.positions.length > 0
      ? input.risk.positions.reduce<number | null>((closest, position) => {
          if (position.distancePct === null || !Number.isFinite(position.distancePct)) {
            return closest;
          }
          if (closest === null) {
            return position.distancePct;
          }
          return Math.min(closest, position.distancePct);
        }, null)
      : null;
  const avgDistancePct = average(input.risk.positions.map((position) => position.distancePct));
  const criticalPositions = input.risk.positions.filter((position) => position.riskLevel === "critical").length;
  const warningPositions = input.risk.positions.filter((position) => position.riskLevel === "warning").length;
  const positionLiquidationScores = input.risk.positions.map(resolveLiquidationScore);
  const averageLiquidationScore = average(positionLiquidationScores) ?? 0;
  const liquidationStressScore = round(
    clamp(averageLiquidationScore + criticalPositions * 12 + warningPositions * 4, 0, 100),
    2
  );
  const marginStressScore = round(
    clamp(
      marginUsageScore * 0.5 +
        maintenancePressureScore * 0.3 +
        availableBalanceDepletionScore * 0.2,
      0,
      100
    ),
    2
  );
  const accountRiskLoad = round(
    clamp(
      marginUsageScore * 0.25 +
        maintenancePressureScore * 0.2 +
        availableBalanceDepletionScore * 0.1 +
        liquidationStressScore * 0.2 +
        drawdownPressureScore * 0.1 +
        governorPenaltyScore * 0.15,
      0,
      100
    ),
    2
  );
  const riskBudgetLeft = round(clamp(100 - accountRiskLoad, 0, 100), 2);
  const marginStressLevel = resolveStressLevel(marginStressScore);
  const liquidationStressLevel = resolveStressLevel(liquidationStressScore);
  const killSwitch = resolveKillSwitchState({
    accountRiskLoad,
    criticalPositions,
    warningPositions,
    marginStressLevel,
    liquidationStressLevel,
    tradePermission: input.tradePermission,
    marketMode: input.marketMode
  });
  const globalRiskMultiplier = resolveGlobalRiskMultiplier(
    killSwitch,
    input.overlayMultiplier,
    riskBudgetLeft
  );

  return {
    accountRiskLoad,
    riskBudgetLeft,
    maxExposure: {
      currentGrossExposureUsd: input.risk.summary.grossExposureUsd.value ?? 0,
      remainingBudgetPct: riskBudgetLeft,
      globalRiskMultiplier
    },
    liquidationSafety: {
      liquidationStressScore,
      liquidationStressLevel,
      minDistancePct: minDistancePct !== null ? round(minDistancePct, 3) : null,
      avgDistancePct: avgDistancePct !== null ? round(avgDistancePct, 3) : null,
      criticalPositions,
      warningPositions
    },
    marginSafety: {
      marginUsagePct,
      maintenanceMarginRatio,
      availableBalancePct,
      marginStressScore,
      marginStressLevel
    },
    killSwitch,
    canAddPosition: killSwitch === "NORMAL" || killSwitch === "CAUTION"
  };
};
