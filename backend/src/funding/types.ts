export type FundingSortMode = "highest" | "lowest" | "basis";

export interface FundingSymbolState {
  symbol: string;
  fundingRate: number;
  annualizedFunding: number;
  basisPct: number;
  premiumPct: number;
  markPrice: number;
  indexPrice: number;
}

export interface FundingSortedViews {
  highest: FundingSymbolState[];
  lowest: FundingSymbolState[];
  basis: FundingSymbolState[];
}
