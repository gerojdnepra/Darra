import type { DoNotTradeResult } from "../do-not-trade/do-not-trade-engine";
import type { OpportunityScoreResult } from "../opportunity/opportunity-score-engine";
import type { PositionSizingResult } from "../risk/position-sizing-engine";
import type { SetupClassification } from "../setup-classifier/setup-classifier-engine";

export type AlertPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "IGNORE";

export interface AlertRankingResult {
  priority: AlertPriority;
  rankScore: number;
  reasons: string[];
  suppress: boolean;
  suppressReason: string | null;
  ttlSec: number;
  tags: string[];
}

export interface AlertRankingInput {
  symbol: string;
  type: string;
  severity?: string | null;
  source: string;
  score?: number | null;
  payload?: unknown;
  features?: unknown;
  setupClassification: SetupClassification;
  opportunityScore: OpportunityScoreResult;
  positionSizing: PositionSizingResult;
  doNotTrade: DoNotTradeResult;
}

interface ExtractedAlertRankingFeatures {
  volumeImpulse: number | null;
  confidenceScore: number | null;
  signalStabilityScore: number | null;
  signalVolatilityClass: string | null;
  marketRegime: string | null;
  cvdSlope: number | null;
  cvdDivergence: string | null;
  oiChange5m: number | null;
  oiChange15m: number | null;
  liquidation5m: number | null;
  liquidationBias: string | null;
  spreadBps: number | null;
  quoteVolume24h: number | null;
  tradeNotional60s: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readPath = (value: unknown, path: string[]): unknown => {
  let current = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
};

const readNumber = (value: unknown, paths: string[][]): number | null => {
  for (const path of paths) {
    const candidate = readPath(value, path);

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
};

const readString = (value: unknown, paths: string[][]): string | null => {
  for (const path of paths) {
    const candidate = readPath(value, path);

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

const normalizeConfidencePct = (value: number): number => (value <= 1 ? value * 100 : value);

const clampScore = (value: number): number =>
  Math.round(Math.min(Math.max(value, 0), 100) * 100) / 100;

const unique = (items: string[]): string[] =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const extractFeatures = (input: AlertRankingInput): ExtractedAlertRankingFeatures => ({
  volumeImpulse: readNumber(input.features, [["row", "volumeImpulse"]]),
  confidenceScore: readNumber(input.features, [["row", "confidenceScore"]]),
  signalStabilityScore: readNumber(input.features, [["row", "signalStabilityScore"]]),
  signalVolatilityClass: readString(input.features, [["row", "signalVolatilityClass"]]),
  marketRegime: readString(input.features, [["row", "marketRegime"]]),
  cvdSlope: readNumber(input.features, [["marketFlow", "cvd", "slope"]]),
  cvdDivergence: readString(input.features, [["marketFlow", "cvd", "divergence"]]),
  oiChange5m: readNumber(input.features, [["marketFlow", "openInterest", "oiChange5m"]]),
  oiChange15m: readNumber(input.features, [["marketFlow", "openInterest", "oiChange15m"]]),
  liquidation5m:
    readNumber(input.features, [["row", "liquidation5m"], ["liquidations", "liquidations5m"]]) ??
    readNumber(input.payload, [["notionalUsd"]]),
  liquidationBias: readString(input.features, [["row", "liquidationBias"]]),
  spreadBps: readNumber(input.features, [["row", "spreadBps"]]),
  quoteVolume24h: readNumber(input.features, [["row", "quoteVolume24h"]]),
  tradeNotional60s: readNumber(input.features, [["row", "tradeNotional60s"]])
});

const countConfirmations = (
  direction: string,
  features: ExtractedAlertRankingFeatures,
  opportunityScore: OpportunityScoreResult
): { count: number; tags: string[]; reasons: string[] } => {
  const tags = new Set(opportunityScore.tags);
  const reasons: string[] = [];

  if ((features.volumeImpulse ?? 0) >= 1.8 || tags.has("volume_confirmed")) {
    tags.add("volume_confirmed");
    reasons.push("volume confirmation present");
  }

  const cvdConfirms =
    direction === "long"
      ? (features.cvdSlope ?? 0) >= 0 || features.cvdDivergence === "bullish"
      : direction === "short"
        ? (features.cvdSlope ?? 0) <= 0 || features.cvdDivergence === "bearish"
        : false;
  if (cvdConfirms || tags.has("cvd_confirmed")) {
    tags.add("cvd_confirmed");
    reasons.push("CVD confirmation present");
  }

  if (Math.abs(features.oiChange5m ?? features.oiChange15m ?? 0) >= 0.8 || tags.has("oi_confirmed")) {
    tags.add("oi_confirmed");
    reasons.push("open interest confirmation present");
  }

  const liquidationConfirms =
    (features.liquidation5m ?? 0) >= 250_000 &&
    ((direction === "long" && features.liquidationBias === "SHORTS_HIT") ||
      (direction === "short" && features.liquidationBias === "LONGS_HIT"));
  if (liquidationConfirms || tags.has("liquidation_confirmed")) {
    tags.add("liquidation_confirmed");
    reasons.push("liquidation confirmation present");
  }

  const confirmationTags = Array.from(tags).filter((tag) =>
    ["volume_confirmed", "cvd_confirmed", "oi_confirmed", "liquidation_confirmed"].includes(tag)
  );

  return {
    count: confirmationTags.length,
    tags: confirmationTags,
    reasons
  };
};

export class AlertRankingEngine {
  rank(input: AlertRankingInput): AlertRankingResult {
    const features = extractFeatures(input);
    const setupConfidencePct = clampScore(
      features.confidenceScore ?? normalizeConfidencePct(input.setupClassification.confidence)
    );
    const confirmations = countConfirmations(
      input.setupClassification.direction,
      features,
      input.opportunityScore
    );
    const reasons: string[] = [];
    const tags = new Set<string>([
      ...input.setupClassification.tags,
      ...input.opportunityScore.tags,
      ...input.doNotTrade.tags,
      ...confirmations.tags
    ]);

    const stability = features.signalStabilityScore ?? 0.5;
    const spreadBad = (features.spreadBps ?? 0) > 12;
    const unstableHighVolatility =
      features.signalVolatilityClass === "HIGH" && stability < 0.5;
    const choppyWeakSignal =
      features.marketRegime === "CHOP" && setupConfidencePct < 58;
    const liquidityBad =
      (features.quoteVolume24h !== null && features.quoteVolume24h > 0 && features.quoteVolume24h < 25_000_000) ||
      (features.tradeNotional60s !== null && features.tradeNotional60s < 25_000);
    const unknownLowConfidence =
      input.setupClassification.setupType === "UNKNOWN" && setupConfidencePct < 35;
    const noisySignal =
      input.severity === "info" &&
      input.opportunityScore.score < 45 &&
      confirmations.count === 0;
    const blocked =
      input.doNotTrade.action === "BLOCK" ||
      input.doNotTrade.severity === "BLOCKED" ||
      input.doNotTrade.severity === "EMERGENCY";

    if (blocked) {
      reasons.push("Do Not Trade blocks this signal");
      tags.add("dnt_block");
    }

    if (input.opportunityScore.verdict === "DO_NOT_TRADE") {
      reasons.push("opportunity verdict is DO_NOT_TRADE");
      tags.add("opportunity_do_not_trade");
    }

    if (unknownLowConfidence) {
      reasons.push("setup is UNKNOWN with low confidence");
      tags.add("unknown_low_confidence");
    }

    if (noisySignal) {
      reasons.push("weak low-confirmation signal treated as noisy");
      tags.add("noisy_signal");
    }

    if (spreadBad) {
      reasons.push("spread/liquidity quality is bad");
      tags.add("spread_bad");
    }

    if (unstableHighVolatility) {
      reasons.push("signal stability is weak in high volatility");
      tags.add("unstable_high_volatility");
    }

    if (choppyWeakSignal) {
      reasons.push("signal confidence is weak for CHOP regime");
      tags.add("chop_low_confidence");
    }

    if (liquidityBad) {
      reasons.push("liquidity is too weak for priority alerting");
      tags.add("liquidity_bad");
    }

    if (
      blocked ||
      input.opportunityScore.verdict === "DO_NOT_TRADE" ||
      unknownLowConfidence ||
      noisySignal ||
      spreadBad ||
      liquidityBad ||
      unstableHighVolatility ||
      choppyWeakSignal
    ) {
      const suppressReason = reasons[0] ?? "ignored by alert ranking rules";

      return {
        priority: "IGNORE",
        rankScore: clampScore(Math.min(input.opportunityScore.score, 20)),
        reasons: unique(reasons),
        suppress: true,
        suppressReason,
        ttlSec: Math.max(input.doNotTrade.cooldownSec, 60),
        tags: unique(Array.from(tags))
      };
    }

    const critical =
      input.opportunityScore.verdict === "TRADE" &&
      input.doNotTrade.allowed === true &&
      input.opportunityScore.score >= 80 &&
      setupConfidencePct >= 75 &&
      stability >= 0.62 &&
      input.positionSizing.recommendedNotional > 0 &&
      confirmations.count >= 2;

    if (critical) {
      reasons.push("TRADE verdict with strong score, confidence, sizing, and confirmations");

      return {
        priority: "CRITICAL",
        rankScore: clampScore(
          input.opportunityScore.score + confirmations.count * 3 + Math.min(input.positionSizing.recommendedNotional / 10_000, 6)
        ),
        reasons: unique([...reasons, ...confirmations.reasons]),
        suppress: false,
        suppressReason: null,
        ttlSec: input.opportunityScore.ttlSec,
        tags: unique([...Array.from(tags), "critical_alert"])
      };
    }

    const high =
      (input.opportunityScore.verdict === "TRADE" || input.opportunityScore.verdict === "WAIT") &&
      input.doNotTrade.allowed === true &&
      input.doNotTrade.action !== "BLOCK" &&
      input.opportunityScore.score >= 65 &&
      setupConfidencePct >= 60 &&
      stability >= 0.5;

    if (high) {
      reasons.push("strong actionable signal without DNT block");

      return {
        priority: "HIGH",
        rankScore: clampScore(input.opportunityScore.score + confirmations.count * 2),
        reasons: unique([...reasons, ...confirmations.reasons]),
        suppress: false,
        suppressReason: null,
        ttlSec: input.opportunityScore.ttlSec,
        tags: unique([...Array.from(tags), "high_alert"])
      };
    }

    const interestingIncomplete =
      input.opportunityScore.score >= 45 ||
      setupConfidencePct >= 45 ||
      confirmations.count === 1 ||
      input.doNotTrade.action === "WAIT" ||
      input.doNotTrade.action === "REDUCE_SIZE";

    if (interestingIncomplete) {
      reasons.push("interesting but incomplete confirmation");

      return {
        priority: "MEDIUM",
        rankScore: clampScore(Math.max(input.opportunityScore.score, 45) + confirmations.count * 2),
        reasons: unique([...reasons, ...confirmations.reasons]),
        suppress: false,
        suppressReason: null,
        ttlSec: Math.min(input.opportunityScore.ttlSec, 300),
        tags: unique([...Array.from(tags), "incomplete_confirmation"])
      };
    }

    reasons.push("weak signal kept for education/history only");

    return {
      priority: "LOW",
      rankScore: clampScore(Math.min(input.opportunityScore.score, 44)),
      reasons: unique(reasons),
      suppress: false,
      suppressReason: null,
      ttlSec: 120,
      tags: unique([...Array.from(tags), "history_only"])
    };
  }
}

export const alertRankingEngine = new AlertRankingEngine();
