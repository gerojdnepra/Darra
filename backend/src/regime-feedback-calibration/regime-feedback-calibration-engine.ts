import type { ExecutionState } from "../execution/types";
import type { MarketMode, MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type {
  ForecastBias,
  PredictedRegime,
  RegimePredictionState
} from "../regime-prediction/types";
import type { RegimeState } from "../regime/types";
import type { ScreenerRow } from "../types/messages";
import type {
  CalibrationAdjustment,
  CalibrationWindow,
  PredictionMetrics,
  RealizedBias,
  RealizedOutcome,
  RegimeFeedbackCalibrationState
} from "./types";

interface PendingPrediction {
  id: string;
  timestamp: number;
  symbol: string;
  referencePrice: number;
  predictedRegime: PredictedRegime;
  forecastBias: ForecastBias;
  predictedBias: RealizedBias;
  predictionConfidence: number;
  flipCount: number;
  resolvedWindows: Partial<Record<CalibrationWindow, boolean>>;
}

interface ScoredOutcome extends RealizedOutcome {
  phrSuccess: boolean;
  directionalSuccess: boolean;
  flipCount: number;
}

class MutableRingBuffer<T> {
  private readonly entries: Array<T | null>;
  private head = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.entries = new Array<T | null>(capacity).fill(null);
  }

  push(entry: T): void {
    this.entries[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  values(): T[] {
    const results: T[] = [];

    for (let offset = 0; offset < this.size; offset += 1) {
      const index = (this.head - this.size + offset + this.capacity) % this.capacity;
      const entry = this.entries[index];
      if (entry) {
        results.push(entry);
      }
    }

    return results;
  }
}

const WINDOW_ORDER: CalibrationWindow[] = ["5m", "15m", "1h"];
const WINDOW_MS: Record<CalibrationWindow, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000
};
const REALIZATION_THRESHOLDS: Record<CalibrationWindow, number> = {
  "5m": 0.0025,
  "15m": 0.005,
  "1h": 0.01
};

const PENDING_CAPACITY = 180;
const OUTCOME_CAPACITY = 720;
const MIN_RECORD_INTERVAL_MS = 30_000;

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number, decimals = 4): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const createZeroMetrics = (): PredictionMetrics => ({
  "5m": 0,
  "15m": 0,
  "1h": 0
});

const forecastToBias = (forecastBias: ForecastBias): RealizedBias => {
  if (forecastBias === "LONG_BIASED") {
    return "LONG";
  }

  if (forecastBias === "SHORT_BIASED") {
    return "SHORT";
  }

  return "NEUTRAL";
};

const resolvePrice = (row: ScreenerRow | null | undefined): number | null => {
  if (!row) {
    return null;
  }

  const preferred = Number.isFinite(row.markPrice) && row.markPrice > 0 ? row.markPrice : row.lastPrice;
  return Number.isFinite(preferred) && preferred > 0 ? preferred : null;
};

const resolvePredictedBias = (input: {
  predictedRegime: PredictedRegime;
  forecastBias: ForecastBias;
  regimeBias: RegimeState["bias"] | null | undefined;
  executionBias: ExecutionState["bias"] | null | undefined;
  marketMode: MarketMode;
}): RealizedBias => {
  if (
    input.predictedRegime === "CHOP" ||
    input.predictedRegime === "DISORDER" ||
    input.marketMode === "EXTREME_UNCERTAINTY"
  ) {
    return "NEUTRAL";
  }

  const forecastBias = forecastToBias(input.forecastBias);
  if (forecastBias !== "NEUTRAL") {
    return forecastBias;
  }

  if (input.predictedRegime === "TRANSITIONAL") {
    return input.regimeBias === input.executionBias
      ? (input.regimeBias ?? "NEUTRAL")
      : "NEUTRAL";
  }

  return (input.executionBias ?? input.regimeBias ?? "NEUTRAL") as RealizedBias;
};

const resolveRealizedBias = (
  referencePrice: number,
  realizedPrice: number,
  window: CalibrationWindow
): RealizedBias => {
  const threshold = REALIZATION_THRESHOLDS[window];
  const priceReturn = (realizedPrice - referencePrice) / referencePrice;

  if (priceReturn >= threshold) {
    return "LONG";
  }

  if (priceReturn <= -threshold) {
    return "SHORT";
  }

  return "NEUTRAL";
};

const buildMetrics = (
  outcomes: ScoredOutcome[],
  selector: (outcome: ScoredOutcome) => boolean
): PredictionMetrics => {
  const metrics = createZeroMetrics();

  for (const window of WINDOW_ORDER) {
    const filtered = outcomes.filter((outcome) => outcome.window === window);
    metrics[window] = filtered.length
      ? round(filtered.filter(selector).length / filtered.length)
      : 0;
  }

  return metrics;
};

const buildBiasDistribution = (outcomes: ScoredOutcome[]): Record<RealizedBias, number> => {
  if (!outcomes.length) {
    return {
      LONG: 0,
      SHORT: 0,
      NEUTRAL: 0
    };
  }

  const counts = {
    LONG: 0,
    SHORT: 0,
    NEUTRAL: 0
  } satisfies Record<RealizedBias, number>;

  for (const outcome of outcomes) {
    counts[outcome.realizedBias] += 1;
  }

  return {
    LONG: round(counts.LONG / outcomes.length),
    SHORT: round(counts.SHORT / outcomes.length),
    NEUTRAL: round(counts.NEUTRAL / outcomes.length)
  };
};

const buildCalibrationAdjustment = (input: {
  phr: PredictionMetrics;
  directionalAccuracy: PredictionMetrics;
  stabilityScore: number;
  calibrationError: number;
  averagePredictionConfidence: number;
}): CalibrationAdjustment => {
  const weightedPhr =
    input.phr["5m"] * 0.25 + input.phr["15m"] * 0.35 + input.phr["1h"] * 0.4;
  const weightedDa =
    input.directionalAccuracy["5m"] * 0.25 +
    input.directionalAccuracy["15m"] * 0.35 +
    input.directionalAccuracy["1h"] * 0.4;

  return {
    regimeWeightAdjustment: round(clamp((weightedPhr - 0.5) * 0.4, -0.2, 0.2)),
    confidenceAdjustment: round(
      clamp((weightedPhr - input.averagePredictionConfidence) * 0.6, -0.3, 0.3)
    ),
    flowWeightBias: round(clamp((weightedDa - 0.5) * 0.4, -0.2, 0.2)),
    riskPenaltyAdjustment: round(
      clamp((1 - input.stabilityScore) * 0.22 + input.calibrationError * 0.35 - 0.12, -0.2, 0.3)
    )
  };
};

export class RegimeFeedbackCalibrationEngine {
  private readonly pendingBySymbol = new Map<string, MutableRingBuffer<PendingPrediction>>();
  private readonly outcomesBySymbol = new Map<string, MutableRingBuffer<ScoredOutcome>>();
  private readonly lastRecordedAtBySymbol = new Map<string, number>();

  constructor(
    private readonly pendingCapacity = PENDING_CAPACITY,
    private readonly outcomeCapacity = OUTCOME_CAPACITY
  ) {}

  private getPendingBuffer(symbol: string): MutableRingBuffer<PendingPrediction> {
    const existing = this.pendingBySymbol.get(symbol);
    if (existing) {
      return existing;
    }

    const created = new MutableRingBuffer<PendingPrediction>(this.pendingCapacity);
    this.pendingBySymbol.set(symbol, created);
    return created;
  }

  private getOutcomeBuffer(symbol: string): MutableRingBuffer<ScoredOutcome> {
    const existing = this.outcomesBySymbol.get(symbol);
    if (existing) {
      return existing;
    }

    const created = new MutableRingBuffer<ScoredOutcome>(this.outcomeCapacity);
    this.outcomesBySymbol.set(symbol, created);
    return created;
  }

  private recordPrediction(input: {
    generatedAt: number;
    symbol: string;
    currentPrice: number;
    regimePrediction: RegimePredictionState;
    regime: RegimeState | null;
    execution: ExecutionState | null;
    marketMode: MarketMode;
  }): void {
    const lastRecordedAt = this.lastRecordedAtBySymbol.get(input.symbol) ?? 0;
    if (input.generatedAt - lastRecordedAt < MIN_RECORD_INTERVAL_MS) {
      return;
    }

    const pendingBuffer = this.getPendingBuffer(input.symbol);
    const pendingValues = pendingBuffer.values();
    const lastUnresolved = [...pendingValues]
      .reverse()
      .find((entry) => WINDOW_ORDER.some((window) => !entry.resolvedWindows[window]));

    const predictedBias = resolvePredictedBias({
      predictedRegime: input.regimePrediction.predictedRegime,
      forecastBias: input.regimePrediction.forecastBias,
      regimeBias: input.regime?.bias,
      executionBias: input.execution?.bias,
      marketMode: input.marketMode
    });

    if (
      lastUnresolved &&
      (lastUnresolved.predictedRegime !== input.regimePrediction.predictedRegime ||
        lastUnresolved.forecastBias !== input.regimePrediction.forecastBias ||
        lastUnresolved.predictedBias !== predictedBias)
    ) {
      lastUnresolved.flipCount += 1;
    }

    pendingBuffer.push({
      id: `${input.symbol}:${input.generatedAt}`,
      timestamp: input.generatedAt,
      symbol: input.symbol,
      referencePrice: input.currentPrice,
      predictedRegime: input.regimePrediction.predictedRegime,
      forecastBias: input.regimePrediction.forecastBias,
      predictedBias,
      predictionConfidence: input.regimePrediction.predictionConfidence,
      flipCount: 0,
      resolvedWindows: {}
    });

    this.lastRecordedAtBySymbol.set(input.symbol, input.generatedAt);
  }

  private resolveOutcomes(input: {
    generatedAt: number;
    symbol: string;
    currentPrice: number;
  }): void {
    const pendingBuffer = this.getPendingBuffer(input.symbol);
    const outcomeBuffer = this.getOutcomeBuffer(input.symbol);

    for (const prediction of pendingBuffer.values()) {
      for (const window of WINDOW_ORDER) {
        if (prediction.resolvedWindows[window]) {
          continue;
        }

        if (input.generatedAt - prediction.timestamp < WINDOW_MS[window]) {
          continue;
        }

        const realizedBias = resolveRealizedBias(
          prediction.referencePrice,
          input.currentPrice,
          window
        );
        const forecastBias = forecastToBias(prediction.forecastBias);

        outcomeBuffer.push({
          predictionId: prediction.id,
          symbol: prediction.symbol,
          predictedRegime: prediction.predictedRegime,
          forecastBias: prediction.forecastBias,
          predictedBias: prediction.predictedBias,
          realizedBias,
          predictionConfidence: prediction.predictionConfidence,
          window,
          predictedAt: prediction.timestamp,
          resolvedAt: input.generatedAt,
          phrSuccess: prediction.predictedBias === realizedBias,
          directionalSuccess: forecastBias === realizedBias,
          flipCount: prediction.flipCount
        });

        prediction.resolvedWindows[window] = true;
      }
    }
  }

  build(input: {
    generatedAt: number;
    rows: ScreenerRow[];
    regime: RegimeState[];
    execution: ExecutionState[];
    metaRegimeGovernor: MetaRegimeGovernorState;
    regimePrediction: RegimePredictionState;
  }): RegimeFeedbackCalibrationState {
    const symbol = input.regimePrediction.symbol ?? input.rows[0]?.symbol ?? null;
    const row = symbol ? input.rows.find((item) => item.symbol === symbol) ?? null : null;
    const currentPrice = resolvePrice(row);

    if (!symbol || currentPrice === null) {
      return {
        generatedAt: input.generatedAt,
        symbol: symbol ?? null,
        phr: createZeroMetrics(),
        directionalAccuracy: createZeroMetrics(),
        stabilityScore: 0,
        calibrationError: 0,
        realizedBiasDistribution: {
          LONG: 0,
          SHORT: 0,
          NEUTRAL: 0
        },
        calibrationAdjustment: {
          regimeWeightAdjustment: 0,
          confidenceAdjustment: 0,
          flowWeightBias: 0,
          riskPenaltyAdjustment: 0
        }
      };
    }

    const regime = input.regime.find((item) => item.symbol === symbol) ?? null;
    const execution = input.execution.find((item) => item.symbol === symbol) ?? null;

    this.resolveOutcomes({
      generatedAt: input.generatedAt,
      symbol,
      currentPrice
    });

    this.recordPrediction({
      generatedAt: input.generatedAt,
      symbol,
      currentPrice,
      regimePrediction: input.regimePrediction,
      regime,
      execution,
      marketMode: input.metaRegimeGovernor.marketMode
    });

    const outcomes = this.getOutcomeBuffer(symbol).values();
    const phr = buildMetrics(outcomes, (outcome) => outcome.phrSuccess);
    const directionalAccuracy = buildMetrics(
      outcomes,
      (outcome) => outcome.directionalSuccess
    );

    const uniqueObservations = new Map<string, number>();
    for (const outcome of outcomes) {
      uniqueObservations.set(
        outcome.predictionId,
        Math.max(uniqueObservations.get(outcome.predictionId) ?? 0, outcome.flipCount)
      );
    }

    const totalObservations = uniqueObservations.size;
    const predictionFlips = Array.from(uniqueObservations.values()).filter((value) => value > 0).length;
    const stabilityScore = totalObservations
      ? round(clamp(1 - predictionFlips / totalObservations))
      : 0;

    const averagePredictionConfidence = average(
      outcomes.map((outcome) => outcome.predictionConfidence)
    );
    const actualSuccessRate = average(
      outcomes.map((outcome) => (outcome.phrSuccess ? 1 : 0))
    );
    const calibrationError = outcomes.length
      ? round(Math.abs(averagePredictionConfidence - actualSuccessRate))
      : 0;

    return {
      generatedAt: input.generatedAt,
      symbol,
      phr,
      directionalAccuracy,
      stabilityScore,
      calibrationError,
      realizedBiasDistribution: buildBiasDistribution(outcomes),
      calibrationAdjustment: buildCalibrationAdjustment({
        phr,
        directionalAccuracy,
        stabilityScore,
        calibrationError,
        averagePredictionConfidence
      })
    };
  }
}
