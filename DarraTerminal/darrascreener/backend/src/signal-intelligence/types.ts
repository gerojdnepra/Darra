export type MarketState = "STABLE_TREND" | "TRANSITIONAL" | "CHOP" | "DISORDER";

export interface SignalIntelligenceState {
  symbol: string;
  ssi: number;
  mrs: number;
  sdp: number;
  shs: number;
  marketState: MarketState;
  adjustedSystemConfidence: number;
}
