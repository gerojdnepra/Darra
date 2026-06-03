export type CvdDivergence = "bullish" | "bearish" | "none";

export interface OpenInterestState {
  currentOI: number;
  oiChange5m: number;
  oiChange15m: number;
  oiChange1h: number;
}

export interface CvdState {
  value: number;
  slope: number;
  divergence: CvdDivergence;
}

export interface MarketFlowState {
  symbol: string;
  openInterest: OpenInterestState;
  cvd: CvdState;
}
