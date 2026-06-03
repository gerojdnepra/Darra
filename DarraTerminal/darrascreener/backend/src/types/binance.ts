export interface ExchangeInfoFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  minNotional?: string;
  notional?: string;
}

export interface ExchangeInfoSymbol {
  symbol: string;
  pair: string;
  status: string;
  contractType: string;
  quoteAsset: string;
  baseAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  filters: ExchangeInfoFilter[];
}

export interface ExchangeInfoResponse {
  symbols: ExchangeInfoSymbol[];
}

export interface RestTicker24h {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

export interface RestOpenInterest {
  openInterest: string;
  symbol: string;
  time: number;
}

export interface WsCombinedMessage<T> {
  stream: string;
  data: T;
}

export interface ListenKeyResponse {
  listenKey: string;
}

export interface ServerTimeResponse {
  serverTime: number;
}

export interface RestPositionRiskV3 {
  symbol: string;
  positionSide: "BOTH" | "LONG" | "SHORT";
  positionAmt: string;
  entryPrice: string;
  breakEvenPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  isolatedMargin: string;
  notional: string;
  marginAsset: string;
  isolatedWallet: string;
  initialMargin: string;
  maintMargin: string;
  positionInitialMargin: string;
  openOrderInitialMargin: string;
  adl: number;
  bidNotional: string;
  askNotional: string;
  updateTime: number;
}

export interface RestFuturesAccountAssetV3 {
  asset: string;
  walletBalance: string;
  unrealizedProfit: string;
  marginBalance: string;
  maintMargin: string;
  initialMargin: string;
  positionInitialMargin: string;
  openOrderInitialMargin: string;
  crossWalletBalance: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  updateTime: number;
}

export interface RestFuturesAccountV3 {
  feeTier: number;
  canTrade: boolean;
  canDeposit: boolean;
  canWithdraw: boolean;
  updateTime: number;
  totalInitialMargin: string;
  totalMaintMargin: string;
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  totalPositionInitialMargin: string;
  totalOpenOrderInitialMargin: string;
  totalCrossWalletBalance: string;
  totalCrossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  assets: RestFuturesAccountAssetV3[];
}

export interface AllMarketTickerEvent {
  e: "24hrTicker";
  E: number;
  s: string;
  c: string;
  P: string;
  v: string;
  q: string;
  h: string;
  l: string;
}

export interface MarkPriceEvent {
  e: "markPriceUpdate";
  E: number;
  s: string;
  p: string;
  i: string;
  P: string;
  r: string;
  T: number;
}

export interface AggTradeEvent {
  e: "aggTrade";
  E: number;
  s: string;
  p: string;
  q: string;
  m: boolean;
}

export interface BookTickerEvent {
  u: number;
  s: string;
  b: string;
  B: string;
  a: string;
  A: string;
  T?: number;
  E?: number;
}

export interface ForceOrderEvent {
  e: "forceOrder";
  E: number;
  o: {
    s: string;
    S: "BUY" | "SELL";
    p: string;
    q: string;
    ap: string;
    T: number;
  };
}

export interface AccountUpdatePosition {
  s: string;
  pa: string;
  ep: string;
  bep: string;
  cr: string;
  up: string;
  mt: "isolated" | "cross";
  iw: string;
  ps: "BOTH" | "LONG" | "SHORT";
}

export interface AccountUpdateEvent {
  e: "ACCOUNT_UPDATE";
  E: number;
  T: number;
  a: {
    m: string;
    B?: Array<{
      a: string;
      wb: string;
      cw: string;
      bc: string;
    }>;
    P?: AccountUpdatePosition[];
  };
}

export interface ListenKeyExpiredEvent {
  e: "listenKeyExpired";
  E: number;
  listenKey: string;
}

export type UserDataEvent = AccountUpdateEvent | ListenKeyExpiredEvent | { e: string };
