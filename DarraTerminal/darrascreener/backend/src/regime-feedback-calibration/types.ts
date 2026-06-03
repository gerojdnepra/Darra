import type { ForecastBias, PredictedRegime } from "../regime-prediction/types";

export type RealizedBias = "LONG" | "SHORT" | "NEUTRAL";
export type CalibrationWindow = "5m" | "15m" | "1h";

export interface PredictionMetrics {
  "5m": number;
  "15m": number;
  "1h": number;
}

export interface RealizedOutcome {
  predictionId: string;
  symbol: string;
  predictedRegime: PredictedRegime;
  forecastBias: ForecastBias;
  predictedBias: RealizedBias;
  realizedBias: RealizedBias;
  predictionConfidence: number;
  window: CalibrationWindow;
  predictedAt: number;
  resolvedAt: number;
}

export interface CalibrationAdjustment {
  regimeWeightAdjustment: number;
  confidenceAdjustment: number;
  flowWeightBias: number;
  riskPenaltyAdjustment: number;
}

export interface RegimeFeedbackCalibrationState {
  generatedAt: number;
  symbol: string | null;
  phr: PredictionMetrics;
  directionalAccuracy: PredictionMetrics;
  stabilityScore: number;
  calibrationError: number;
  realizedBiasDistribution: Record<RealizedBias, number>;
  calibrationAdjustment: CalibrationAdjustment;
}
