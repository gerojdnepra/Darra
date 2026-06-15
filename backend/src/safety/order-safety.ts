import type {
  OrderSide,
  OrderValidationCheck,
  SafeToAddReason,
  SafeToAddResult,
  SafeToAddStatus
} from "../types/messages";
import type { DoNotTradeResult } from "../do-not-trade/do-not-trade-engine";
import type { PositionSizingResult } from "../risk/position-sizing-engine";
import {
  buildRiskAuthoritySafeToAddAccountBlockers,
  buildRiskAuthoritySafeToAddResult,
  evaluateRiskAuthorityOrder,
  type OrderLeverageBracket,
  type OrderLeverageBracketSnapshot,
  type OrderLeverageSourceStatus,
  type RiskAuthorityOrderCheck,
  type RiskAuthorityOrderInput,
  type RiskLimitConfig
} from "../risk/risk-authority";

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

export type OrderRiskLimitConfig = RiskLimitConfig;
export type OrderRiskSafetyInput = RiskAuthorityOrderInput;
export type {
  OrderLeverageBracket,
  OrderLeverageBracketSnapshot,
  OrderLeverageSourceStatus
};
export type OrderRiskSafetyCheck = RiskAuthorityOrderCheck;

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

/**
 * Deprecated compatibility facade. Risk decisions are owned by risk-authority.ts.
 */
export const evaluateOrderRiskSafety = (
  input: OrderRiskSafetyInput
): OrderRiskSafetyCheck[] => evaluateRiskAuthorityOrder(input);

/**
 * Deprecated compatibility facade. Safe-To-Add status is owned by risk-authority.ts.
 */
export const buildSafeToAddAccountBlockers = (input: {
  checks: OrderValidationCheck[];
  sizing: PositionSizingResult | null;
  doNotTrade: DoNotTradeResult | null;
  blockers: string[];
  warnings: string[];
  constraints: string[];
  reasons: string[];
}): SafeToAddReason[] => buildRiskAuthoritySafeToAddAccountBlockers(input);

/**
 * Deprecated compatibility facade. Safe-To-Add status is owned by risk-authority.ts.
 */
export const buildSafeToAddResult = (input: BuildSafeToAddInput): SafeToAddResult =>
  buildRiskAuthoritySafeToAddResult(input);
