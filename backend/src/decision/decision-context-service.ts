import { randomUUID } from "node:crypto";
import {
  computeDecisionQualityScore,
  normalizeDecision,
  resolveDecisionStrength
} from "./decision-normalizer";
import type { RiskSnapshotPayload } from "../risk/types";
import type { BinanceAccountRiskSnapshot } from "../services/binance-account-stream";
import {
  tradeDecisionRepository,
  type TradeDecisionSource
} from "../storage/trade-decision-repository";
import {
  unifiedSignalRepository,
  type UnifiedSignalRecord
} from "../storage/unified-signal-repository";
import type {
  DecisionContextResponse,
  DecisionContextSignalState,
  TradeDecisionAction,
  UnifiedSignalEvent
} from "../types/messages";

export interface BuildTradeDecisionContextInput {
  symbol: string;
  intent: TradeDecisionAction;
  notes?: string | null;
  preflightId?: string | null;
  source?: TradeDecisionSource | null;
  risk?: RiskSnapshotPayload | null;
  account?: BinanceAccountRiskSnapshot | null;
}

interface RiskContextAttachment {
  riskSnapshotRef: string;
  payload: Record<string, unknown>;
}

interface CanonicalSignalPayload {
  confidenceScore?: number;
  signalStabilityScore?: number;
  marketRegime?: string;
  signalVolatilityClass?: string;
}

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const toUnifiedSignalEvent = (record: UnifiedSignalRecord): UnifiedSignalEvent | null => {
  const payload =
    record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null;
  const title = typeof payload?.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : record.reason;
  const mergeKey = typeof payload?.mergeKey === "string" && payload.mergeKey.trim()
    ? payload.mergeKey.trim()
    : null;
  const rawRef =
    payload?.rawRef &&
    typeof payload.rawRef === "object" &&
    !Array.isArray(payload.rawRef)
      ? (payload.rawRef as { collection?: unknown; id?: unknown })
      : null;

  if (
    !record.sourceId ||
    !record.symbol ||
    !title ||
    !mergeKey ||
    !rawRef ||
    (rawRef.collection !== "alerts" &&
      rawRef.collection !== "volumeMilestones" &&
      rawRef.collection !== "volumeThresholdMilestones") ||
    typeof rawRef.id !== "string" ||
    !rawRef.id.trim()
  ) {
    return null;
  }

  return {
    id: record.id,
    source: record.source,
    sourceId: record.sourceId,
    symbol: record.symbol,
    kind: record.kind,
    ...(record.bias ? { bias: record.bias } : {}),
    ...(typeof payload?.direction === "string" ? { direction: payload.direction } : {}),
    title,
    ...(record.reason ? { description: record.reason } : {}),
    ...(record.severity ? { severity: record.severity } : {}),
    ...(typeof payload?.priority === "string" ? { priority: payload.priority } : {}),
    ...(record.rankScore !== null ? { rankScore: record.rankScore } : {}),
    ...(typeof payload?.suppress === "boolean" ? { suppress: payload.suppress } : {}),
    ...(typeof payload?.suppressReason === "string"
      ? { suppressReason: payload.suppressReason }
      : {}),
    ...(record.ttlSec !== null ? { ttlSec: record.ttlSec } : {}),
    ...(Array.isArray(payload?.tags)
      ? { tags: payload.tags.filter((tag): tag is string => typeof tag === "string") }
      : {}),
    ...(payload?.liveVisibility === "PRIMARY" ||
    payload?.liveVisibility === "REVIEW" ||
    payload?.liveVisibility === "HIDDEN"
      ? { liveVisibility: payload.liveVisibility }
      : {}),
    ...(record.noiseClass ? { noiseClass: record.noiseClass } : {}),
    createdAt: record.createdAt,
    ...(record.expiresAt !== null ? { expiresAt: record.expiresAt } : {}),
    mergeKey,
    rawRef: {
      collection: rawRef.collection,
      id: rawRef.id
    }
  };
};

export class DecisionContextService {
  buildTradeDecisionContext(input: BuildTradeDecisionContextInput): DecisionContextResponse {
    const symbol = normalizeSymbol(input.symbol);
    const notes = normalizeText(input.notes);
    const signal = this.fetchUnifiedSignal(symbol);
    const riskContext = this.attachRiskContext(symbol, input.risk, input.account);
    const signalPayload =
      signal?.payload && typeof signal.payload === "object" && !Array.isArray(signal.payload)
        ? (signal.payload as CanonicalSignalPayload)
        : null;
    const signalConfidence = typeof signalPayload?.confidenceScore === "number"
      ? signalPayload.confidenceScore
      : null;
    const signalStability = typeof signalPayload?.signalStabilityScore === "number"
      ? signalPayload.signalStabilityScore
      : null;
    const marketRegime = typeof signalPayload?.marketRegime === "string"
      ? signalPayload.marketRegime
      : null;
    const signalVolatilityClass = typeof signalPayload?.signalVolatilityClass === "string"
      ? signalPayload.signalVolatilityClass
      : null;
    const signalState: DecisionContextSignalState =
      signal === null ? "MISSING" : signal.expiresAt && signal.expiresAt <= Date.now() ? "STALE" : "OK";
    const signalIsFresh = signalState === "OK";
    const normalizedDecision =
      signal && signalIsFresh && typeof signalConfidence === "number" && typeof signalStability === "number"
        ? normalizeDecision(
            {
              confidenceScore: signalConfidence,
              signalStabilityScore: signalStability,
              marketRegime: marketRegime ?? "CHOP",
              signalVolatilityClass
            },
            { requestedDecision: input.intent }
          )
        : "WAIT";
    const decisionQualityScore =
      signal && signalIsFresh && typeof signalConfidence === "number" && typeof signalStability === "number"
        ? computeDecisionQualityScore({
            confidenceScore: signalConfidence,
            signalStabilityScore: signalStability,
            marketRegime: marketRegime ?? "CHOP",
            signalVolatilityClass
          })
        : null;
    const decisionStrength =
      typeof decisionQualityScore === "number"
        ? resolveDecisionStrength(decisionQualityScore)
        : null;
    const decisionId = this.assignDecisionId();
    const payload = {
      authority: "BACKEND_AUTHORITY_ONLY",
      userCommand: {
        requestedIntent: input.intent,
        notes,
        preflightId: normalizeText(input.preflightId)
      },
      signal: signal ? toUnifiedSignalEvent(signal) ?? signal : null,
      risk: riskContext.payload,
      decisionQuality: {
        requestedDecision: input.intent,
        normalizedDecision,
        signalConfidence,
        signalStability,
        marketRegime,
        decisionStrength,
        decisionQualityScore
      }
    };

    const context = tradeDecisionRepository.createTradeDecisionContext({
      id: decisionId,
      unifiedSignalId: signal?.id ?? null,
      symbol,
      decision: normalizedDecision,
      decisionReason: notes ?? `${normalizedDecision} generated by backend decision authority.`,
      riskSnapshotRef: riskContext.riskSnapshotRef,
      preflightId: input.preflightId,
      preflightNonce: null,
      orderIntentId: null,
      reviewCorrelationId: null,
      source: input.source ?? "manual",
      status: "committed",
      payload
    });

    console.log("DECISION_AUTHORITY_BACKEND", {
      decisionId: context.id,
      symbol: context.symbol,
      requestedIntent: input.intent,
      decision: context.decision,
      unifiedSignalId: context.unifiedSignalId,
      riskSnapshotRef: context.riskSnapshotRef
    });
    console.log("DECISION_CHAIN_ENFORCED", {
      signalId: signal?.id ?? null,
      decisionId: context.id,
      source: "BACKEND_AUTHORITY_ONLY"
    });

    const response: DecisionContextResponse = {
      status: normalizedDecision === "WAIT" && input.intent !== "WAIT" && signalState !== "OK"
        ? "FORCED_WAIT"
        : "ACCEPTED",
      decisionContext: context,
      ...(signalState === "MISSING"
        ? { reason: "UNIFIED_SIGNAL_MISSING" }
        : signalState === "STALE"
          ? { reason: "UNIFIED_SIGNAL_STALE" }
          : {}),
      signalState,
      validationErrors: []
    };

    console.log("DECISION_PROTOCOL_RESPONSE", response);
    return response;
  }

  fetchUnifiedSignal(symbol: string): UnifiedSignalRecord | null {
    return unifiedSignalRepository.listUnifiedSignalsForSymbol(symbol, 1)[0] ?? null;
  }

  attachRiskContext(
    symbol: string,
    risk: RiskSnapshotPayload | null | undefined,
    account: BinanceAccountRiskSnapshot | null | undefined
  ): RiskContextAttachment {
    const generatedAt = Date.now();
    const normalizedSymbol = normalizeSymbol(symbol);
    const riskPosition =
      risk?.state.positions.find((position) => position.symbol === normalizedSymbol) ?? null;
    const topRiskSymbol =
      risk?.state.topRiskSymbols.find((item) => item.symbol === normalizedSymbol) ?? null;
    const accountPosition =
      account?.positions.find((position) => position.symbol === normalizedSymbol) ?? null;

    return {
      riskSnapshotRef: `risk:${normalizedSymbol}:${risk?.version ?? "none"}:${generatedAt}`,
      payload: {
        generatedAt,
        riskVersion: risk?.version ?? null,
        symbol: riskPosition || topRiskSymbol
          ? {
              riskScore: riskPosition?.riskScore ?? topRiskSymbol?.riskScore ?? null,
              riskLevel: riskPosition?.portfolioRiskLevel ?? topRiskSymbol?.riskLevel ?? null,
              liquidationDistancePct: riskPosition?.distancePct ?? null,
              liquidationRiskLevel: riskPosition?.riskLevel ?? null,
              notionalUsd: riskPosition?.notionalUsd ?? null,
              unrealizedPnlUsd: riskPosition?.unrealizedPnlUsd ?? null
            }
          : null,
        account: account
          ? {
              enabled: account.enabled,
              connected: account.connected,
              lastSyncAt: account.lastSyncAt,
              position: accountPosition
            }
          : null
      }
    };
  }

  assignDecisionId(): string {
    return `decision-${randomUUID()}`;
  }
}

export const decisionContextService = new DecisionContextService();
