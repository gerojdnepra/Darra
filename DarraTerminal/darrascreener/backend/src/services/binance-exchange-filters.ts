import { safeNumber } from "../lib/math";
import type { ExchangeInfoResponse, ExchangeInfoSymbol } from "../types/binance";

export interface BinanceSymbolFilters {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  minNotional: number | null;
}

interface ExchangeFilterCacheEntry {
  filters: Map<string, BinanceSymbolFilters>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, ExchangeFilterCacheEntry>();

const parsePositive = (value: string | undefined): number | null => {
  const parsed = safeNumber(value);
  return parsed > 0 ? parsed : null;
};

const decimalPlaces = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 8;
  }

  const text = value.toString();
  if (text.includes("e-")) {
    return Number(text.split("e-")[1]) || 8;
  }

  const fractional = text.split(".")[1];
  return fractional ? fractional.length : 0;
};

const floorToStep = (value: number, step: number): number => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(step) || step <= 0) {
    return 0;
  }

  const precision = decimalPlaces(step);
  return Number((Math.floor(value / step) * step).toFixed(precision));
};

const roundToTick = (value: number, tick: number): number => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(tick) || tick <= 0) {
    return value;
  }

  const precision = decimalPlaces(tick);
  return Number((Math.round(value / tick) * tick).toFixed(precision));
};

const findFilter = (
  symbol: ExchangeInfoSymbol,
  filterType: string
): ExchangeInfoSymbol["filters"][number] | null =>
  symbol.filters.find((filter) => filter.filterType === filterType) ?? null;

export const toBinanceSymbolFilters = (symbol: ExchangeInfoSymbol): BinanceSymbolFilters => {
  const priceFilter = findFilter(symbol, "PRICE_FILTER");
  const lotSizeFilter = findFilter(symbol, "MARKET_LOT_SIZE") ?? findFilter(symbol, "LOT_SIZE");
  const minNotionalFilter = findFilter(symbol, "MIN_NOTIONAL") ?? findFilter(symbol, "NOTIONAL");

  return {
    symbol: symbol.symbol,
    pricePrecision: symbol.pricePrecision,
    quantityPrecision: symbol.quantityPrecision,
    tickSize: parsePositive(priceFilter?.tickSize),
    stepSize: parsePositive(lotSizeFilter?.stepSize),
    minQty: parsePositive(lotSizeFilter?.minQty),
    maxQty: parsePositive(lotSizeFilter?.maxQty),
    minNotional: parsePositive(minNotionalFilter?.notional ?? minNotionalFilter?.minNotional)
  };
};

export const createExchangeFilterMap = (
  exchangeInfo: ExchangeInfoResponse
): Map<string, BinanceSymbolFilters> =>
  new Map(
    exchangeInfo.symbols
      .filter((symbol) => symbol.status === "TRADING")
      .map((symbol) => [symbol.symbol, toBinanceSymbolFilters(symbol)])
  );

export const setExchangeFiltersFromExchangeInfo = (
  restBase: string,
  exchangeInfo: ExchangeInfoResponse
): void => {
  cache.set(restBase, {
    filters: createExchangeFilterMap(exchangeInfo),
    fetchedAt: Date.now()
  });
};

const requestExchangeInfo = async (restBase: string): Promise<ExchangeInfoResponse> => {
  const response = await fetch(`${restBase}/fapi/v1/exchangeInfo`, {
    method: "GET",
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`exchangeInfo failed: ${response.status}`);
  }

  return (await response.json()) as ExchangeInfoResponse;
};

export const refreshExchangeFilters = async (
  restBase: string
): Promise<Map<string, BinanceSymbolFilters>> => {
  const exchangeInfo = await requestExchangeInfo(restBase);
  setExchangeFiltersFromExchangeInfo(restBase, exchangeInfo);
  return cache.get(restBase)?.filters ?? new Map();
};

export const getExchangeFilterMap = async (
  restBase: string
): Promise<Map<string, BinanceSymbolFilters>> => {
  const cached = cache.get(restBase);

  if (cached && Date.now() - cached.fetchedAt <= CACHE_TTL_MS) {
    return cached.filters;
  }

  return refreshExchangeFilters(restBase);
};

export const getCachedExchangeFilterMap = (
  restBase: string
): Map<string, BinanceSymbolFilters> | null => cache.get(restBase)?.filters ?? null;

export const getSymbolFilters = (
  symbol: string,
  filters: Map<string, BinanceSymbolFilters> | null | undefined
): BinanceSymbolFilters | null => filters?.get(symbol.trim().toUpperCase()) ?? null;

export const normalizeQuantity = (
  symbol: string,
  rawQty: number,
  filters: Map<string, BinanceSymbolFilters> | null | undefined
): { quantity: number; warnings: string[]; filters: BinanceSymbolFilters | null } => {
  const symbolFilters = getSymbolFilters(symbol, filters);

  if (!symbolFilters) {
    return {
      quantity: rawQty,
      warnings: ["Exchange filters unavailable; quantity is not Binance-normalized."],
      filters: null
    };
  }

  const warnings: string[] = [];
  let quantity = rawQty;

  if (symbolFilters.stepSize) {
    quantity = floorToStep(quantity, symbolFilters.stepSize);
  }

  if (symbolFilters.maxQty !== null && quantity > symbolFilters.maxQty) {
    quantity = symbolFilters.stepSize
      ? floorToStep(symbolFilters.maxQty, symbolFilters.stepSize)
      : symbolFilters.maxQty;
    warnings.push(`Quantity clamped to maxQty ${symbolFilters.maxQty}.`);
  }

  if (symbolFilters.minQty !== null && quantity < symbolFilters.minQty) {
    quantity = 0;
    warnings.push(`Quantity below minQty ${symbolFilters.minQty}.`);
  }

  return { quantity, warnings, filters: symbolFilters };
};

export const normalizePrice = (
  symbol: string,
  rawPrice: number,
  filters: Map<string, BinanceSymbolFilters> | null | undefined
): { price: number; warnings: string[]; filters: BinanceSymbolFilters | null } => {
  const symbolFilters = getSymbolFilters(symbol, filters);

  if (!symbolFilters?.tickSize) {
    return {
      price: rawPrice,
      warnings: symbolFilters ? [] : ["Exchange filters unavailable; price is not Binance-normalized."],
      filters: symbolFilters
    };
  }

  return {
    price: roundToTick(rawPrice, symbolFilters.tickSize),
    warnings: [],
    filters: symbolFilters
  };
};

export const validateNotional = (
  symbol: string,
  quantity: number,
  price: number,
  filters: Map<string, BinanceSymbolFilters> | null | undefined
): { valid: boolean; notional: number; warnings: string[]; filters: BinanceSymbolFilters | null } => {
  const symbolFilters = getSymbolFilters(symbol, filters);
  const notional = quantity * price;

  if (!symbolFilters) {
    return {
      valid: true,
      notional,
      warnings: ["Exchange filters unavailable; minNotional was not validated."],
      filters: null
    };
  }

  if (symbolFilters.minNotional !== null && notional < symbolFilters.minNotional) {
    return {
      valid: false,
      notional,
      warnings: [`Notional below minNotional ${symbolFilters.minNotional}.`],
      filters: symbolFilters
    };
  }

  return {
    valid: true,
    notional,
    warnings: [],
    filters: symbolFilters
  };
};
