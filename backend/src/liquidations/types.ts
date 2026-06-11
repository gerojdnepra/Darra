export type LiquidationHeat = "low" | "medium" | "high" | "extreme";

export interface LiquidationState {
  symbol: string;
  liquidations1m: number;
  liquidations5m: number;
  liquidations15m: number;
  liquidations1h: number;
  longLiquidations: number;
  shortLiquidations: number;
}

export interface LiquidationHeatEntry {
  symbol: string;
  heat: LiquidationHeat;
  value: number;
}

export interface LiquidationsDashboardPayload {
  bySymbol: Record<string, LiquidationState>;
  topLiquidationSymbols: string[];
  heatRanking: LiquidationHeatEntry[];
}
