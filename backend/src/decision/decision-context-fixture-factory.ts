import { randomUUID } from "node:crypto";
import type { TradeDecisionContext } from "../types/messages";
import {
  tradeDecisionRepository,
  type TradeDecisionSource,
  type TradeDecisionStatus
} from "../storage/trade-decision-repository";

export interface CreateDecisionContextFixtureInput {
  id?: string;
  unifiedSignalId?: string | null;
  symbol: string;
  decision?: TradeDecisionContext["decision"];
  decisionReason?: string | null;
  riskSnapshotRef?: string | null;
  preflightId?: string | null;
  preflightNonce?: string | null;
  orderIntentId?: string | null;
  reviewCorrelationId?: string | null;
  source?: TradeDecisionSource;
  status?: TradeDecisionStatus;
  createdAt?: number;
  updatedAt?: number | null;
  payload?: unknown;
}

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

// Check-only helper for deterministic fixtures. Runtime WS handlers must use DecisionContextService.
export class DecisionContextFixtureFactory {
  createFinalContext(input: CreateDecisionContextFixtureInput): TradeDecisionContext {
    const id = normalizeText(input.id) ?? `fixture-decision-${randomUUID()}`;

    return tradeDecisionRepository.createTradeDecisionContext({
      id,
      unifiedSignalId: normalizeText(input.unifiedSignalId),
      symbol: input.symbol,
      decision: input.decision ?? "ENTER",
      decisionReason:
        normalizeText(input.decisionReason) ?? "Fixture decision context created for check-only flow.",
      riskSnapshotRef: normalizeText(input.riskSnapshotRef),
      preflightId: normalizeText(input.preflightId),
      preflightNonce: normalizeText(input.preflightNonce),
      orderIntentId: normalizeText(input.orderIntentId),
      reviewCorrelationId: normalizeText(input.reviewCorrelationId),
      source: input.source ?? "system",
      status: input.status ?? "committed",
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      payload: input.payload
    });
  }
}

export const decisionContextFixtureFactory = new DecisionContextFixtureFactory();
