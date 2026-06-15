export type CvdDivergence = "bullish" | "bearish" | "none";
export type OpenInterestStatus = "FRESH" | "STALE" | "UNAVAILABLE";

export interface OpenInterestState {
  value: number | null;
  currentOI: number | null;
  updatedAt: number | null;
  status: OpenInterestStatus;
  errorReason: string | null;
  ageMs: number | null;
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
