import type { ScreenerAlert, ScreenerRow } from "@/lib/types";
import { isLoopbackHost, localBackendWsUrl } from "@/lib/backend-url";
import type { LayoutPreset, NumericHistoryPoint } from "./types";

export interface OrderBookLevel {
  side: "bid" | "ask";
  price: number;
  size: number;
  cumulative: number;
  depthRatio: number;
}

export const resolveDefaultBackendWsUrl = (): string => {
  if (typeof window === "undefined") {
    return localBackendWsUrl;
  }

  const { hostname } = window.location;

  if (hostname && !isLoopbackHost(hostname)) {
    return `ws://${hostname}:3001/ws`;
  }

  return localBackendWsUrl;
};

export const wsHostLabel = (value: string): string => {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
};

export const appendHistoryPoint = (
  points: NumericHistoryPoint[] | undefined,
  timestamp: number,
  value: number,
  retentionMs: number,
  bucketMs: number
): NumericHistoryPoint[] => {
  const bucketTimestamp = Math.floor(timestamp / bucketMs) * bucketMs;
  const next = points ? [...points] : [];
  const last = next[next.length - 1];

  if (last && last.timestamp === bucketTimestamp) {
    last.value = value;
  } else {
    next.push({
      timestamp: bucketTimestamp,
      value
    });
  }

  const cutoff = bucketTimestamp - retentionMs;

  while (next[0] && next[0].timestamp < cutoff) {
    next.shift();
  }

  return next;
};

export const upsertHistoryPoint = (
  map: Map<string, NumericHistoryPoint[]>,
  symbol: string,
  timestamp: number,
  value: number,
  retentionMs: number,
  bucketMs: number
): void => {
  map.set(
    symbol,
    appendHistoryPoint(map.get(symbol), timestamp, value, retentionMs, bucketMs)
  );
};

export const readHistoryDelta = (
  points: NumericHistoryPoint[] | undefined,
  windowMs: number
): number | null => {
  const latest = points?.[points.length - 1];

  if (!latest || !points) {
    return null;
  }

  const targetTimestamp = latest.timestamp - windowMs;

  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];

    if (point && point.timestamp <= targetTimestamp) {
      return Number((latest.value - point.value).toFixed(2));
    }
  }

  return null;
};

export const buildSparklinePath = (
  points: NumericHistoryPoint[],
  width: number,
  height: number
): string => {
  if (points.length < 2) {
    return "";
  }

  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const range = Math.max(max - min, Math.abs(max) * 0.00001, 1e-9);
  const firstTimestamp = points[0]?.timestamp ?? 0;
  const lastTimestamp = points[points.length - 1]?.timestamp ?? firstTimestamp;
  const timeRange = Math.max(lastTimestamp - firstTimestamp, 1);

  return points
    .map((point, index) => {
      const x = ((point.timestamp - firstTimestamp) / timeRange) * width;
      const y = height - ((point.value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

export const buildOrderBookLevels = (
  row: ScreenerRow | null
): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } => {
  if (!row || row.lastPrice <= 0) {
    return { bids: [], asks: [] };
  }

  const bestBid = row.bestBid ?? row.lastPrice;
  const bestAsk = row.bestAsk ?? row.lastPrice;
  const inferredStep =
    row.bestBid !== null && row.bestAsk !== null
      ? Math.max(row.bestAsk - row.bestBid, row.lastPrice * 0.00002)
      : Math.max((row.lastPrice * Math.max(row.spreadBps ?? 1.5, 0.8)) / 10_000, row.lastPrice * 0.00003);
  const sizeSeed = Math.max(row.tradeNotional5s / Math.max(row.lastPrice, 1) / 6, 0.1);
  const bidSeed =
    row.bestBidQty ?? sizeSeed * (1 + Math.max(row.orderBookImbalance ?? 0, 0) * 2.2);
  const askSeed =
    row.bestAskQty ?? sizeSeed * (1 + Math.max(-(row.orderBookImbalance ?? 0), 0) * 2.2);

  const buildSide = (side: "bid" | "ask", basePrice: number, baseSize: number): OrderBookLevel[] => {
    const levels = Array.from({ length: 7 }, (_, index) => {
      const sizeMultiplier =
        side === "bid"
          ? 1.24 - index * 0.1 + Math.max(row.orderBookImbalance ?? 0, 0) * 0.22
          : 1.24 - index * 0.1 + Math.max(-(row.orderBookImbalance ?? 0), 0) * 0.22;

      return {
        side,
        price: side === "bid" ? basePrice - inferredStep * index : basePrice + inferredStep * index,
        size: Math.max(baseSize * sizeMultiplier, 0.01),
        cumulative: 0,
        depthRatio: 0
      };
    });

    let cumulative = 0;

    for (const level of levels) {
      cumulative += level.size;
      level.cumulative = cumulative;
    }

    const maxDepth = levels[levels.length - 1]?.cumulative ?? 1;

    for (const level of levels) {
      level.depthRatio = level.cumulative / maxDepth;
    }

    return levels;
  };

  return {
    bids: buildSide("bid", bestBid, bidSeed).reverse(),
    asks: buildSide("ask", bestAsk, askSeed)
  };
};

export const layoutGridClass = (layout: LayoutPreset): string => {
  if (layout === "single") {
    return "grid-cols-1";
  }

  if (layout === "split") {
    return "grid-cols-1 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]";
  }

  if (layout === "triple") {
    return "grid-cols-1 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,0.98fr)_minmax(0,1.16fr)]";
  }

  return "grid-cols-1 xl:grid-cols-2";
};

export const layoutPaneClass = (
  layout: LayoutPreset,
  index: number,
  widget?: "chart" | "orderbook" | "quotes" | "watchlist" | "signalTape" | "tradePad"
): string => {
  if (layout === "single") {
    return "min-h-[calc(100vh-138px)]";
  }

  if (layout === "split") {
    const orderClass =
      widget === "orderbook"
        ? "xl:order-1"
        : widget === "chart"
          ? "xl:order-2"
          : widget === "signalTape"
            ? "xl:order-3"
            : "xl:order-4";

    return `min-h-[calc(100vh-138px)] ${orderClass}`;
  }

  if (layout === "triple") {
    const orderClass =
      widget === "quotes"
        ? "xl:order-1"
        : widget === "orderbook"
          ? "xl:order-2"
          : widget === "chart"
            ? "xl:order-3"
            : widget === "signalTape"
              ? "xl:order-4"
              : widget === "tradePad"
                ? "xl:order-5"
                : "xl:order-6";

    return `min-h-[calc(100vh-138px)] ${orderClass}`;
  }

  if (layout === "quad") {
    return "min-h-[calc(50vh-98px)]";
  }

  return index === 0 ? "min-h-[calc(100vh-138px)]" : "min-h-[calc(50vh-98px)]";
};

export const deltaClass = (value: number | null): string => {
  if (value === null) {
    return "text-slate-400";
  }

  if (value > 0) {
    return "text-emerald-300";
  }

  if (value < 0) {
    return "text-rose-300";
  }

  return "text-slate-200";
};

export const scoreClass = (score: number): string => {
  if (score >= 65) {
    return "text-emerald-300";
  }

  if (score <= 35) {
    return "text-rose-300";
  }

  return "text-slate-100";
};

export const scoreDeltaLabel = (value: number | null): string => {
  if (value === null) {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
};

export const alertSeverityClass = (alert: ScreenerAlert): string => {
  if (alert.severity === "critical") {
    return "border-rose-400/30 bg-rose-500/12 text-rose-100";
  }

  if (alert.severity === "high") {
    return "border-amber-400/30 bg-amber-500/12 text-amber-100";
  }

  return "border-sky-400/30 bg-sky-500/12 text-sky-100";
};
