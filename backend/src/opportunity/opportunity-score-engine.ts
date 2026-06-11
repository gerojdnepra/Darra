import type {
  SetupClassification,
  SetupDirection
} from "../setup-classifier/setup-classifier-engine";

export type OpportunityVerdict = "TRADE" | "WAIT" | "DO_NOT_TRADE";
export type OpportunityRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export interface OpportunityScoreResult {
  verdict: OpportunityVerdict;
  score: number;
  confidence: number;
  direction: SetupDirection;
  setupType: string;
  reasons: string[];
  warnings: string[];
  invalidationHints: string[];
  ttlSec: number;
  expectedMovePct: number | null;
  riskLevel: OpportunityRiskLevel;
  tags: string[];
}

export interface OpportunityScoreInput {
  symbol: string;
  type: string;
  source: string;
  severity?: string | null;
  price?: number | null;
  score?: number | null;
  payload: unknown;
  features?: unknown;
  setupClassification: SetupClassification;
}

interface ExtractedOpportunityFeatures {
  momentum30sPct: number | null;
  momentum2mPct: number | null;
  volumeImpulse: number | null;
  buyRatio60s: number | null;
  liquidation5m: number | null;
  liquidationBias: string | null;
  spreadBps: number | null;
  fundingRate: number | null;
  basisPct: number | null;
  riskScore: number | null;
  nearestLiquidationDistancePct: number | null;
  volatility1h: number | null;
  marketPulse: number | null;
  dominantRegime: string | null;
  cvdSlope: number | null;
  cvdDivergence: string | null;
  oiChange5m: number | null;
  oiChange15m: number | null;
  signalConfidence: number | null;
  marketState: string | null;
  quoteVolume24h: number | null;
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

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const round = (value: number, decimals = 2): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const extractFeatures = (input: OpportunityScoreInput): ExtractedOpportunityFeatures => ({
  momentum30sPct: readNumber(input.features, [["row", "momentum30sPct"]]),
  momentum2mPct: readNumber(input.features, [["row", "momentum2mPct"]]),
  volumeImpulse: readNumber(input.features, [["row", "volumeImpulse"]]),
  buyRatio60s: readNumber(input.features, [["row", "buyRatio60s"]]),
  liquidation5m:
    readNumber(input.features, [["row", "liquidation5m"], ["liquidations", "liquidations5m"]]) ??
    readNumber(input.payload, [["notionalUsd"]]),
  liquidationBias: readString(input.features, [["row", "liquidationBias"]]),
  spreadBps: readNumber(input.features, [["row", "spreadBps"]]),
  fundingRate: readNumber(input.features, [["row", "fundingRate"], ["funding", "fundingRate"]]),
  basisPct: readNumber(input.features, [["funding", "basisPct"], ["row", "risk", "funding", "basisPct"]]),
  riskScore: readNumber(input.features, [["row", "riskScore"]]),
  nearestLiquidationDistancePct: readNumber(input.features, [
    ["row", "risk", "liquidationDistance", "nearestDistancePct"],
    ["row", "risk", "liquidationDistance", "distancePct"]
  ]),
  volatility1h: readNumber(input.features, [["row", "risk", "var", "volatility1h"]]),
  marketPulse: readNumber(input.features, [["overview", "marketPulse"]]),
  dominantRegime: readString(input.features, [["overview", "dominantRegime"]]),
  cvdSlope: readNumber(input.features, [["marketFlow", "cvd", "slope"]]),
  cvdDivergence: readString(input.features, [["marketFlow", "cvd", "divergence"]]),
  oiChange5m: readNumber(input.features, [["marketFlow", "openInterest", "oiChange5m"]]),
  oiChange15m: readNumber(input.features, [["marketFlow", "openInterest", "oiChange15m"]]),
  signalConfidence: readNumber(input.payload, [["adjustedSystemConfidence"]]),
  marketState: readString(input.payload, [["marketState"]]),
  quoteVolume24h: readNumber(input.features, [["row", "quoteVolume24h"]])
});

const isCvdConfirming = (direction: SetupDirection, features: ExtractedOpportunityFeatures): boolean => {
  if (direction === "long") {
    return (features.cvdSlope ?? 0) >= 0 || features.cvdDivergence === "bullish";
  }

  if (direction === "short") {
    return (features.cvdSlope ?? 0) <= 0 || features.cvdDivergence === "bearish";
  }

  return false;
};

const isCvdOpposing = (direction: SetupDirection, features: ExtractedOpportunityFeatures): boolean => {
  if (direction === "long") {
    return (features.cvdSlope ?? 0) < -0.1 || features.cvdDivergence === "bearish";
  }

  if (direction === "short") {
    return (features.cvdSlope ?? 0) > 0.1 || features.cvdDivergence === "bullish";
  }

  return false;
};

const isLiquidationConfirming = (
  direction: SetupDirection,
  features: ExtractedOpportunityFeatures
): boolean => {
  if ((features.liquidation5m ?? 0) < 250_000) {
    return false;
  }

  if (direction === "long") {
    return features.liquidationBias === "SHORTS_HIT";
  }

  if (direction === "short") {
    return features.liquidationBias === "LONGS_HIT";
  }

  return false;
};

const resolveRiskLevel = (features: ExtractedOpportunityFeatures): OpportunityRiskLevel => {
  const spread = features.spreadBps ?? 0;
  const funding = Math.abs(features.fundingRate ?? 0);
  const volatility = features.volatility1h ?? 0;
  const riskScore = features.riskScore ?? 0;
  const liquidationDistance = features.nearestLiquidationDistancePct;

  if (
    spread > 18 ||
    funding >= 0.0015 ||
    riskScore >= 85 ||
    volatility >= 8 ||
    (liquidationDistance !== null && liquidationDistance <= 1)
  ) {
    return "EXTREME";
  }

  if (
    spread > 10 ||
    funding >= 0.001 ||
    riskScore >= 70 ||
    volatility >= 5 ||
    (liquidationDistance !== null && liquidationDistance <= 2)
  ) {
    return "HIGH";
  }

  if (spread > 5 || funding >= 0.0005 || riskScore >= 45 || volatility >= 2.5) {
    return "MEDIUM";
  }

  return "LOW";
};

const resolveTtlSec = (input: OpportunityScoreInput): number => {
  const text = `${input.type} ${input.source} ${input.setupClassification.setupType}`.toLowerCase();

  if (text.includes("reviving") || text.includes("dead_coin")) {
    return 1800;
  }

  if (text.includes("oi") || text.includes("funding") || text.includes("breakout")) {
    return 600;
  }

  if (text.includes("tape") || text.includes("scalp") || text.includes("liquidation")) {
    return 120;
  }

  return 300;
};

const resolveExpectedMovePct = (features: ExtractedOpportunityFeatures): number | null => {
  const momentum = Math.max(Math.abs(features.momentum30sPct ?? 0), Math.abs(features.momentum2mPct ?? 0));
  const volumeImpulse = features.volumeImpulse ?? 0;
  const volatility = features.volatility1h ?? 0;

  if (momentum <= 0 && volumeImpulse <= 0 && volatility <= 0) {
    return null;
  }

  const raw = momentum * 0.75 + Math.max(volumeImpulse - 1, 0) * 0.35 + volatility * 0.2;
  return round(clamp(raw, 0.3, 8), 2);
};

export class OpportunityScoreEngine {
  evaluate(input: OpportunityScoreInput): OpportunityScoreResult {
    const setup = input.setupClassification;
    const features = extractFeatures(input);
    const direction = setup.direction;
    const reasons: string[] = [...setup.reasons];
    const warnings: string[] = [];
    const tags = new Set<string>(setup.tags);
    const confirmations: string[] = [];
    const riskLevel = resolveRiskLevel(features);
    const spread = features.spreadBps ?? 0;
    const setupConfidencePct = setup.confidence * 100;

    if ((features.volumeImpulse ?? 0) >= 1.8) {
      confirmations.push("volume impulse confirms");
      tags.add("volume_confirmed");
    }

    if (isCvdConfirming(direction, features)) {
      confirmations.push("CVD confirms direction");
      tags.add("cvd_confirmed");
    }

    if (Math.abs(features.oiChange5m ?? features.oiChange15m ?? 0) >= 0.8) {
      confirmations.push("open interest confirms");
      tags.add("oi_confirmed");
    }

    if (isLiquidationConfirming(direction, features)) {
      confirmations.push("liquidation pressure confirms");
      tags.add("liquidation_confirmed");
    }

    const extremeFundingTrap =
      setup.setupType === "FUNDING_TRAP" ||
      (Math.abs(features.fundingRate ?? 0) >= 0.001 &&
        Math.abs(features.cvdSlope ?? 0) < 0.1 &&
        Math.abs(features.oiChange5m ?? 0) < 0.4);
    const severeRiskBlock =
      riskLevel === "EXTREME" ||
      (features.marketState === "DISORDER" && (features.signalConfidence ?? 0) < 30);
    const liquidityTooWeak =
      typeof features.quoteVolume24h === "number" &&
      features.quoteVolume24h > 0 &&
      features.quoteVolume24h < 25_000_000;
    const spreadTooWide = spread > 12;
    const spreadMedium = spread > 6 && spread <= 12;
    const cvdOpposes = isCvdOpposing(direction, features);

    if (spreadMedium) {
      warnings.push("spread is medium; execution quality may degrade");
    }

    if (spreadTooWide) {
      warnings.push("spread too wide for clean execution");
    }

    if (extremeFundingTrap) {
      warnings.push("funding trap or extreme funding risk detected");
      tags.add("funding_risk");
    }

    if (cvdOpposes) {
      warnings.push("CVD opposes setup direction");
      tags.add("cvd_warning");
    }

    if (severeRiskBlock) {
      warnings.push("severe risk block detected");
      tags.add("risk_block");
    }

    if (liquidityTooWeak) {
      warnings.push("liquidity is too weak for reliable signal follow-through");
      tags.add("weak_liquidity");
    }

    if (confirmations.length > 0) {
      reasons.push(...confirmations);
    }

    if (features.dominantRegime === "balanced" || features.marketState === "TRANSITIONAL") {
      warnings.push("regime is unclear or transitional");
    }

    let score =
      setupConfidencePct * 0.45 +
      confirmations.length * 11 +
      Math.min(Math.max((features.volumeImpulse ?? 0) - 1, 0) * 6, 12) +
      Math.min(Math.abs(features.momentum30sPct ?? features.momentum2mPct ?? 0) * 5, 12);

    if (riskLevel === "MEDIUM") {
      score -= 8;
    } else if (riskLevel === "HIGH") {
      score -= 18;
    } else if (riskLevel === "EXTREME") {
      score -= 35;
    }

    if (spreadMedium) {
      score -= 8;
    }

    if (spreadTooWide) {
      score -= 25;
    }

    if (extremeFundingTrap) {
      score -= 25;
    }

    if (cvdOpposes) {
      score -= 18;
    }

    if (direction === "unknown") {
      score -= 20;
    }

    if (setup.setupType === "UNKNOWN") {
      score -= setup.confidence < 0.35 ? 25 : 12;
    }

    if (liquidityTooWeak) {
      score -= 15;
    }

    score = round(clamp(score, 0, 100), 2);
    const confidence = round(
      clamp(setupConfidencePct * 0.65 + confirmations.length * 7 + (warnings.length === 0 ? 10 : 0), 0, 100),
      2
    );

    let verdict: OpportunityVerdict = "WAIT";

    if (
      spreadTooWide ||
      extremeFundingTrap ||
      cvdOpposes ||
      severeRiskBlock ||
      liquidityTooWeak ||
      (setup.setupType === "UNKNOWN" && setup.confidence < 0.35) ||
      score < 45
    ) {
      verdict = "DO_NOT_TRADE";
    } else if (
      setupConfidencePct >= 65 &&
      score >= 70 &&
      direction !== "unknown" &&
      spread <= 6 &&
      riskLevel !== "HIGH" &&
      confirmations.length >= 2
    ) {
      verdict = "TRADE";
    }

    if (verdict === "WAIT" && confirmations.length < 2) {
      warnings.push("not enough independent confirmations yet");
    }

    return {
      verdict,
      score,
      confidence,
      direction,
      setupType: setup.setupType,
      reasons,
      warnings,
      invalidationHints: setup.invalidationHints,
      ttlSec: resolveTtlSec(input),
      expectedMovePct: resolveExpectedMovePct(features),
      riskLevel,
      tags: Array.from(tags)
    };
  }
}

export const opportunityScoreEngine = new OpportunityScoreEngine();
