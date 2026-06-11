export type PredictedRegime =
  | "STABLE_TREND"
  | "TRANSITIONAL"
  | "CHOP"
  | "DISORDER";

export type ForecastBias = "LONG_BIASED" | "SHORT_BIASED" | "NEUTRAL";

export type StabilityHorizonBucket = "LOW" | "MODERATE" | "STABLE";

export interface StabilityHorizon {
  candles: number;
  bucket: StabilityHorizonBucket;
}

export interface RegimeTransitionProbabilities {
  STABLE_TREND: number;
  TRANSITIONAL: number;
  CHOP: number;
  DISORDER: number;
}

export interface RegimePredictionState {
  generatedAt: number;
  symbol: string | null;
  currentRegime: PredictedRegime | null;
  predictedRegime: PredictedRegime;
  transitionProbabilities: RegimeTransitionProbabilities;
  rtr: number;
  stabilityHorizon: StabilityHorizon;
  forecastBias: ForecastBias;
  predictionConfidence: number;
}
