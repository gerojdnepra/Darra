export type AllocationTier = "A" | "B" | "C";

export interface AllocationReasoning {
  execution: number;
  confidence: number;
  expectancy: number;
  consensus: number;
}

export interface AllocationState {
  symbol: string;
  allocationScore: number;
  weight: number;
  suggestedSize: number;
  tier: AllocationTier;
  reasoning: AllocationReasoning;
}
