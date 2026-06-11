import { clamp, round } from "../lib/math";
import type { ScreenerRow } from "../types/messages";
import type { RegimeComponents, RegimeState, RegimeWeights } from "../regime/types";
import type { RegimeLearningPayload, RegimeLearningState } from "./types";

type HorizonKey = "5m" | "15m" | "1h";
type ComponentKey = keyof RegimeComponents;

interface PredictionContribution {
  total: number;
  correct: number;
  longTotal: number;
  longCorrect: number;
  shortTotal: number;
  shortCorrect: number;
  expectancySum: number;
  expectancyCount: number;
}

interface PredictionRecord {
  timestamp: number;
  symbol: string;
  predictedBias: RegimeState["bias"];
  entryPrice: number;
  baseConfidence: number;
  components: RegimeComponents;
  evaluated: Partial<Record<HorizonKey, true>>;
  flipFromPrev: boolean;
  contribution: PredictionContribution;
  componentContribution: Record<ComponentKey, { total: number; correct: number }>;
}

interface ComponentStats {
  total: number;
  correct: number;
}

interface SymbolState {
  history: PredictionRecord[];
  head: number;
  predictionCount: number;
  flipCount: number;
  stats: PredictionContribution;
  lastRecordedAt: number | null;
}

const HORIZON_MS: Record<HorizonKey, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000
};

const HORIZON_KEYS: HorizonKey[] = ["5m", "15m", "1h"];
const COMPONENT_KEYS: ComponentKey[] = [
  "riskScore",
  "fundingScore",
  "flowScore",
  "liquidationScore"
];
const BASE_WEIGHTS: RegimeWeights = {
  risk: 0.25,
  funding: 0.2,
  flow: 0.35,
  liquidations: 0.2
};
const SAMPLE_INTERVAL_MS = 60_000;
const HISTORY_RETENTION_MS = 6 * 60 * 60 * 1000;

const emptyContribution = (): PredictionContribution => ({
  total: 0,
  correct: 0,
  longTotal: 0,
  longCorrect: 0,
  shortTotal: 0,
  shortCorrect: 0,
  expectancySum: 0,
  expectancyCount: 0
});

const emptyComponentContribution = (): Record<ComponentKey, { total: number; correct: number }> => ({
  riskScore: { total: 0, correct: 0 },
  fundingScore: { total: 0, correct: 0 },
  flowScore: { total: 0, correct: 0 },
  liquidationScore: { total: 0, correct: 0 }
});

const resolveOutcomeBias = (
  entryPrice: number,
  exitPrice: number
): RegimeState["bias"] => {
  if (exitPrice > entryPrice) {
    return "LONG";
  }

  if (exitPrice < entryPrice) {
    return "SHORT";
  }

  return "NEUTRAL";
};

const resolveComponentBias = (value: number): RegimeState["bias"] => {
  if (value > 0.05) {
    return "LONG";
  }

  if (value < -0.05) {
    return "SHORT";
  }

  return "NEUTRAL";
};

const toPercent = (numerator: number, denominator: number): number =>
  denominator > 0 ? round((numerator / denominator) * 100, 2) : 0;

const updateContribution = (
  contribution: PredictionContribution,
  predictedBias: RegimeState["bias"],
  actualBias: RegimeState["bias"],
  expectancy: number
): void => {
  contribution.total += 1;

  if (predictedBias === actualBias) {
    contribution.correct += 1;
  }

  if (predictedBias === "LONG") {
    contribution.longTotal += 1;
    if (predictedBias === actualBias) {
      contribution.longCorrect += 1;
    }
    contribution.expectancySum += expectancy;
    contribution.expectancyCount += 1;
    return;
  }

  if (predictedBias === "SHORT") {
    contribution.shortTotal += 1;
    if (predictedBias === actualBias) {
      contribution.shortCorrect += 1;
    }
    contribution.expectancySum += expectancy;
    contribution.expectancyCount += 1;
  }
};

export class RegimeLearningEngine {
  private readonly symbols = new Map<string, SymbolState>();
  private readonly componentStats: Record<ComponentKey, ComponentStats> = {
    riskScore: { total: 0, correct: 0 },
    fundingScore: { total: 0, correct: 0 },
    flowScore: { total: 0, correct: 0 },
    liquidationScore: { total: 0, correct: 0 }
  };

  build(input: {
    regime: RegimeState[];
    rows: ScreenerRow[];
    generatedAt?: number;
  }): RegimeLearningPayload {
    const now = input.generatedAt ?? Date.now();
    const rowBySymbol = new Map(input.rows.map((row) => [row.symbol, row] as const));

    for (const regime of input.regime) {
      const row = rowBySymbol.get(regime.symbol);
      const currentPrice = row?.markPrice || row?.lastPrice || 0;
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        continue;
      }

      const state = this.getSymbolState(regime.symbol);
      this.evaluatePending(state, currentPrice, now);
      this.recordPrediction(state, regime, currentPrice, now);
      this.pruneHistory(state, now);
    }

    const symbols = input.regime.map((regime) => this.buildState(regime));
    const adaptiveWeights = this.buildAdaptiveWeights();

    return {
      symbols,
      adaptiveWeights
    };
  }

  private getSymbolState(symbol: string): SymbolState {
    const existing = this.symbols.get(symbol);
    if (existing) {
      return existing;
    }

    const created: SymbolState = {
      history: [],
      head: 0,
      predictionCount: 0,
      flipCount: 0,
      stats: emptyContribution(),
      lastRecordedAt: null
    };
    this.symbols.set(symbol, created);
    return created;
  }

  private evaluatePending(state: SymbolState, currentPrice: number, now: number): void {
    for (let index = state.head; index < state.history.length; index += 1) {
      const record = state.history[index];
      if (!record) {
        continue;
      }

      for (const horizon of HORIZON_KEYS) {
        if (record.evaluated[horizon]) {
          continue;
        }

        if (now - record.timestamp < HORIZON_MS[horizon]) {
          continue;
        }

        const actualBias = resolveOutcomeBias(record.entryPrice, currentPrice);
        const longReturnPct = record.entryPrice > 0 ? ((currentPrice - record.entryPrice) / record.entryPrice) * 100 : 0;
        const expectancy =
          record.predictedBias === "LONG"
            ? longReturnPct
            : record.predictedBias === "SHORT"
              ? -longReturnPct
              : 0;

        updateContribution(record.contribution, record.predictedBias, actualBias, expectancy);
        updateContribution(state.stats, record.predictedBias, actualBias, expectancy);

        for (const key of COMPONENT_KEYS) {
          const predictedBias = resolveComponentBias(record.components[key]);
          if (predictedBias === "NEUTRAL") {
            continue;
          }

          record.componentContribution[key].total += 1;
          this.componentStats[key].total += 1;

          if (predictedBias === actualBias) {
            record.componentContribution[key].correct += 1;
            this.componentStats[key].correct += 1;
          }
        }

        record.evaluated[horizon] = true;
      }
    }
  }

  private recordPrediction(
    state: SymbolState,
    regime: RegimeState,
    currentPrice: number,
    now: number
  ): void {
    const lastRecord = state.history[state.history.length - 1];
    const shouldRecord =
      !lastRecord ||
      lastRecord.predictedBias !== regime.bias ||
      (state.lastRecordedAt !== null && now - state.lastRecordedAt >= SAMPLE_INTERVAL_MS) ||
      state.lastRecordedAt === null;

    if (!shouldRecord) {
      return;
    }

    const flipFromPrev = Boolean(lastRecord && lastRecord.predictedBias !== regime.bias);
    const record: PredictionRecord = {
      timestamp: now,
      symbol: regime.symbol,
      predictedBias: regime.bias,
      entryPrice: currentPrice,
      baseConfidence: regime.confidence,
      components: { ...regime.components },
      evaluated: {},
      flipFromPrev,
      contribution: emptyContribution(),
      componentContribution: emptyComponentContribution()
    };

    if (flipFromPrev) {
      state.flipCount += 1;
    }

    state.predictionCount += 1;
    state.lastRecordedAt = now;
    state.history.push(record);
  }

  private pruneHistory(state: SymbolState, now: number): void {
    while (state.head < state.history.length) {
      const record = state.history[state.head];
      if (!record || now - record.timestamp <= HISTORY_RETENTION_MS) {
        break;
      }

      state.predictionCount = Math.max(0, state.predictionCount - 1);
      state.stats.total -= record.contribution.total;
      state.stats.correct -= record.contribution.correct;
      state.stats.longTotal -= record.contribution.longTotal;
      state.stats.longCorrect -= record.contribution.longCorrect;
      state.stats.shortTotal -= record.contribution.shortTotal;
      state.stats.shortCorrect -= record.contribution.shortCorrect;
      state.stats.expectancySum -= record.contribution.expectancySum;
      state.stats.expectancyCount -= record.contribution.expectancyCount;

      for (const key of COMPONENT_KEYS) {
        this.componentStats[key].total -= record.componentContribution[key].total;
        this.componentStats[key].correct -= record.componentContribution[key].correct;
      }

      const nextRecord = state.history[state.head + 1];
      if (nextRecord?.flipFromPrev) {
        nextRecord.flipFromPrev = false;
        state.flipCount = Math.max(0, state.flipCount - 1);
      }

      state.head += 1;
    }

    if (state.head > 64 && state.head * 2 >= state.history.length) {
      state.history.splice(0, state.head);
      state.head = 0;
    }
  }

  private buildState(regime: RegimeState): RegimeLearningState {
    const state = this.symbols.get(regime.symbol);
    const stats = state?.stats ?? emptyContribution();
    const accuracy = toPercent(stats.correct, stats.total);
    const longAccuracy = toPercent(stats.longCorrect, stats.longTotal);
    const shortAccuracy = toPercent(stats.shortCorrect, stats.shortTotal);
    const stability =
      state && state.predictionCount > 1
        ? round(clamp((1 - state.flipCount / Math.max(state.predictionCount - 1, 1)) * 100, 0, 100), 2)
        : state && state.predictionCount === 1
          ? 100
          : 0;
    const expectancy =
      stats.expectancyCount > 0 ? round(stats.expectancySum / stats.expectancyCount, 4) : 0;
    const confidence = round(
      clamp(regime.confidence * 0.4 + accuracy * 0.4 + stability * 0.2, 0, 100),
      2
    );

    return {
      symbol: regime.symbol,
      accuracy,
      directionalAccuracy: {
        long: longAccuracy,
        short: shortAccuracy
      },
      stability,
      expectancy,
      confidence
    };
  }

  private buildAdaptiveWeights(): RegimeWeights {
    const adjusted = {
      risk: this.adjustWeight(BASE_WEIGHTS.risk, this.componentStats.riskScore),
      funding: this.adjustWeight(BASE_WEIGHTS.funding, this.componentStats.fundingScore),
      flow: this.adjustWeight(BASE_WEIGHTS.flow, this.componentStats.flowScore),
      liquidations: this.adjustWeight(BASE_WEIGHTS.liquidations, this.componentStats.liquidationScore)
    };
    const total = adjusted.risk + adjusted.funding + adjusted.flow + adjusted.liquidations;

    if (total <= 0) {
      return BASE_WEIGHTS;
    }

    return {
      risk: round(adjusted.risk / total, 4),
      funding: round(adjusted.funding / total, 4),
      flow: round(adjusted.flow / total, 4),
      liquidations: round(adjusted.liquidations / total, 4)
    };
  }

  private adjustWeight(baseWeight: number, stats: ComponentStats): number {
    const accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
    const multiplier = clamp(1 + (accuracy - 0.5) * 0.4, 0.8, 1.2);
    return round(baseWeight * multiplier, 6);
  }
}
