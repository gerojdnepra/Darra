import { createHmac } from "node:crypto";
import { safeNumber } from "../lib/math";
import { setExchangeFiltersFromExchangeInfo } from "./binance-exchange-filters";
import type {
  ExchangeInfoResponse,
  ExchangeInfoSymbol,
  ListenKeyResponse,
  RestOpenInterest,
  RestFuturesAccountV3,
  RestPositionRiskV3,
  ServerTimeResponse,
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
}

interface ServerTimeCacheEntry {
  offsetMs: number;
  fetchedAt: number;
}

const SERVER_TIME_CACHE_TTL_MS = 60_000;
const serverTimeCache = new Map<string, ServerTimeCacheEntry>();

const requestJson = async <T>(url: string, options?: JsonRequestOptions): Promise<T> => {
  const requestInit: RequestInit = {
    method: options?.method ?? "GET",
    signal: AbortSignal.timeout(10_000)
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

export const fetchServerTime = async (restBase: string): Promise<number> => {
  const now = Date.now();
  const cached = serverTimeCache.get(restBase);

  if (cached && now - cached.fetchedAt <= SERVER_TIME_CACHE_TTL_MS) {
    return now + cached.offsetMs;
  }

  try {
    const response = await requestJson<ServerTimeResponse>(`${restBase}/fapi/v1/time`);
    const fetchedAt = Date.now();
    const offsetMs = response.serverTime - fetchedAt;
    serverTimeCache.set(restBase, { offsetMs, fetchedAt });
    return fetchedAt + offsetMs;
  } catch (error) {
    if (cached) {
      return now + cached.offsetMs;
    }

    throw error;
  }
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
): Promise<RestPositionRiskV3[]> => {
  const serverTime = await fetchServerTime(restBase);
  const query = buildSignedQuery(apiSecret, {
    recvWindow: 5_000,
    timestamp: serverTime
  });

  return requestJson<RestPositionRiskV3[]>(`${restBase}/fapi/v3/positionRisk?${query}`, {
    headers: userStreamHeaders(apiKey)
  });
};

export const fetchFuturesAccountSnapshot = async (
  restBase: string,
  apiKey: string,
  apiSecret: string
): Promise<RestFuturesAccountV3> => {
  const serverTime = await fetchServerTime(restBase);
  const query = buildSignedQuery(apiSecret, {
    recvWindow: 5_000,
    timestamp: serverTime
  });

  return requestJson<RestFuturesAccountV3>(`${restBase}/fapi/v3/account?${query}`, {
    headers: userStreamHeaders(apiKey)
  });
};

export const fetchOpenInterest = async (
  restBase: string,
  symbol: string
): Promise<RestOpenInterest> => {
  const params = new URLSearchParams({
    symbol: symbol.trim().toUpperCase()
  });

  return requestJson<RestOpenInterest>(`${restBase}/fapi/v1/openInterest?${params.toString()}`);
};
