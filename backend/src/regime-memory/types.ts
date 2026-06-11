import type { MarketMode, TradePermission } from "../meta-regime-governor/types";
import type { MarketState } from "../signal-intelligence/types";

export type ContinuityState = "ECHOING" | "STABLE_LOOP" | "DRIFTING" | "UNSTRUCTURED";
export type RegimeFingerprint = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
];

export interface RegimeEcho {
  timestamp: number;
  similarity: number;
  marketState: MarketState;
}

export interface RegimeMemorySymbolState {
  symbol: string;
  marketState: MarketState;
  continuityState: ContinuityState;
  rrs: number;
  rdi: number;
  memoryConfidence: number;
  learningConfidence: number;
  fingerprint: RegimeFingerprint;
  regimeEchoes: RegimeEcho[];
}

export interface RegimeMemoryState {
  generatedAt: number;
  symbol: string | null;
  marketState: MarketState | null;
  continuityState: ContinuityState;
  rrs: number;
  rdi: number;
  memoryConfidence: number;
  tradePermission: TradePermission;
  marketMode: MarketMode;
  topRegimeEchoes: RegimeEcho[];
  symbols: RegimeMemorySymbolState[];
}
