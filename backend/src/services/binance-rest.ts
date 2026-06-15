import { createHmac } from "node:crypto";
import { safeNumber } from "../lib/math";
import { setExchangeFiltersFromExchangeInfo } from "./binance-exchange-filters";
import {
  ensureBinanceTimeSyncStarted,
  getBinanceRecvWindowMs,
  getBinanceSignedTimestamp,
  resyncBinanceServerTimeAfterRecvWindowError
} from "./binance-time-sync";
import type {
  ExchangeInfoResponse,
  ExchangeInfoSymbol,
  ListenKeyResponse,
  RestLeverageBracketResponse,
  RestFuturesOrder,
  RestOpenInterest,
  RestFuturesAccountV3,
  RestPositionRiskV3,
  RestTicker24h
} from "../types/binance";

export interface UniverseSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;
  stepSize: number;
}

export interface BootstrapSnapshot {
  symbols: UniverseSymbol[];
  tickers: RestTicker24h[];
}

export interface DailyQuoteVolumePoint {
  openTime: number;
  closeTime: number;
  quoteVolume: number;
}

export type LeverageBracketSourceStatus = "AUTHORITATIVE" | "MISSING" | "STALE" | "ERROR";

export interface BinanceLeverageBracket {
  symbol: string;
  bracket: number;
  initialLeverage: number;
  notionalCap: number;
  notionalFloor: number;
  maintMarginRatio: number;
  cum: number;
}

export interface BinanceLeverageBracketSnapshot {
  symbol: string;
  status: LeverageBracketSourceStatus;
  brackets: BinanceLeverageBracket[];
  fetchedAt: number | null;
  error: string | null;
}

interface BinanceApiErrorPayload {
  code?: number;
  msg?: string;
}

export class BinanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number
  ) {
    super(message);
  }
}

interface JsonRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const LEVERAGE_BRACKET_CACHE_TTL_MS = 5 * 60 * 1000;
const leverageBracketCache = new Map<string, BinanceLeverageBracketSnapshot>();

const requestJson = async <T>(url: string, options?: JsonRequestOptions): Promise<T> => {
  const requestInit: RequestInit = {
    method: options?.method ?? "GET",
    signal: AbortSignal.timeout(options?.timeoutMs ?? 10_000)
  };

  if (options?.headers) {
    requestInit.headers = options.headers;
  }

  if (options?.body !== undefined) {
    requestInit.body = options.body;
  }

  const response = await fetch(url, requestInit);

  if (!response.ok) {
    let payload: BinanceApiErrorPayload | null = null;

    try {
      payload = (await response.json()) as BinanceApiErrorPayload;
    } catch {
      payload = null;
    }

    const message =
      payload?.msg ??
      `Request failed ${response.status} for ${new URL(url).pathname}`;
    throw new BinanceApiError(message, response.status, payload?.code);
  }

  return (await response.json()) as T;
};

const buildSignedQuery = (
  apiSecret: string,
  params: Record<string, string | number | undefined>
): string => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    searchParams.append(key, String(value));
  }

  const query = searchParams.toString();
  const signature = createHmac("sha256", apiSecret).update(query).digest("hex");
  searchParams.append("signature", signature);
  return searchParams.toString();
};

const userStreamHeaders = (apiKey: string): Record<string, string> => ({
  "X-MBX-APIKEY": apiKey
});

type SignedRequestRetryMode = "retry-on-recv-window" | "no-retry";

const isRecvWindowError = (error: unknown): boolean =>
  error instanceof BinanceApiError &&
  (error.code === -1021 || /recvwindow|timestamp/i.test(error.message));

const buildSignedRequestUrl = async (
  restBase: string,
  apiSecret: string,
  path: string,
  params: Record<string, string | number | undefined>
): Promise<string> => {
  const timestamp = await getBinanceSignedTimestamp(restBase);
  const query = buildSignedQuery(apiSecret, {
    ...params,
    recvWindow: getBinanceRecvWindowMs(),
    timestamp
  });

  return `${restBase}${path}?${query}`;
};

const signedRequestJson = async <T>(input: {
  restBase: string;
  apiKey: string;
  apiSecret: string;
  path: string;
  params: Record<string, string | number | undefined>;
  method?: JsonRequestOptions["method"];
  retryMode: SignedRequestRetryMode;
}): Promise<T> => {
  ensureBinanceTimeSyncStarted(input.restBase);

  const send = async (): Promise<T> => {
    const url = await buildSignedRequestUrl(
      input.restBase,
      input.apiSecret,
      input.path,
      input.params
    );
    const options: JsonRequestOptions = {
      headers: userStreamHeaders(input.apiKey)
    };

    if (input.method) {
      options.method = input.method;
    }

    return requestJson<T>(url, options);
  };

  try {
    return await send();
  } catch (error) {
    if (!isRecvWindowError(error)) {
      throw error;
    }

    await resyncBinanceServerTimeAfterRecvWindowError(
      input.restBase,
      error instanceof Error ? error.message : String(error)
    );

    if (input.retryMode !== "retry-on-recv-window") {
      throw error;
    }

    return send();
  }
};

const leverageBracketCacheKey = (restBase: string, symbol: string): string =>
  `${restBase.replace(/\/+$/, "")}:${symbol.trim().toUpperCase()}`;

const normalizeLeverageBracketResponse = (
  symbol: string,
  response: RestLeverageBracketResponse
): BinanceLeverageBracket[] => {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const items = Array.isArray(response) ? response : [response];
  const symbolItem = items.find((item) => item.symbol?.toUpperCase() === normalizedSymbol);

  if (!symbolItem || !Array.isArray(symbolItem.brackets)) {
    return [];
  }

  return symbolItem.brackets
    .map((bracket) => ({
      symbol: normalizedSymbol,
      bracket: safeNumber(bracket.bracket),
      initialLeverage: safeNumber(bracket.initialLeverage),
      notionalCap: safeNumber(bracket.notionalCap),
      notionalFloor: safeNumber(bracket.notionalFloor),
      maintMarginRatio: safeNumber(bracket.maintMarginRatio),
      cum: safeNumber(bracket.cum)
    }))
    .filter(
      (bracket) =>
        Number.isFinite(bracket.bracket) &&
        Number.isFinite(bracket.initialLeverage) &&
        bracket.initialLeverage > 0 &&
        Number.isFinite(bracket.notionalCap) &&
        bracket.notionalCap > 0 &&
        Number.isFinite(bracket.notionalFloor) &&
        bracket.notionalFloor >= 0
    )
    .sort((left, right) => left.notionalFloor - right.notionalFloor);
};

const toUniverseSymbol = (symbol: ExchangeInfoSymbol): UniverseSymbol => {
  const priceFilter = symbol.filters.find(
    (filter: ExchangeInfoSymbol["filters"][number]) => filter.filterType === "PRICE_FILTER"
  );
  const lotSizeFilter = symbol.filters.find(
    (filter: ExchangeInfoSymbol["filters"][number]) => filter.filterType === "LOT_SIZE"
  );

  const tickSize = safeNumber(priceFilter?.tickSize);
  const stepSize = safeNumber(lotSizeFilter?.stepSize);

  return {
    symbol: symbol.symbol,
    baseAsset: symbol.baseAsset,
    quoteAsset: symbol.quoteAsset,
    pricePrecision: symbol.pricePrecision,
    quantityPrecision: symbol.quantityPrecision,
    tickSize,
    stepSize
  };
};

export const bootstrapUniverse = async (
  restBase: string
): Promise<BootstrapSnapshot> => {
  const [exchangeInfo, allTickers] = await Promise.all([
    requestJson<ExchangeInfoResponse>(`${restBase}/fapi/v1/exchangeInfo`),
    requestJson<RestTicker24h[]>(`${restBase}/fapi/v1/ticker/24hr`)
  ]);
  setExchangeFiltersFromExchangeInfo(restBase, exchangeInfo);

  const symbols = exchangeInfo.symbols
    .filter(
      (symbol) =>
        symbol.contractType === "PERPETUAL" &&
        symbol.quoteAsset === "USDT" &&
        symbol.status === "TRADING"
    )
    .map(toUniverseSymbol);

  const allowedSymbols = new Set(symbols.map((symbol) => symbol.symbol));
  const tickers = allTickers.filter((ticker) => allowedSymbols.has(ticker.symbol));

  return { symbols, tickers };
};

export const fetchDailyQuoteVolumes = async (
  restBase: string,
  symbol: string,
  days: number
): Promise<DailyQuoteVolumePoint[]> => {
  const limit = Math.min(Math.max(Math.ceil(days), 1), 1500);
  const params = new URLSearchParams({
    symbol: symbol.trim().toUpperCase(),
    interval: "1d",
    limit: String(limit)
  });
  const klines = await requestJson<unknown[][]>(`${restBase}/fapi/v1/klines?${params.toString()}`);

  return klines
    .map((row) => ({
      openTime: safeNumber(row[0] as string | number | null | undefined),
      closeTime: safeNumber(row[6] as string | number | null | undefined),
      quoteVolume: safeNumber(row[7] as string | number | null | undefined)
    }))
    .filter(
      (point) =>
        Number.isFinite(point.openTime) &&
        Number.isFinite(point.closeTime) &&
        Number.isFinite(point.quoteVolume)
    );
};

export const startUserDataStream = async (
  restBase: string,
  apiKey: string
): Promise<ListenKeyResponse> =>
  requestJson<ListenKeyResponse>(`${restBase}/fapi/v1/listenKey`, {
    method: "POST",
    headers: userStreamHeaders(apiKey)
  });

export const keepaliveUserDataStream = async (
  restBase: string,
  apiKey: string
): Promise<ListenKeyResponse> =>
  requestJson<ListenKeyResponse>(`${restBase}/fapi/v1/listenKey`, {
    method: "PUT",
    headers: userStreamHeaders(apiKey)
  });

export const closeUserDataStream = async (
  restBase: string,
  apiKey: string
): Promise<void> => {
  await requestJson<ListenKeyResponse>(`${restBase}/fapi/v1/listenKey`, {
    method: "DELETE",
    headers: userStreamHeaders(apiKey)
  });
};

export const fetchPositionRiskSnapshot = async (
  restBase: string,
  apiKey: string,
  apiSecret: string
): Promise<RestPositionRiskV3[]> =>
  signedRequestJson<RestPositionRiskV3[]>({
    restBase,
    apiKey,
    apiSecret,
    path: "/fapi/v3/positionRisk",
    params: {},
    retryMode: "retry-on-recv-window"
  });

export const fetchFuturesAccountSnapshot = async (
  restBase: string,
  apiKey: string,
  apiSecret: string
): Promise<RestFuturesAccountV3> =>
  signedRequestJson<RestFuturesAccountV3>({
    restBase,
    apiKey,
    apiSecret,
    path: "/fapi/v3/account",
    params: {},
    retryMode: "retry-on-recv-window"
  });

export const fetchLeverageBrackets = async (
  restBase: string,
  apiKey: string,
  apiSecret: string,
  symbol: string
): Promise<BinanceLeverageBracket[]> => {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const response = await signedRequestJson<RestLeverageBracketResponse>({
    restBase,
    apiKey,
    apiSecret,
    path: "/fapi/v1/leverageBracket",
    params: {
      symbol: normalizedSymbol
    },
    retryMode: "retry-on-recv-window"
  });

  return normalizeLeverageBracketResponse(normalizedSymbol, response);
};

export const getCachedLeverageBrackets = async (
  restBase: string,
  apiKey: string | undefined,
  apiSecret: string | undefined,
  symbol: string,
  ttlMs = LEVERAGE_BRACKET_CACHE_TTL_MS
): Promise<BinanceLeverageBracketSnapshot> => {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const key = leverageBracketCacheKey(restBase, normalizedSymbol);
  const cached = leverageBracketCache.get(key);
  const now = Date.now();

  if (
    cached &&
    cached.status === "AUTHORITATIVE" &&
    cached.fetchedAt !== null &&
    now - cached.fetchedAt <= ttlMs
  ) {
    return { ...cached, brackets: cached.brackets.map((bracket) => ({ ...bracket })) };
  }

  if (!apiKey?.trim() || !apiSecret?.trim()) {
    return {
      symbol: normalizedSymbol,
      status: "MISSING",
      brackets: [],
      fetchedAt: cached?.fetchedAt ?? null,
      error: "Binance API credentials are required for leverage bracket lookup."
    };
  }

  try {
    const brackets = await fetchLeverageBrackets(restBase, apiKey, apiSecret, normalizedSymbol);
    const snapshot: BinanceLeverageBracketSnapshot = {
      symbol: normalizedSymbol,
      status: brackets.length > 0 ? "AUTHORITATIVE" : "MISSING",
      brackets,
      fetchedAt: now,
      error: brackets.length > 0 ? null : "No leverage brackets returned for symbol."
    };

    leverageBracketCache.set(key, snapshot);
    return { ...snapshot, brackets: snapshot.brackets.map((bracket) => ({ ...bracket })) };
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        status: "STALE",
        brackets: cached.brackets.map((bracket) => ({ ...bracket })),
        error: error instanceof Error ? error.message : "Leverage bracket lookup failed."
      };
    }

    return {
      symbol: normalizedSymbol,
      status: "ERROR",
      brackets: [],
      fetchedAt: null,
      error: error instanceof Error ? error.message : "Leverage bracket lookup failed."
    };
  }
};

export const placeFuturesOrder = async (
  restBase: string,
  apiKey: string,
  apiSecret: string,
  params: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
    quantity: number;
    price?: number | null;
    stopPrice?: number | null;
    reduceOnly?: boolean;
    newClientOrderId: string;
  }
): Promise<RestFuturesOrder> =>
  signedRequestJson<RestFuturesOrder>({
    restBase,
    apiKey,
    apiSecret,
    path: "/fapi/v1/order",
    method: "POST",
    params: {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.type === "LIMIT" ? params.price ?? undefined : undefined,
      stopPrice:
        params.type === "STOP_MARKET" || params.type === "TAKE_PROFIT_MARKET"
          ? params.stopPrice ?? undefined
          : undefined,
      timeInForce: params.type === "LIMIT" ? "GTC" : undefined,
      reduceOnly: params.reduceOnly ? "true" : undefined,
      newClientOrderId: params.newClientOrderId
    },
    retryMode: "no-retry"
  });

export const cancelFuturesOrder = async (
  restBase: string,
  apiKey: string,
  apiSecret: string,
  params: {
    symbol: string;
    origClientOrderId: string;
  }
): Promise<RestFuturesOrder> =>
  signedRequestJson<RestFuturesOrder>({
    restBase,
    apiKey,
    apiSecret,
    path: "/fapi/v1/order",
    method: "DELETE",
    params: {
      symbol: params.symbol,
      origClientOrderId: params.origClientOrderId
    },
    retryMode: "no-retry"
  });

export const getFuturesOrder = async (
  restBase: string,
  apiKey: string,
  apiSecret: string,
  params: {
    symbol: string;
    origClientOrderId: string;
  }
): Promise<RestFuturesOrder> =>
  signedRequestJson<RestFuturesOrder>({
    restBase,
    apiKey,
    apiSecret,
    path: "/fapi/v1/order",
    params: {
      symbol: params.symbol,
      origClientOrderId: params.origClientOrderId
    },
    retryMode: "retry-on-recv-window"
  });

export const getOpenOrders = async (
  restBase: string,
  apiKey: string,
  apiSecret: string,
  symbol?: string
): Promise<RestFuturesOrder[]> =>
  signedRequestJson<RestFuturesOrder[]>({
    restBase,
    apiKey,
    apiSecret,
    path: "/fapi/v1/openOrders",
    params: {
      symbol: symbol?.trim().toUpperCase() || undefined
    },
    retryMode: "retry-on-recv-window"
  });

export const getPositionRisk = async (
  restBase: string,
  apiKey: string,
  apiSecret: string
): Promise<RestPositionRiskV3[]> =>
  fetchPositionRiskSnapshot(restBase, apiKey, apiSecret);

export const fetchOpenInterest = async (
  restBase: string,
  symbol: string,
  options?: {
    timeoutMs?: number;
  }
): Promise<RestOpenInterest> => {
  const params = new URLSearchParams({
    symbol: symbol.trim().toUpperCase()
  });

  const requestOptions: JsonRequestOptions = {};
  if (options?.timeoutMs !== undefined) {
    requestOptions.timeoutMs = options.timeoutMs;
  }

  return requestJson<RestOpenInterest>(
    `${restBase}/fapi/v1/openInterest?${params.toString()}`,
    requestOptions
  );
};
