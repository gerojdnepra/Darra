export type RegimeBias = "LONG" | "SHORT" | "NEUTRAL";

export interface RegimeWeights {
  risk: number;
  funding: number;
  flow: number;
  liquidations: number;
}

export interface RegimeComponents {
  riskScore: number;
  fundingScore: number;
  flowScore: number;
  liquidationScore: number;
}

export interface RegimeState {
  symbol: string;
  bias: RegimeBias;
  finalScore: number;
  confidence: number;
  components: RegimeComponents;
}
