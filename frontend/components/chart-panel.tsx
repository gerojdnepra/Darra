"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { compactUsd, formatPercent, formatPrice } from "@/lib/format";
import { isFreshOpenInterest } from "@/lib/open-interest";
import {
  explainExecutionBlocker,
  explainFlowState,
  explainFundingState,
  explainOpenInterestState,
  explainRiskState
} from "@/lib/trading-language";
import {
  getBiasVisual,
  getDecisionVisual,
  getDirectionBadgeClass
} from "@/lib/trading-visuals";
import type {
  FundingSymbolState,
  LiquidationState,
  MarketFlowState,
  MiniCandleSeries,
  PositionCapacityState,
  ScreenerRow
} from "@/lib/types";
import { ModuleInfoButton } from "./module-info-button";
import { LearningModeHelp } from "./learning-mode-help";
import { StatusBadge } from "./ui/status-badge";

interface ChartPanelProps {
  selectedSymbol: string | null;
  row: ScreenerRow | null;
  flow: MarketFlowState | null;
  funding: FundingSymbolState | null;
  liquidations: LiquidationState | null;
  positionCapacity?: PositionCapacityState | null;
  candleSeries?: MiniCandleSeries | null;
  executionContext?: ChartExecutionContext | null;
  onTicketLevelEdit?: (action: ChartTicketEditAction) => void;
  learningMode: boolean;
}

interface ChartPoint {
  timestamp: number;
  price: number;
  volume: number;
  cvd: number | null;
  oi: number | null;
}

interface ZoneLine {
  label: string;
  value: number;
  tone: "entry" | "sl" | "tp";
}

export interface ChartExecutionContext {
  symbol: string;
  ticket: {
    side: "LONG" | "SHORT";
    orderType: "MARKET" | "LIMIT";
    referencePrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    mode: "PAPER" | "TESTNET_LIVE";
  } | null;
  validation?: {
    status: "OK" | "CHECK" | "BLOCKED";
    riskRewardRatio: number | null;
    stopDistancePct: number | null;
    takeProfitDistancePct: number | null;
    sideConsistency: "OK" | "CHECK" | "UNKNOWN";
    sideConflicts: string[];
    preflightState: "waiting" | "blocked" | "clear" | "stale";
    preflightMessage: string;
  } | null;
  position: {
    source: "paper" | "account";
    side: "LONG" | "SHORT";
    entryPrice: number | null;
    liquidationPrice: number | null;
    liquidationDistancePct: number | null;
  } | null;
}

interface ExecutionLine {
  label: string;
  value: number;
  tone: "ticket" | "sl" | "tp" | "position" | "liquidation";
}

interface PseudoCandle {
  startTimestamp: number;
  endTimestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  cvd: number | null;
  oi: number | null;
}

interface HoverState {
  index: number;
  x: number;
  y: number;
  price: number;
}

type ChartMode = "line" | "candle" | "flow";
type ChartTicketLevelTarget = "reference" | "stopLoss" | "takeProfit";

export interface ChartTicketEditAction {
  symbol: string;
  target: ChartTicketLevelTarget;
  price: number;
}

interface ClickMenuState {
  x: number;
  y: number;
  price: number;
}

const chartWidth = 1000;
const chartHeight = 360;
const chartPadding = { top: 28, right: 92, bottom: 36, left: 56 };
const volumeStripHeight = 72;
const miniLineWidth = 220;
const miniLineHeight = 70;
const historyRetentionMs = 30 * 60_000;
const historyBucketMs = 5_000;
const maxHistoryPoints = 96;
const candleBucketSize = 3;

const stripTone = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "bg-slate-500/20";
  }

  if (value > 0) {
    return "bg-positive/70";
  }

  if (value < 0) {
    return "bg-negative/70";
  }

  return "bg-slate-500/35";
};

type CockpitStatus = "OK" | "CHECK" | "BLOCKED" | "WAITING";

const preflightBadgeStatus = (
  state: "waiting" | "blocked" | "clear" | "stale"
): CockpitStatus => {
  if (state === "clear") {
    return "OK";
  }

  if (state === "blocked") {
    return "BLOCKED";
  }

  if (state === "stale") {
    return "CHECK";
  }

  return "WAITING";
};

const formatMaybePercent = (value: number | null | undefined, digits = 2): string =>
  typeof value === "number" && Number.isFinite(value) ? formatPercent(value, digits) : "--";

const formatMaybeNumber = (value: number | null | undefined, digits = 2): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeTimestamp = (timestamp: number): number =>
  Math.floor(timestamp / historyBucketMs) * historyBucketMs;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const valueRange = (values: number[]): { min: number; max: number; range: number } => {
  if (values.length === 0) {
    return { min: 0, max: 1, range: 1 };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.0003, 1e-9);
  const paddedMin = min - pad;
  const paddedMax = max + pad;

  return {
    min: paddedMin,
    max: paddedMax,
    range: Math.max(paddedMax - paddedMin, 1e-9)
  };
};

const createPath = (
  values: number[],
  width: number,
  height: number,
  min: number,
  range: number
): string => {
  if (values.length < 2) {
    return "";
  }

  const xStep = width / Math.max(values.length - 1, 1);

  return values
    .map((value, index) => {
      const x = index * xStep;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${clamp(y, 0, height).toFixed(2)}`;
    })
    .join(" ");
};

const createChartPath = (
  points: ChartPoint[],
  min: number,
  range: number
): string => {
  if (points.length < 2) {
    return "";
  }

  const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
  const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const xStep = innerWidth / Math.max(points.length - 1, 1);

  return points
    .map((point, index) => {
      const x = chartPadding.left + index * xStep;
      const y =
        chartPadding.top +
        innerHeight -
        ((point.price - min) / range) * innerHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${clamp(y, chartPadding.top, chartPadding.top + innerHeight).toFixed(2)}`;
    })
    .join(" ");
};

const buildPseudoCandles = (points: ChartPoint[]): PseudoCandle[] => {
  const candles: PseudoCandle[] = [];

  for (let index = 0; index < points.length; index += candleBucketSize) {
    const bucket = points.slice(index, index + candleBucketSize);
    const first = bucket[0];
    const last = bucket[bucket.length - 1];

    if (!first || !last) {
      continue;
    }

    candles.push({
      startTimestamp: first.timestamp,
      endTimestamp: last.timestamp,
      open: first.price,
      high: Math.max(...bucket.map((point) => point.price)),
      low: Math.min(...bucket.map((point) => point.price)),
      close: last.price,
      volume: bucket.reduce((sum, point) => sum + point.volume, 0),
      cvd: last.cvd,
      oi: last.oi
    });
  }

  return candles;
};

const priceToY = (price: number, min: number, range: number): number => {
  const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  return (
    chartPadding.top +
    innerHeight -
    ((price - min) / range) * innerHeight
  );
};

const yToPrice = (y: number, min: number, range: number): number => {
  const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const boundedY = clamp(y, chartPadding.top, chartPadding.top + innerHeight);
  const normalized = 1 - (boundedY - chartPadding.top) / innerHeight;

  return min + normalized * range;
};

const createSeedHistory = (row: ScreenerRow): ChartPoint[] => {
  const price = row.markPrice || row.lastPrice;
  const now = normalizeTimestamp(row.updatedAt || Date.now());
  const driftPct = row.momentum2mPct || row.momentum30sPct || row.change24hPct / 24 || 0;
  const amplitude = Math.max(Math.abs(driftPct) / 100, 0.0012);
  const count = 18;

  return Array.from({ length: count }, (_, index) => {
    const progress = index / Math.max(count - 1, 1);
    const wave = Math.sin(progress * Math.PI * 2.4) * amplitude * 0.35;
    const drift = (progress - 1) * -(driftPct / 100) * 0.7;
    const seededPrice = price * (1 + drift + wave);

    return {
      timestamp: now - (count - index - 1) * historyBucketMs,
      price: seededPrice,
      volume: Math.max(row.tradeNotional5s * (0.65 + progress * 0.55), row.quoteVolume24h / 86_400),
      cvd: null,
      oi: null
    };
  });
};

const appendPoint = (
  history: ChartPoint[],
  row: ScreenerRow,
  flow: MarketFlowState | null
): ChartPoint[] => {
  const price = row.markPrice || row.lastPrice;

  if (!isFiniteNumber(price) || price <= 0) {
    return history;
  }

  const timestamp = normalizeTimestamp(row.updatedAt || Date.now());
  const next = history.length ? [...history] : createSeedHistory(row);
  const point: ChartPoint = {
    timestamp,
    price,
    volume: Math.max(row.tradeNotional5s, row.tradeNotional60s / 12, 0),
    cvd: flow?.cvd.value ?? row.risk?.flow.cvd5mUsd ?? null,
    oi:
      flow !== null
        ? flow.openInterest.currentOI
        : row.risk?.flow.openInterestUsd ?? null
  };
  const last = next[next.length - 1];

  if (last && last.timestamp === timestamp) {
    if (
      last.price === point.price &&
      last.volume === point.volume &&
      last.cvd === point.cvd &&
      last.oi === point.oi
    ) {
      return history;
    }

    next[next.length - 1] = point;
  } else if (!last || last.price !== point.price || timestamp > last.timestamp) {
    next.push(point);
  } else {
    return history;
  }

  const cutoff = timestamp - historyRetentionMs;

  return next
    .filter((item) => item.timestamp >= cutoff)
    .slice(-maxHistoryPoints);
};

const zoneLinesForRow = (row: ScreenerRow, price: number): ZoneLine[] => {
  const zoneStep = Math.max(Math.abs(row.momentum2mPct || row.change24hPct) / 100, 0.0015);
  const short = row.bias === "SHORT";

  return [
    { label: "Entry", value: price, tone: "entry" },
    {
      label: "SL",
      value: price * (short ? 1 + zoneStep * 1.6 : 1 - zoneStep * 1.6),
      tone: "sl"
    },
    {
      label: "TP",
      value: price * (short ? 1 - zoneStep * 2.2 : 1 + zoneStep * 2.2),
      tone: "tp"
    }
  ];
};

const executionLinesForContext = (context: ChartExecutionContext | null | undefined): ExecutionLine[] => {
  if (!context) {
    return [];
  }

  const lines: ExecutionLine[] = [];

  if (context.ticket?.referencePrice) {
    lines.push({
      label: "Ticket Ref",
      value: context.ticket.referencePrice,
      tone: "ticket"
    });
  }

  if (context.ticket?.stopLossPrice) {
    lines.push({
      label: "SL",
      value: context.ticket.stopLossPrice,
      tone: "sl"
    });
  }

  if (context.ticket?.takeProfitPrice) {
    lines.push({
      label: "TP",
      value: context.ticket.takeProfitPrice,
      tone: "tp"
    });
  }

  if (context.position?.entryPrice) {
    lines.push({
      label: "Position Entry",
      value: context.position.entryPrice,
      tone: "position"
    });
  }

  if (context.position?.liquidationPrice) {
    lines.push({
      label: "Liq",
      value: context.position.liquidationPrice,
      tone: "liquidation"
    });
  }

  return lines.filter((line) => Number.isFinite(line.value) && line.value > 0);
};

export function ChartPanel({
  selectedSymbol,
  row,
  flow,
  funding,
  liquidations,
  positionCapacity,
  candleSeries,
  executionContext,
  onTicketLevelEdit,
  learningMode
}: ChartPanelProps) {
  const historyRef = useRef<Map<string, ChartPoint[]>>(new Map());
  const [historyVersion, setHistoryVersion] = useState(0);
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const [clickMenu, setClickMenu] = useState<ClickMenuState | null>(null);

  useEffect(() => {
    if (!row) {
      return;
    }

    const previous = historyRef.current.get(row.symbol) ?? [];
    const next = appendPoint(previous, row, flow);

    historyRef.current.set(row.symbol, next);

    if (next !== previous) {
      setHistoryVersion((value) => value + 1);
    }
  }, [flow, row]);

  const fallbackHistory = useMemo(
    () => (selectedSymbol ? historyRef.current.get(selectedSymbol) ?? [] : []),
    [historyVersion, selectedSymbol]
  );

  if (!selectedSymbol) {
    return (
      <PanelShell subtitle="symbol focus chart" learningMode={learningMode}>
        <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/20 p-6 text-center">
          <div>
            <div className="text-sm font-semibold text-slate-200">
              Select a symbol from Signal or Decision
            </div>
            <div className="mt-2 text-xs text-slate-500">
              The chart, flow strips and decision context will follow that symbol.
            </div>
          </div>
        </div>
      </PanelShell>
    );
  }

  if (!row) {
    return (
      <PanelShell subtitle={selectedSymbol} learningMode={learningMode}>
        <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/20 p-6 text-center">
          <div>
            <div className="text-sm font-semibold text-slate-200">{selectedSymbol}</div>
            <div className="mt-2 text-xs text-slate-500">waiting for data</div>
          </div>
        </div>
      </PanelShell>
    );
  }

  const backendCandles = (candleSeries?.candles ?? []).filter(
    (candle) =>
      isFiniteNumber(candle.timestamp) &&
      isFiniteNumber(candle.open) &&
      isFiniteNumber(candle.high) &&
      isFiniteNumber(candle.low) &&
      isFiniteNumber(candle.close)
  );
  const hasBackendCandles = backendCandles.length > 1;
  const history = hasBackendCandles
    ? backendCandles.map((candle) => ({
        timestamp: candle.timestamp,
        price: candle.close,
        volume: candle.volume,
        cvd: null,
        oi: null
      }))
    : fallbackHistory;
  const price = row.markPrice || row.lastPrice;
  const zones = zoneLinesForRow(row, price);
  const executionLines = executionLinesForContext(executionContext);
  const pseudoCandles = hasBackendCandles
    ? backendCandles.map((candle) => ({
        startTimestamp: candle.timestamp,
        endTimestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        cvd: null,
        oi: null
      }))
    : buildPseudoCandles(history);
  const priceValues = [
    ...history.map((point) => point.price),
    ...pseudoCandles.flatMap((candle) => [candle.high, candle.low]),
    ...zones.map((zone) => zone.value),
    ...executionLines.map((line) => line.value),
    price
  ];
  const priceRange = valueRange(priceValues);
  const pricePath = createChartPath(history, priceRange.min, priceRange.range);
  const lastY = priceToY(price, priceRange.min, priceRange.range);
  const previousPrice = history[history.length - 2]?.price ?? history[0]?.price ?? price;
  const priceDeltaPct = previousPrice > 0 ? ((price - previousPrice) / previousPrice) * 100 : 0;
  const cvdValues = history.map((point) => point.cvd).filter(isFiniteNumber);
  const oiValues = history.map((point) => point.oi).filter(isFiniteNumber);
  const cvdRange = valueRange(cvdValues);
  const oiRange = valueRange(oiValues);
  const cvdPath = createPath(cvdValues, miniLineWidth, miniLineHeight, cvdRange.min, cvdRange.range);
  const oiPath = createPath(oiValues, miniLineWidth, miniLineHeight, oiRange.min, oiRange.range);
  const openInterestStripValue = !flow
    ? "--"
    : flow.openInterest.status === "UNAVAILABLE"
      ? "unavailable"
      : flow.openInterest.status === "STALE"
        ? flow.openInterest.ageMs !== null
          ? `stale ${Math.max(1, Math.round(flow.openInterest.ageMs / 60_000))}m`
          : "stale"
        : formatMaybePercent(flow.openInterest.oiChange5m, 2);
  const maxVolume = Math.max(...history.map((point) => point.volume), 1);
  const hoveredPoint = hoverState ? history[hoverState.index] ?? null : null;
  const hoveredCandle = hoverState
    ? pseudoCandles[
        hasBackendCandles
          ? hoverState.index
          : Math.floor(hoverState.index / candleBucketSize)
      ] ?? null
    : null;
  const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
  const chartPointX = (index: number): number =>
    chartPadding.left + (innerWidth / Math.max(history.length - 1, 1)) * index;
  const applyTicketEdit = (target: ChartTicketLevelTarget, editPrice: number): void => {
    if (!selectedSymbol || !Number.isFinite(editPrice) || editPrice <= 0) {
      return;
    }

    onTicketLevelEdit?.({
      symbol: selectedSymbol,
      target,
      price: editPrice
    });
    setClickMenu(null);
  };
  const safeToAddLabel = positionCapacity
    ? positionCapacity.safeToAdd
      ? "Safe to add"
      : "Safety block"
    : row.riskLevel === "CRITICAL"
      ? "Risk block"
      : "No capacity data";
  const riskLabel = positionCapacity
    ? `${row.riskLevel} / ${positionCapacity.safeToAdd ? "OK" : "SAFETY BLOCK"}`
    : row.riskLevel;

  return (
    <PanelShell subtitle={`${row.symbol} live micro chart`} learningMode={learningMode}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-white">{row.symbol}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full border px-2.5 py-1 ${getDirectionBadgeClass(row.bias)}`}>
              {row.bias}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
              score {row.score.toFixed(1)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
              {history.length} {hasBackendCandles ? `${candleSeries?.interval ?? "mini"} candles` : "pts"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
              spread {formatMaybePercent(row.spreadBps === null ? null : row.spreadBps / 100, 3)}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-slate-100">{formatPrice(price)}</div>
          <div className={priceDeltaPct >= 0 ? "text-sm text-positive" : "text-sm text-negative"}>
            {formatPercent(priceDeltaPct, 3)} chart delta
          </div>
          {candleSeries?.source && (
            <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
              {candleSeries.source}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(["line", "candle", "flow"] as ChartMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setChartMode(mode);
                setHoverState(null);
              }}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] transition ${
                chartMode === mode
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-accent/35 hover:text-accent"
              }`}
            >
              {mode === "candle" ? (hasBackendCandles ? "Candles" : "Pseudo-candle") : mode}
            </button>
          ))}
        </div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
          {chartMode === "flow"
            ? "Order Flow / Open Interest overlay"
            : hasBackendCandles
              ? `backend ${candleSeries?.interval ?? "mini"} candles`
              : "frontend micro-history"}
        </div>
        {executionContext?.validation ? (
          <StatusBadge status={executionContext.validation.status}>
            {executionContext.validation.status}
          </StatusBadge>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
        <div className="text-[11px] text-slate-500">
          Click sets ticket reference. Shift-click sets SL. Alt-click sets TP.
        </div>
        <button
          type="button"
          title="Chart edits execution levels only. Orders are sent only from Execution."
          className="rounded-full border border-caution/25 bg-caution/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-caution"
        >
          Ticket only
        </button>
      </div>

      <ExecutionLegend context={executionContext} />
      <PlanValidationMini context={executionContext} />

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/25">
        <svg
          className="block h-[420px] w-full"
          viewBox={`0 0 ${chartWidth} ${chartHeight + volumeStripHeight}`}
          role="img"
          aria-label={`${row.symbol} micro price chart`}
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverState(null)}
          onMouseMove={(event) => {
            if (history.length === 0) {
              return;
            }

            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * chartWidth;
            const rawIndex = Math.round(
              ((x - chartPadding.left) / Math.max(innerWidth, 1)) * (history.length - 1)
            );
            const index = clamp(rawIndex, 0, history.length - 1);
            const point = history[index];

            if (!point) {
              return;
            }

            setHoverState({
              index,
              x: chartPointX(index),
              y: priceToY(point.price, priceRange.min, priceRange.range),
              price: yToPrice(((event.clientY - rect.top) / rect.height) * (chartHeight + volumeStripHeight), priceRange.min, priceRange.range)
            });
          }}
          onClick={(event) => {
            if (!onTicketLevelEdit) {
              return;
            }

            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * chartWidth;
            const y = ((event.clientY - rect.top) / rect.height) * (chartHeight + volumeStripHeight);

            if (
              x < chartPadding.left ||
              x > chartWidth - chartPadding.right ||
              y < chartPadding.top ||
              y > chartHeight - chartPadding.bottom
            ) {
              return;
            }

            const editPrice = yToPrice(y, priceRange.min, priceRange.range);

            if (event.shiftKey) {
              applyTicketEdit("stopLoss", editPrice);
              return;
            }

            if (event.altKey) {
              applyTicketEdit("takeProfit", editPrice);
              return;
            }

            applyTicketEdit("reference", editPrice);
            setClickMenu({
              x: clamp(event.clientX - rect.left, 12, rect.width - 190),
              y: clamp(event.clientY - rect.top, 12, rect.height - 126),
              price: editPrice
            });
          }}
        >
          <rect width={chartWidth} height={chartHeight + volumeStripHeight} fill="rgba(2,6,23,0.18)" />
          {[0, 1, 2, 3].map((line) => {
            const y = chartPadding.top + ((chartHeight - chartPadding.top - chartPadding.bottom) / 3) * line;

            return (
              <line
                key={`grid-${line}`}
                x1={chartPadding.left}
                x2={chartWidth - chartPadding.right}
                y1={y}
                y2={y}
                stroke="rgba(148,163,184,0.12)"
                strokeWidth="1"
              />
            );
          })}

          {zones.map((zone) => {
            const y = priceToY(zone.value, priceRange.min, priceRange.range);
            const stroke =
              zone.tone === "entry"
                ? "rgba(56,189,248,0.72)"
                : zone.tone === "sl"
                  ? "rgba(248,113,113,0.72)"
                  : "rgba(74,222,128,0.72)";

            return (
              <g key={zone.label}>
                <line
                  x1={chartPadding.left}
                  x2={chartWidth - chartPadding.right}
                  y1={y}
                  y2={y}
                  stroke={stroke}
                  strokeDasharray={zone.tone === "entry" ? "0" : "8 7"}
                  strokeWidth="1.5"
                />
                <text
                  x={chartWidth - chartPadding.right + 12}
                  y={y + 4}
                  fill={stroke}
                  fontSize="12"
                  fontWeight="700"
                >
                  {zone.label} {formatPrice(zone.value)}
                </text>
              </g>
            );
          })}

          {executionLines.map((line, index) => {
            const y = priceToY(line.value, priceRange.min, priceRange.range);
            const stroke =
              line.tone === "ticket"
                ? "rgba(56,189,248,0.9)"
                : line.tone === "sl"
                  ? "rgba(248,113,113,0.95)"
                  : line.tone === "tp"
                    ? "rgba(74,222,128,0.95)"
                    : line.tone === "position"
                      ? "rgba(226,232,240,0.9)"
                      : "rgba(251,146,60,0.92)";

            return (
              <g key={`execution-line-${line.label}-${index}`}>
                <line
                  x1={chartPadding.left}
                  x2={chartWidth - chartPadding.right}
                  y1={y}
                  y2={y}
                  stroke={stroke}
                  strokeDasharray={line.tone === "position" ? "0" : "5 5"}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={chartPadding.left + 10}
                  y={y - 7}
                  fill={stroke}
                  fontSize="12"
                  fontWeight="700"
                >
                  {line.label} {formatPrice(line.value)}
                </text>
              </g>
            );
          })}

          {chartMode === "candle" && pseudoCandles.length > 1 ? (
            <g>
              {pseudoCandles.map((candle, index) => {
                const slotWidth = innerWidth / Math.max(pseudoCandles.length, 1);
                const centerX = chartPadding.left + slotWidth * index + slotWidth / 2;
                const bodyWidth = Math.max(slotWidth * 0.55, 5);
                const wickTop = priceToY(candle.high, priceRange.min, priceRange.range);
                const wickBottom = priceToY(candle.low, priceRange.min, priceRange.range);
                const bodyTop = priceToY(Math.max(candle.open, candle.close), priceRange.min, priceRange.range);
                const bodyBottom = priceToY(Math.min(candle.open, candle.close), priceRange.min, priceRange.range);
                const bullish = candle.close >= candle.open;
                const fill = bullish ? "rgba(74,222,128,0.62)" : "rgba(248,113,113,0.62)";

                return (
                  <g key={`${candle.startTimestamp}-${candle.endTimestamp}`}>
                    <line
                      x1={centerX}
                      x2={centerX}
                      y1={wickTop}
                      y2={wickBottom}
                      stroke={fill}
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={centerX - bodyWidth / 2}
                      y={Math.min(bodyTop, bodyBottom)}
                      width={bodyWidth}
                      height={Math.max(Math.abs(bodyBottom - bodyTop), 3)}
                      rx="2"
                      fill={fill}
                    />
                  </g>
                );
              })}
            </g>
          ) : chartMode === "flow" && pricePath ? (
            <>
              <path
                d={pricePath}
                fill="none"
                stroke="rgba(226,232,240,0.72)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {cvdValues.length > 1 ? (
                <path
                  d={createPath(cvdValues, innerWidth, chartHeight - chartPadding.top - chartPadding.bottom, cvdRange.min, cvdRange.range)
                    .replace(/([ML])([0-9.-]+) ([0-9.-]+)/g, (_match, command, x, y) =>
                      `${command}${(Number(x) + chartPadding.left).toFixed(2)} ${(Number(y) + chartPadding.top).toFixed(2)}`
                    )}
                  fill="none"
                  stroke="rgba(56,189,248,0.86)"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {oiValues.length > 1 ? (
                <path
                  d={createPath(oiValues, innerWidth, chartHeight - chartPadding.top - chartPadding.bottom, oiRange.min, oiRange.range)
                    .replace(/([ML])([0-9.-]+) ([0-9.-]+)/g, (_match, command, x, y) =>
                      `${command}${(Number(x) + chartPadding.left).toFixed(2)} ${(Number(y) + chartPadding.top).toFixed(2)}`
                    )}
                  fill="none"
                  stroke="rgba(250,204,21,0.78)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <text x={chartPadding.left + 10} y={chartPadding.top + 20} fill="rgba(56,189,248,0.86)" fontSize="12">
                Order Flow
              </text>
              <text x={chartPadding.left + 54} y={chartPadding.top + 20} fill="rgba(250,204,21,0.78)" fontSize="12">
                Open Interest
              </text>
            </>
          ) : pricePath ? (
            <>
              <path
                d={`${pricePath} L${chartWidth - chartPadding.right} ${chartHeight - chartPadding.bottom} L${chartPadding.left} ${chartHeight - chartPadding.bottom} Z`}
                fill="rgba(56,189,248,0.08)"
              />
              <path
                d={pricePath}
                fill="none"
                stroke={priceDeltaPct >= 0 ? "rgba(74,222,128,0.92)" : "rgba(248,113,113,0.92)"}
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : (
            <text x="50%" y="48%" textAnchor="middle" fill="rgba(148,163,184,0.72)" fontSize="14">
              {hasBackendCandles ? "waiting for more backend candles" : "waiting for more price snapshots"}
            </text>
          )}

          <line
            x1={chartPadding.left}
            x2={chartWidth - chartPadding.right}
            y1={lastY}
            y2={lastY}
            stroke="rgba(226,232,240,0.42)"
            strokeDasharray="3 6"
            strokeWidth="1"
          />
          <circle
            cx={chartWidth - chartPadding.right}
            cy={lastY}
            r="5"
            fill={priceDeltaPct >= 0 ? "rgb(74,222,128)" : "rgb(248,113,113)"}
          />
          <text x={chartWidth - chartPadding.right + 12} y={lastY - 10} fill="rgb(226,232,240)" fontSize="12">
            Last {formatPrice(price)}
          </text>

          <text x={chartPadding.left} y={22} fill="rgba(148,163,184,0.8)" fontSize="12">
            High {formatPrice(priceRange.max)}
          </text>
          <text x={chartPadding.left} y={chartHeight - 10} fill="rgba(148,163,184,0.8)" fontSize="12">
            Low {formatPrice(priceRange.min)}
          </text>

          {hoverState && hoveredPoint ? (
            <g>
              <line
                x1={hoverState.x}
                x2={hoverState.x}
                y1={chartPadding.top}
                y2={chartHeight - chartPadding.bottom}
                stroke="rgba(226,232,240,0.35)"
                strokeDasharray="4 5"
              />
              <line
                x1={chartPadding.left}
                x2={chartWidth - chartPadding.right}
                y1={priceToY(hoverState.price, priceRange.min, priceRange.range)}
                y2={priceToY(hoverState.price, priceRange.min, priceRange.range)}
                stroke="rgba(226,232,240,0.3)"
                strokeDasharray="4 5"
              />
              <circle cx={hoverState.x} cy={hoverState.y} r="5" fill="rgb(226,232,240)" />
              <g transform={`translate(${clamp(hoverState.x + 14, chartPadding.left, chartWidth - 282)} ${clamp(hoverState.y - 86, chartPadding.top, chartHeight - 158)})`}>
                <rect width="268" height="138" rx="8" fill="rgba(15,23,42,0.96)" stroke="rgba(148,163,184,0.24)" />
                <text x="12" y="22" fill="rgba(226,232,240,0.95)" fontSize="12" fontWeight="700">
                  Price {formatPrice(hoverState.price)}
                </text>
                <text x="12" y="42" fill="rgba(148,163,184,0.9)" fontSize="11">
                  {new Date(hoveredPoint.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </text>
                <text x="12" y="62" fill="rgba(148,163,184,0.9)" fontSize="11">
                  OHLC {hoveredCandle ? `${formatPrice(hoveredCandle.open)} / ${formatPrice(hoveredCandle.high)} / ${formatPrice(hoveredCandle.low)} / ${formatPrice(hoveredCandle.close)}` : "--"}
                </text>
                <text x="12" y="80" fill="rgba(148,163,184,0.9)" fontSize="11">
                  Vol {compactUsd(hoveredCandle?.volume ?? hoveredPoint.volume)}
                </text>
                <text x="12" y="98" fill="rgba(148,163,184,0.9)" fontSize="11">
                  Order Flow (CVD) {hoveredPoint.cvd !== null ? compactUsd(hoveredPoint.cvd) : "--"} / Open Interest (OI) {hoveredPoint.oi !== null ? formatMaybeNumber(hoveredPoint.oi, 0) : "--"}
                </text>
                <text x="12" y="118" fill="rgba(250,204,21,0.9)" fontSize="11">
                  click ref / Shift SL / Alt TP
                </text>
              </g>
            </g>
          ) : null}

          <g transform={`translate(${chartPadding.left} ${chartHeight + 6})`}>
            {history.map((point, index) => {
              const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
              const barWidth = Math.max(innerWidth / Math.max(history.length, 1) - 2, 2);
              const x = index * (innerWidth / Math.max(history.length, 1));
              const height = Math.max((point.volume / maxVolume) * (volumeStripHeight - 20), 2);
              const previous = history[index - 1]?.price ?? point.price;

              return (
                <rect
                  key={`${point.timestamp}-${index}`}
                  x={x}
                  y={volumeStripHeight - height}
                  width={barWidth}
                  height={height}
                  rx="1"
                  fill={point.price >= previous ? "rgba(74,222,128,0.5)" : "rgba(248,113,113,0.5)"}
                />
              );
            })}
            <text x="0" y="12" fill="rgba(148,163,184,0.82)" fontSize="11">
              Volume strip
            </text>
          </g>
        </svg>
        {clickMenu ? (
          <div
            className="absolute z-10 w-[178px] rounded-lg border border-white/10 bg-slate-950/95 p-2 shadow-panel"
            style={{ left: clickMenu.x, top: clickMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              {formatPrice(clickMenu.price)}
            </div>
            <div className="mt-2 grid gap-1">
              <button
                type="button"
                onClick={() => applyTicketEdit("reference", clickMenu.price)}
                className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-left text-xs text-accent"
              >
                Set reference
              </button>
              <button
                type="button"
                onClick={() => applyTicketEdit("stopLoss", clickMenu.price)}
                className="rounded-md border border-negative/30 bg-negative/10 px-2 py-1 text-left text-xs text-negative"
              >
                Set SL
              </button>
              <button
                type="button"
                onClick={() => applyTicketEdit("takeProfit", clickMenu.price)}
                className="rounded-md border border-positive/30 bg-positive/10 px-2 py-1 text-left text-xs text-positive"
              >
                Set TP
              </button>
            </div>
            <div className="mt-2 text-[10px] leading-4 text-slate-500">
              Chart edits execution levels only. Orders are sent only from Execution.
            </div>
          </div>
        ) : null}
      </div>
      <ContextRail
        row={row}
        funding={funding}
        positionCapacity={positionCapacity}
        safeToAddLabel={safeToAddLabel}
        riskLabel={riskLabel}
      />
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-[repeat(5,minmax(0,1fr))]">
        <MiniStrip label="Volume impulse" value={formatMaybeNumber(row.volumeImpulse, 2)} tone={stripTone(row.volumeImpulse - 1)} />
        <MiniStrip
          label="Order Flow (CVD)"
          value={flow ? compactUsd(flow.cvd.value) : "--"}
          tone={stripTone(flow?.cvd.slope)}
          detail={explainFlowState({
            slope: flow?.cvd.slope,
            divergence: flow?.cvd.divergence
          })}
        />
        <MiniStrip
          label="Open Interest (OI)"
          value={openInterestStripValue}
          tone={isFreshOpenInterest(flow) ? stripTone(flow?.openInterest.oiChange5m) : stripTone(undefined)}
          detail={explainOpenInterestState({
            status: flow?.openInterest.status ?? null,
            changePct: flow?.openInterest.oiChange5m,
            ageMs: flow?.openInterest.ageMs,
            hasFlow: Boolean(flow)
          })}
        />
        <MiniStrip label="Liquidations" value={liquidations ? compactUsd(liquidations.liquidations5m) : "--"} tone={stripTone(row.liquidation5m)} />
        <MiniStrip
          label="Funding Rate"
          value={funding ? formatMaybePercent(funding.fundingRate * 100, 4) : formatMaybePercent(row.fundingRate * 100, 4)}
          tone={stripTone(funding?.fundingRate ?? row.fundingRate)}
          detail={explainFundingState({
            rate: funding?.fundingRate ?? row.fundingRate
          })}
        />
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <MiniLine
          label="Order Flow (CVD) micro line"
          path={cvdPath}
          latest={cvdValues[cvdValues.length - 1] !== undefined ? compactUsd(cvdValues[cvdValues.length - 1]) : "--"}
          emptyLabel="waiting for order-flow history"
        />
        <MiniLine
          label="Open Interest (OI) micro line"
          path={oiPath}
          latest={oiValues[oiValues.length - 1] !== undefined ? formatMaybeNumber(oiValues[oiValues.length - 1], 0) : "--"}
          emptyLabel="waiting for open-interest history"
        />
      </div>

      <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
        {hasBackendCandles
          ? "Backend-owned focus-basket mini candles. Not a trading recommendation."
          : "Frontend micro-history from received snapshots. Not a trading recommendation."}
      </div>
    </PanelShell>
  );
}

function ContextRail({
  row,
  funding,
  positionCapacity,
  safeToAddLabel,
  riskLabel
}: {
  row: ScreenerRow;
  funding: FundingSymbolState | null;
  positionCapacity: PositionCapacityState | null | undefined;
  safeToAddLabel: string;
  riskLabel: string;
}) {
  const momentumLabel = `${formatPercent(row.momentum30sPct, 2)} / ${formatPercent(row.momentum2mPct, 2)}`;
  const fundingLabel = funding
    ? formatMaybePercent(funding.fundingRate * 100, 4)
    : formatMaybePercent(row.fundingRate * 100, 4);

  return (
    <aside className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
        Context Rail
      </div>
      <div className="mt-3 space-y-2">
        <RailMetric label="Score" value={row.score.toFixed(1)} tone={row.score >= 65 ? "positive" : row.score <= 35 ? "negative" : "neutral"} />
        <RailMetric label="Momentum" value={momentumLabel} tone={row.momentum2mPct >= 0 ? "positive" : "negative"} />
        <RailMetric label="Volume impulse" value={`${row.volumeImpulse.toFixed(2)}x`} tone={row.volumeImpulse >= 1.5 ? "positive" : "neutral"} />
        <RailMetric label="Spread" value={row.spreadBps !== null ? `${row.spreadBps.toFixed(2)} bps` : "--"} tone={row.spreadBps !== null && row.spreadBps > 20 ? "negative" : "neutral"} />
        <RailMetric
          label="Funding Rate"
          value={fundingLabel}
          detail={explainFundingState({ rate: funding?.fundingRate ?? row.fundingRate })}
          tone={(funding?.fundingRate ?? row.fundingRate) >= 0 ? "positive" : "negative"}
        />
        <RailMetric
          label="Risk / Position Risk"
          value={riskLabel}
          detail={
            positionCapacity?.safeToAdd === false
              ? `${explainExecutionBlocker({
                  safeToAddStatus: "BLOCKED",
                  reason: positionCapacity.reason
                })} ${positionCapacity.reason ?? ""}`.trim()
              : `${explainRiskState(row.riskLevel)} ${positionCapacity?.reason ?? safeToAddLabel}`.trim()
          }
          tone={positionCapacity?.safeToAdd === false || row.riskLevel === "CRITICAL" ? "negative" : "neutral"}
        />
      </div>
    </aside>
  );
}

function ExecutionLegend({ context }: { context: ChartExecutionContext | null | undefined }) {
  if (!context?.ticket && !context?.position) {
    return (
      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-500">
        Execution/position levels will appear here when the selected chart symbol matches Execution or a position.
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Ticket Levels</div>
        {context.ticket ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={getBiasVisual(context.ticket.side).textClass}>
              {context.ticket.side}
            </span>
            <span className="text-slate-400">{context.ticket.orderType}</span>
            <span className="text-slate-400">{context.ticket.mode}</span>
            <span className="text-accent">
              Ref {context.ticket.referencePrice ? formatPrice(context.ticket.referencePrice) : "--"}
            </span>
            <span className="text-negative">
              SL {context.ticket.stopLossPrice ? formatPrice(context.ticket.stopLossPrice) : "--"}
            </span>
            <span className="text-positive">
              TP {context.ticket.takeProfitPrice ? formatPrice(context.ticket.takeProfitPrice) : "--"}
            </span>
          </div>
        ) : (
          <div className="mt-2 text-xs text-slate-500">No planned ticket for this chart symbol.</div>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Active Position</div>
        {context.position ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={getBiasVisual(context.position.side).textClass}>
              {context.position.side}
            </span>
            <span className="text-slate-400">{context.position.source}</span>
            <span className="text-slate-200">
              Entry {context.position.entryPrice ? formatPrice(context.position.entryPrice) : "--"}
            </span>
            <span className="text-caution">
              Liq {context.position.liquidationPrice ? formatPrice(context.position.liquidationPrice) : "--"}
            </span>
            <span className="text-slate-400">
              Dist {context.position.liquidationDistancePct !== null ? formatPercent(context.position.liquidationDistancePct, 2) : "--"}
            </span>
          </div>
        ) : (
          <div className="mt-2 text-xs text-slate-500">No active position context for this chart symbol.</div>
        )}
      </div>
    </div>
  );
}

function PlanValidationMini({ context }: { context: ChartExecutionContext | null | undefined }) {
  const validation = context?.validation ?? null;

  if (!validation) {
    return null;
  }

  const sideTone =
    validation.sideConsistency === "OK"
      ? getDecisionVisual("OK").textClass
      : validation.sideConsistency === "CHECK"
        ? getDecisionVisual("WAIT").textClass
        : getBiasVisual("NEUTRAL").textClass;
  const preflightStatus = preflightBadgeStatus(validation.preflightState);

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Mini Validation
        </div>
        <StatusBadge status={validation.status}>{validation.status}</StatusBadge>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-5">
        <ValidationMetric
          label="R:R"
          value={validation.riskRewardRatio !== null ? `1:${validation.riskRewardRatio.toFixed(2)}` : "--"}
        />
        <ValidationMetric
          label="SL Dist"
          value={validation.stopDistancePct !== null ? formatPercent(validation.stopDistancePct, 2) : "--"}
        />
        <ValidationMetric
          label="TP Dist"
          value={validation.takeProfitDistancePct !== null ? formatPercent(validation.takeProfitDistancePct, 2) : "--"}
        />
        <ValidationMetric
          label="Side"
          value={validation.sideConsistency}
          className={sideTone}
        />
        <ValidationMetric
          label="Safety Check"
          value={preflightStatus}
          className={getDecisionVisual(preflightStatus).textClass}
        />
      </div>
      <div className="mt-2 text-xs leading-5 text-slate-400">
        {validation.sideConflicts.length > 0
          ? validation.sideConflicts.join(" ")
          : validation.preflightMessage}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-slate-500">
        {explainExecutionBlocker({
          preflightState: validation.preflightState
        })}
      </div>
    </div>
  );
}

function ValidationMetric({
  label,
  value,
  className = "text-slate-100"
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-xs font-semibold uppercase ${className}`}>{value}</div>
    </div>
  );
}

function RailMetric({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail?: string;
  tone: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : "text-slate-100";

  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</div>
      {detail ? <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">{detail}</div> : null}
    </div>
  );
}

function PanelShell({ subtitle, children, learningMode }: { subtitle: string; children: ReactNode; learningMode: boolean }) {
  return (
    <div className="h-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Context
          </h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <ModuleInfoButton moduleId="chart" />
      </div>
      <LearningModeHelp moduleId="chart" learningMode={learningMode} />
      <div className="mt-3">{children}</div>
    </div>
  );
}

function MiniStrip({
  label,
  value,
  tone,
  detail
}: {
  label: string;
  value: string;
  tone: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-100">{value}</div>
      {detail ? <div className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</div> : null}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full w-2/3 rounded-full ${tone}`} />
      </div>
    </div>
  );
}

function MiniLine({
  label,
  path,
  latest,
  emptyLabel
}: {
  label: string;
  path: string;
  latest: string;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className="text-xs font-semibold text-slate-200">{latest}</div>
      </div>
      <svg
        className="mt-3 h-[70px] w-full"
        viewBox={`0 0 ${miniLineWidth} ${miniLineHeight}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <line x1="0" x2={miniLineWidth} y1={miniLineHeight / 2} y2={miniLineHeight / 2} stroke="rgba(148,163,184,0.16)" />
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="rgba(56,189,248,0.82)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <text x="50%" y="52%" textAnchor="middle" fill="rgba(148,163,184,0.65)" fontSize="11">
            {emptyLabel}
          </text>
        )}
      </svg>
    </div>
  );
}
