import type { AllocationState } from "../allocation/types";
import type { ConflictState } from "../conflict/types";
import type { ExecutionState } from "../execution/types";
import type { FundingSymbolState } from "../funding/types";
import type { MarketFlowState } from "../market-flow/types";
import type { MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type { RegimeState } from "../regime/types";
import type { RegimeMemoryState } from "../regime-memory/types";
import type { RegimeLearningPayload, RegimeLearningState } from "../regime-learning/types";
import type { RiskState } from "../risk/types";
import type { SignalIntelligenceState } from "../signal-intelligence/types";
import type { ScreenerRow } from "../types/messages";
import type {
  ForecastBias,
  PredictedRegime,
  RegimePredictionState,
  RegimeTransitionProbabilities,
  StabilityHorizon
} from "./types";

interface PrototypeDescriptor {
  mode: PredictedRegime;
  vector: number[];
}

const PROTOTYPES: PrototypeDescriptor[] = [
  { mode: "STABLE_TREND", vector: [0.9, 0.15, 0.85, 0.15, 0.2, 0.8] },
  { mode: "TRANSITIONAL", vector: [0.5, 0.55, 0.55, 0.45, 0.4, 0.55] },
  { mode: "CHOP", vector: [0.2, 0.7, 0.3, 0.7, 0.3, 0.35] },
  { mode: "DISORDER", vector: [0.1, 0.95, 0.15, 0.9, 0.85, 0.2] }
];

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number, decimals = 4): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const normalizePercent = (value: number | null | undefined): number =>
  clamp((value ?? 0) / 100);

const normalizeSigned = (value: number | null | undefined, scale: number): number =>
  clamp((value ?? 0) / scale, -1, 1);

const normalizeProbability = (value: number | null | undefined): number =>
  clamp(value ?? 0);

const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude <= 0 || rightMagnitude <= 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

const buildTransitionProbabilities = (
  projectedVector: number[],
  currentRegime: PredictedRegime | null,
  regimeMemory: RegimeMemoryState
): RegimeTransitionProbabilities => {
  const currentMode = currentRegime;
  const topEcho = regimeMemory.topRegimeEchoes[0];

  const weights = PROTOTYPES.map(({ mode, vector }) => {
    const similarity = (cosineSimilarity(projectedVector, vector) + 1) / 2;
    const continuityBoost = mode === currentMode ? regimeMemory.rrs * 0.08 : 0;
    const echoBoost = topEcho?.marketState === mode ? topEcho.similarity * 0.12 : 0;
    const weight = Math.max(0.001, similarity + continuityBoost + echoBoost);
    return [mode, weight] as const;
  });

  const total = weights.reduce((sum, [, value]) => sum + value, 0);
  const probabilities = {
    STABLE_TREND: 0,
    TRANSITIONAL: 0,
    CHOP: 0,
    DISORDER: 0
  } satisfies RegimeTransitionProbabilities;

  for (const [mode, value] of weights) {
    probabilities[mode] = round(value / total);
  }

  const normalizedTotal = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  const drift = round(1 - normalizedTotal);

  if (drift !== 0) {
    const correctionMode = weights.sort((left, right) => right[1] - left[1])[0]?.[0] ?? "TRANSITIONAL";
    probabilities[correctionMode] = round(probabilities[correctionMode] + drift);
  }

  return probabilities;
};

const buildStabilityHorizon = (input: {
  rrs: number;
  rdi: number;
  sdp: number;
  rtr: number;
}): StabilityHorizon => {
  const stabilityScore = clamp(
    input.rrs * 0.35 +
      (1 - input.rdi) * 0.25 +
      (1 - input.sdp) * 0.2 +
      (1 - input.rtr) * 0.2
  );
  const candles = Math.round(stabilityScore * 30);

  if (candles <= 5) {
    return { candles, bucket: "LOW" };
  }

  if (candles <= 20) {
    return { candles, bucket: "MODERATE" };
  }

  return { candles, bucket: "STABLE" };
};

const resolveCurrentRegime = (
  regimeMemory: RegimeMemoryState,
  signal: SignalIntelligenceState | null
): PredictedRegime | null => regimeMemory.marketState ?? signal?.marketState ?? null;

const resolveLeadSymbol = (
  regimeMemory: RegimeMemoryState,
  signalRows: SignalIntelligenceState[]
): string | null => regimeMemory.symbol ?? signalRows[0]?.symbol ?? null;

const resolveRowBySymbol = <T extends { symbol: string }>(
  rows: T[],
  symbol: string | null
): T | null => {
  if (!symbol) {
    return rows[0] ?? null;
  }

  return rows.find((row) => row.symbol === symbol) ?? rows[0] ?? null;
};

const resolveAllocationConcentration = (
  allocation: AllocationState[],
  symbol: string | null
): number => {
  if (allocation.length === 0) {
    return 0.5;
  }

  const sorted = [...allocation].sort((left, right) => right.weight - left.weight);
  const lead = symbol ? allocation.find((item) => item.symbol === symbol) ?? sorted[0] : sorted[0];
  const topWeight = clamp((sorted[0]?.weight ?? 0) / 100, 0, 1);
  const leadWeight = clamp((lead?.weight ?? 0) / 100, 0, 1);

  return clamp(topWeight * 0.65 + leadWeight * 0.35);
};

const resolveFlowTrend = (flow: MarketFlowState | null, risk: RiskState): number => {
  if (!flow) {
    return normalizeSigned(risk.flow.aggregatePressureScore, 100);
  }

  const oiTrend =
    normalizeSigned(flow.openInterest.oiChange5m, 10) * 0.45 +
    normalizeSigned(flow.openInterest.oiChange15m, 15) * 0.35 +
    normalizeSigned(flow.openInterest.oiChange1h, 20) * 0.2;
  const cvdSlope = normalizeSigned(flow.cvd.slope, Math.max(Math.abs(flow.cvd.value), 100_000));
  const divergence =
    flow.cvd.divergence === "bullish" ? 0.3 : flow.cvd.divergence === "bearish" ? -0.3 : 0;
  const riskFlow = normalizeSigned(risk.flow.aggregatePressureScore, 100);

  return clamp(oiTrend + cvdSlope * 0.25 + divergence + riskFlow * 0.2, -1, 1);
};

const resolveFundingAcceleration = (funding: FundingSymbolState | null, risk: RiskState): number => {
  if (!funding) {
    return normalizeSigned(risk.funding.annualizedPressureScore, 100);
  }

  return clamp(
    normalizeSigned(funding.annualizedFunding, 80) * 0.7 +
      normalizeSigned(funding.basisPct, 4) * 0.3,
    -1,
    1
  );
};

const resolveLearningDrift = (learning: RegimeLearningState | null): number => {
  if (!learning) {
    return 0.5;
  }

  const accuracy = normalizePercent(learning.accuracy);
  const stability = normalizePercent(learning.stability);
  const confidence = normalizePercent(learning.confidence);

  return clamp(1 - (accuracy * 0.35 + stability * 0.4 + confidence * 0.25));
};

const buildForecastBias = (input: {
  flowTrend: number;
  fundingAcceleration: number;
  executionScore: number;
  conflictIndex: number;
  regimeBias: RegimeState["bias"] | null | undefined;
  rrs: number;
}): ForecastBias => {
  const regimeBiasSignal =
    input.regimeBias === "LONG" ? 0.2 : input.regimeBias === "SHORT" ? -0.2 : 0;
  const executionBiasSignal = (input.executionScore - 0.5) * 0.4;
  const memoryBiasSupport = (input.rrs - 0.5) * 0.25;

  const score =
    (input.flowTrend * 0.4 +
      input.fundingAcceleration * 0.2 +
      executionBiasSignal +
      regimeBiasSignal +
      memoryBiasSupport) *
    (1 - input.conflictIndex * 0.45);

  if (score >= 0.12) {
    return "LONG_BIASED";
  }

  if (score <= -0.12) {
    return "SHORT_BIASED";
  }

  return "NEUTRAL";
};

export class RegimePredictionEngine {
  build(input: {
    generatedAt: number;
    rows: ScreenerRow[];
    funding: FundingSymbolState[];
    marketFlow: MarketFlowState[];
    regime: RegimeState[];
    regimeLearning: RegimeLearningPayload | null | undefined;
    execution: ExecutionState[];
    conflict: ConflictState[];
    allocation: AllocationState[];
    signalIntelligence: SignalIntelligenceState[];
    metaRegimeGovernor: MetaRegimeGovernorState;
    regimeMemory: RegimeMemoryState;
    risk: RiskState;
  }): RegimePredictionState {
    const leadSymbol = resolveLeadSymbol(input.regimeMemory, input.signalIntelligence);
    const signal = resolveRowBySymbol(input.signalIntelligence, leadSymbol);
    const regime = resolveRowBySymbol(input.regime, leadSymbol);
    const learning = resolveRowBySymbol(input.regimeLearning?.symbols ?? [], leadSymbol);
    const execution = resolveRowBySymbol(input.execution, leadSymbol);
    const conflict = resolveRowBySymbol(input.conflict, leadSymbol);
    const funding = resolveRowBySymbol(input.funding, leadSymbol);
    const marketFlow = resolveRowBySymbol(input.marketFlow, leadSymbol);
    const currentRegime = resolveCurrentRegime(input.regimeMemory, signal);

    const shs = normalizePercent(signal?.shs);
    const mrs = normalizeProbability(signal?.mrs);
    const sdp = normalizeProbability(signal?.sdp);
    const rrs = normalizeProbability(input.regimeMemory.rrs);
    const rdi = normalizeProbability(input.regimeMemory.rdi);
    const executionScore = clamp(execution?.executionScore ?? 0);
    const conflictIndex = clamp(conflict?.conflictIndex ?? 0);
    const sts = normalizePercent(input.metaRegimeGovernor.sts);
    const liquidationStress = normalizePercent(input.risk.liquidationDistance.averagePressureIndex);
    const allocationConcentration = resolveAllocationConcentration(input.allocation, leadSymbol);
    const flowTrend = resolveFlowTrend(marketFlow, input.risk);
    const fundingAcceleration = resolveFundingAcceleration(funding, input.risk);
    const learningDrift = resolveLearningDrift(learning);

    const currentVector = [
      clamp(shs * 0.45 + mrs * 0.2 + executionScore * 0.2 + (1 - allocationConcentration) * 0.15),
      clamp(sdp * 0.45 + rdi * 0.35 + liquidationStress * 0.2),
      clamp(sts * 0.65 + rrs * 0.35),
      clamp(conflictIndex),
      clamp(liquidationStress * 0.65 + Math.abs(fundingAcceleration) * 0.35),
      clamp(rrs)
    ];

    const deltaVelocity = [
      flowTrend * 0.18 + fundingAcceleration * 0.06 - learningDrift * 0.04,
      Math.abs(flowTrend) * 0.08 + learningDrift * 0.16 + rdi * 0.14,
      -learningDrift * 0.14 - rdi * 0.1 + sts * 0.04,
      rdi * 0.12 + Math.abs(flowTrend) * 0.05,
      (liquidationStress * 2 - 1) * 0.16 + Math.abs(fundingAcceleration) * 0.08,
      flowTrend * 0.08 - rdi * 0.08 + rrs * 0.05
    ];

    const nextVector = currentVector.map((value, index) =>
      clamp(value + (deltaVelocity[index] ?? 0))
    );

    const transitionProbabilities = buildTransitionProbabilities(
      nextVector,
      currentRegime,
      input.regimeMemory
    );
    const sortedProbabilities = (Object.entries(transitionProbabilities) as Array<
      [PredictedRegime, number]
    >).sort((left, right) => right[1] - left[1]);
    const predictedRegime = sortedProbabilities[0]?.[0] ?? "TRANSITIONAL";
    const currentProbability =
      currentRegime !== null ? transitionProbabilities[currentRegime] ?? 0 : 0;
    const rtr = round(clamp(1 - currentProbability));
    const stabilityHorizon = buildStabilityHorizon({ rrs, rdi, sdp, rtr });
    const forecastBias = buildForecastBias({
      flowTrend,
      fundingAcceleration,
      executionScore,
      conflictIndex,
      regimeBias: regime?.bias,
      rrs
    });
    const predictionConfidence = round(
      clamp(rrs * 0.3 + shs * 0.3 + executionScore * 0.2 + (1 - conflictIndex) * 0.2)
    );

    return {
      generatedAt: input.generatedAt,
      symbol: leadSymbol,
      currentRegime,
      predictedRegime,
      transitionProbabilities,
      rtr,
      stabilityHorizon,
      forecastBias,
      predictionConfidence
    };
  }
}
