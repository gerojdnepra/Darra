export type NormalizedDecision = "ENTER" | "WAIT" | "SKIP";
export type DecisionStrength = "WEAK" | "NORMAL" | "STRONG";
export type DecisionMarketRegime = "TREND" | "CHOP" | "LIQUIDATION_SPIKE" | "BREAKOUT";
export type SignalVolatilityClass = "LOW" | "MID" | "HIGH";

export interface DecisionNormalizationSignal {
  confidenceScore: number;
  signalStabilityScore: number;
  marketRegime: DecisionMarketRegime | string;
  signalVolatilityClass?: SignalVolatilityClass | string | null;
}

export interface DecisionNormalizationContext {
  requestedDecision?: NormalizedDecision | null;
}

const clampScore = (value: number): number =>
  Math.round(Math.min(Math.max(value, 0), 100) * 100) / 100;

const normalizeUnit = (value: number): number =>
  Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);

const normalizeRegime = (value: string | null | undefined): DecisionMarketRegime =>
  value === "TREND" ||
  value === "CHOP" ||
  value === "LIQUIDATION_SPIKE" ||
  value === "BREAKOUT"
    ? value
    : "CHOP";

export const computeDecisionQualityScore = (
  signal: DecisionNormalizationSignal
): number => {
  const confidence = clampScore(signal.confidenceScore);
  const stability = normalizeUnit(signal.signalStabilityScore) * 100;
  const regime = normalizeRegime(signal.marketRegime);
  const volatility = signal.signalVolatilityClass;
  const regimeScore =
    regime === "TREND" || regime === "BREAKOUT"
      ? 85
      : regime === "LIQUIDATION_SPIKE"
        ? 62
        : 45;
  const volatilityScore =
    volatility === "LOW"
      ? 85
      : volatility === "MID"
        ? 68
        : volatility === "HIGH"
          ? 42
          : 55;

  return clampScore(
    confidence * 0.4 +
      stability * 0.3 +
      regimeScore * 0.2 +
      volatilityScore * 0.1
  );
};

export const resolveDecisionStrength = (qualityScore: number): DecisionStrength => {
  if (qualityScore >= 75) {
    return "STRONG";
  }
  if (qualityScore >= 50) {
    return "NORMAL";
  }
  return "WEAK";
};

export const normalizeDecision = (
  signal: DecisionNormalizationSignal,
  context: DecisionNormalizationContext = {}
): NormalizedDecision => {
  const confidence = clampScore(signal.confidenceScore);
  const stability = normalizeUnit(signal.signalStabilityScore);
  const quality = computeDecisionQualityScore(signal);
  const regime = normalizeRegime(signal.marketRegime);

  if (context.requestedDecision === "SKIP") {
    return "SKIP";
  }

  if (confidence < 35 || stability < 0.35 || quality < 35) {
    return "SKIP";
  }

  if (regime === "CHOP" && (confidence < 72 || stability < 0.68)) {
    return "WAIT";
  }

  if (regime === "LIQUIDATION_SPIKE" && (confidence < 78 || stability < 0.72)) {
    return "WAIT";
  }

  if (confidence >= 70 && stability >= 0.62 && quality >= 60) {
    return "ENTER";
  }

  return "WAIT";
};
