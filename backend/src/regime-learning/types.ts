import type { RegimeBias, RegimeWeights } from "../regime/types";

export interface RegimeLearningDirectionalAccuracy {
  long: number;
  short: number;
}

export interface RegimeLearningState {
  symbol: string;
  accuracy: number;
  directionalAccuracy: RegimeLearningDirectionalAccuracy;
  stability: number;
  expectancy: number;
  confidence: number;
}

export interface RegimeLearningPayload {
  symbols: RegimeLearningState[];
  adaptiveWeights: RegimeWeights;
}

export interface RegimeLearningSnapshot {
  timestamp: number;
  symbol: string;
  predictedBias: RegimeBias;
  entryPrice: number;
}
