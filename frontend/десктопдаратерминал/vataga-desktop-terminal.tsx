"use client";

import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { compactUsd, formatPercent, formatPrice } from "@/lib/format";
import {
  applyRealtimeFrameMessage,
  buildSnapshotRequestMessage,
  createRealtimeFrameTransportState,
  heavyClientFrameTransportCapabilities
} from "@/lib/realtime-frame-recovery";
import type { Bias, ScreenerAlert, ScreenerFrame, ServerMessage, SignalReplayPayload } from "@/lib/types";
import {
  alertSeverityClass,
  buildOrderBookLevels,
  buildSparklinePath,
  deltaClass,
  readHistoryDelta,
  resolveDefaultBackendWsUrl,
  scoreClass,
  scoreDeltaLabel,
  upsertHistoryPoint,
  wsHostLabel
} from "./helpers";
import { ReplayPanel } from "@/components/replay-panel";
import {
  createDefaultOrderflowSettings,
  createDefaultPaperTradingState,
  createDefaultQuoteFilters,
  loadTerminalPrefs,
  loadWorkspaceState,
  saveTerminalPrefs,
  saveWorkspaceState
} from "./storage";
import type {
  ExtendedQuoteRow,
  LayoutPreset,
  LocalTradeExecution,
  LocalTradeOrder,
  LocalTradePosition,
  NumericHistoryPoint,
  OrderflowAlertRule,
  OrderflowSettings,
  OrderflowSettingsSection,
  PaperTradingState,
  QuoteFilters,
  QuoteSortKey,
  TerminalWidgetId,
  TradingOrderSource,
  TradingOffsetMode,
  TradingOrderType,
  TradingSide,
  WorkspaceDockPosition,
  WorkspaceFloatingWindow,
  WorkspaceLayoutNode,
  WorkspaceLeafNode,
  WorkspacePane,
  WorkspaceTab,
  WorkspaceWidgetTab
} from "./types";
import {
  collectWorkspaceLeaves,
  createWorkspaceLeaf,
  createWorkspaceTab,
  createWorkspaceWidgetTab,
  syncTabPanesToLayout
} from "./workspace";

const reconnectDelayMs = 2_500;
const pingIntervalMs = 15_000;
const priceHistoryRetentionMs = 30 * 60_000;
const priceHistoryBucketMs = 5_000;
const recentScoreRetentionMs = 12 * 60_000;
const recentScoreBucketMs = 5_000;
const dailyScoreRetentionMs = 26 * 60 * 60_000;
const dailyScoreBucketMs = 5 * 60_000;
const quickNotionalOptions = [50, 100, 250, 500, 1000];
const maxVisibleOrders = 8;
const maxVisibleExecutions = 12;
const maxRetainedLocalOrders = 80;
const maxRetainedExecutions = 60;
const chartWidth = 860;
const chartHeight = 320;
const chartVolumeHeight = 72;
const minTradingQuantity = 1e-9;

interface MiniCandle {
  startTimestamp: number;
  endTimestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SubmitOrderInput {
  row: ExtendedQuoteRow;
  side: TradingSide;
  type: TradingOrderType;
  source: TradingOrderSource;
  requestedPrice?: number;
  quantity?: number;
  notionalUsd?: number;
}

interface TapePrint {
  id: string;
  timestamp: number;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  notionalUsd: number;
  source: "synthetic" | "execution" | "alert";
  count: number;
  highlighted: boolean;
  muted: boolean;
}

interface ClusterBubblePoint {
  id: string;
  timestamp: number;
  price: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  deltaVolume: number;
  tradeCount: number;
}

const widgetLabels: Record<TerminalWidgetId, string> = {
  chart: "График",
  orderbook: "Стакан",
  quotes: "Котировки",
  watchlist: "Списки",
  signalTape: "Лента",
  tradePad: "Тикет",
  replay: "Replay"
};

const widgetOptions: Array<{ id: TerminalWidgetId; detail: string }> = [
  { id: "chart", detail: "Живой price action и скор на выбранном символе." },
  { id: "orderbook", detail: "Связанный стакан и spread по активной котировке." },
  { id: "quotes", detail: "Расширенная таблица с фильтрами и score-изменениями." },
  { id: "watchlist", detail: "Watchlist, active trades и focus-символы." },
  { id: "signalTape", detail: "Лента алертов и последних импульсов." },
  { id: "tradePad", detail: "Локальный торговый тикет под выбранный символ." },
  { id: "replay", detail: "Signal replay with decision chain and outcomes timeline." }
];

const layoutOptions: Array<{ id: LayoutPreset; label: string }> = [
  { id: "single", label: "1" },
  { id: "split", label: "2" },
  { id: "triple", label: "3" },
  { id: "quad", label: "4" }
];

const sortLabels: Record<QuoteSortKey, string> = {
  score: "Score",
  scoreDelta30s: "Score 30s",
  scoreDelta2m: "Score 2m",
  scoreDelta24h: "Score 24h",
  momentum30sPct: "Momentum 30s",
  momentum2mPct: "Momentum 2m",
  change24hPct: "Изм 24ч",
  volumeImpulse: "Impulse",
  liquidation5m: "Liquidation 5m",
  tradeNotional60s: "Tape 60s",
  quoteVolume24h: "Quote vol 24h",
  spreadBps: "Spread"
};

const quoteTableColumns: Array<{
  label: string;
  sortBy?: QuoteSortKey;
}> = [
  { label: "Sym" },
  { label: "Price" },
  { label: "Score", sortBy: "score" },
  { label: "S30", sortBy: "scoreDelta30s" },
  { label: "S2m", sortBy: "scoreDelta2m" },
  { label: "S24h", sortBy: "scoreDelta24h" },
  { label: "30s", sortBy: "momentum30sPct" },
  { label: "2m", sortBy: "momentum2mPct" },
  { label: "24h", sortBy: "change24hPct" },
  { label: "Impulse", sortBy: "volumeImpulse" },
  { label: "Liq 5m", sortBy: "liquidation5m" },
  { label: "Tape 60s", sortBy: "tradeNotional60s" },
  { label: "24h Vol", sortBy: "quoteVolume24h" },
  { label: "Spread", sortBy: "spreadBps" },
  { label: "Tags" },
  { label: "" }
];

const formatClockLabel = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const formatQuantity = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const absolute = Math.abs(value);

  if (absolute >= 10_000) {
    return compactUsd(value);
  }

  if (absolute >= 100) {
    return value.toFixed(2);
  }

  if (absolute >= 1) {
    return value.toFixed(3);
  }

  return value.toFixed(5);
};

const formatUsdAmount = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const prefix = value >= 0 ? "+" : "-";
  const absolute = Math.abs(value);

  if (absolute >= 1_000) {
    return `${prefix}$${compactUsd(absolute)}`;
  }

  return `${prefix}$${absolute.toFixed(2)}`;
};

const inferTickSize = (row: ExtendedQuoteRow | null): number => {
  if (!row || row.lastPrice <= 0) {
    return 0.01;
  }

  if (row.bestBid !== null && row.bestAsk !== null) {
    return Math.max(Math.abs(row.bestAsk - row.bestBid), row.lastPrice * 0.00002, 0.000001);
  }

  return Math.max(row.lastPrice * 0.00008, 0.000001);
};

const snapPriceToTick = (price: number, tickSize: number): number => {
  if (!Number.isFinite(price) || price <= 0) {
    return tickSize;
  }

  return Math.max(Math.round(price / tickSize) * tickSize, tickSize);
};

const parseNotionalUsd = (value: string): number | null => {
  const normalized = Number(value.replace(",", "."));

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  return normalized;
};

const createTradeId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getOppositeSide = (side: TradingSide): TradingSide => (side === "LONG" ? "SHORT" : "LONG");

const resolveReferencePrice = (row: ExtendedQuoteRow, side: TradingSide): number =>
  side === "LONG" ? row.bestAsk ?? row.lastPrice : row.bestBid ?? row.lastPrice;

const resolveDisplayedWorkingPrice = (
  row: ExtendedQuoteRow | null,
  paperTrading: PaperTradingState
): number | null => {
  if (!row) {
    return null;
  }

  return paperTrading.workingPrices[row.symbol] ?? resolveReferencePrice(row, paperTrading.ticketSide);
};

const resolveLimitFillPrice = (order: LocalTradeOrder, row: ExtendedQuoteRow): number | null => {
  const ask = row.bestAsk ?? row.lastPrice;
  const bid = row.bestBid ?? row.lastPrice;

  if (order.side === "LONG") {
    return ask <= order.requestedPrice ? Math.min(ask, order.requestedPrice) : null;
  }

  return bid >= order.requestedPrice ? Math.max(bid, order.requestedPrice) : null;
};

const applyExecutionToPositions = (
  positions: LocalTradePosition[],
  execution: LocalTradeExecution
): LocalTradePosition[] => {
  const signedQuantity = execution.side === "LONG" ? execution.quantity : -execution.quantity;
  const index = positions.findIndex((position) => position.symbol === execution.symbol);

  if (index < 0) {
    return [
      {
        symbol: execution.symbol,
        quantity: signedQuantity,
        avgEntryPrice: execution.price,
        realizedPnlUsd: 0,
        updatedAt: execution.createdAt
      },
      ...positions
    ];
  }

  const current = positions[index];
  const nextPositions = [...positions];
  let nextQuantity = current.quantity + signedQuantity;
  let nextAverageEntry = current.avgEntryPrice;
  let nextRealized = current.realizedPnlUsd;

  if (Math.abs(current.quantity) < minTradingQuantity || Math.sign(current.quantity) === Math.sign(signedQuantity)) {
    const totalAbs = Math.abs(current.quantity) + Math.abs(signedQuantity);
    nextAverageEntry =
      totalAbs > 0
        ? (Math.abs(current.quantity) * current.avgEntryPrice +
            Math.abs(signedQuantity) * execution.price) /
          totalAbs
        : 0;
  } else {
    const closedQuantity = Math.min(Math.abs(current.quantity), Math.abs(signedQuantity));
    nextRealized +=
      closedQuantity * (execution.price - current.avgEntryPrice) * Math.sign(current.quantity);

    if (Math.abs(nextQuantity) < minTradingQuantity) {
      nextQuantity = 0;
      nextAverageEntry = 0;
    } else if (Math.sign(nextQuantity) !== Math.sign(current.quantity)) {
      nextAverageEntry = execution.price;
    }
  }

  nextPositions[index] = {
    ...current,
    quantity: nextQuantity,
    avgEntryPrice: nextAverageEntry,
    realizedPnlUsd: nextRealized,
    updatedAt: execution.createdAt
  };

  return nextPositions
    .filter(
      (position) =>
        Math.abs(position.quantity) >= minTradingQuantity ||
        Math.abs(position.realizedPnlUsd) >= 0.01
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

const resolveOrderQuantity = (notionalUsd: number, price: number): number =>
  Math.max(notionalUsd / Math.max(price, minTradingQuantity), minTradingQuantity);

const applyOrderFill = (
  paperTrading: PaperTradingState,
  order: LocalTradeOrder,
  fillPrice: number,
  filledAt: number
): PaperTradingState => {
  const filledNotional = order.quantity * fillPrice;
  const execution: LocalTradeExecution = {
    id: createTradeId("exec"),
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    source: order.source,
    price: fillPrice,
    quantity: order.quantity,
    notionalUsd: filledNotional,
    createdAt: filledAt
  };
  const filledOrder: LocalTradeOrder = {
    ...order,
    status: "FILLED",
    price: fillPrice,
    notionalUsd: filledNotional,
    updatedAt: filledAt,
    filledAt
  };
  const hasStoredOrder = paperTrading.orders.some((existing) => existing.id === order.id);
  const nextOrders = (hasStoredOrder
    ? paperTrading.orders.map((existing) => (existing.id === order.id ? filledOrder : existing))
    : [filledOrder, ...paperTrading.orders]
  )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, maxRetainedLocalOrders);

  return {
    ...paperTrading,
    orders: nextOrders,
    positions: applyExecutionToPositions(paperTrading.positions, execution),
    executions: [execution, ...paperTrading.executions].slice(0, maxRetainedExecutions)
  };
};

const resolveUnrealizedPnlUsd = (
  position: LocalTradePosition | null,
  row: ExtendedQuoteRow | null
): number => {
  if (!position || !row || Math.abs(position.quantity) < minTradingQuantity) {
    return 0;
  }

  return position.quantity * (row.lastPrice - position.avgEntryPrice);
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
};

const buildMiniCandles = (points: NumericHistoryPoint[], baselineVolume: number): MiniCandle[] => {
  if (points.length < 2) {
    return [];
  }

  const bucketSize = Math.max(2, Math.ceil(points.length / 28));
  const candles: MiniCandle[] = [];

  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);

    if (bucket.length === 0) {
      continue;
    }

    let volume = 0;

    for (let pointIndex = 1; pointIndex < bucket.length; pointIndex += 1) {
      volume += Math.abs(bucket[pointIndex].value - bucket[pointIndex - 1].value);
    }

    candles.push({
      startTimestamp: bucket[0].timestamp,
      endTimestamp: bucket[bucket.length - 1].timestamp,
      open: bucket[0].value,
      high: Math.max(...bucket.map((point) => point.value)),
      low: Math.min(...bucket.map((point) => point.value)),
      close: bucket[bucket.length - 1].value,
      volume: volume * Math.max(bucket[0].value, 1) + baselineVolume * 0.15
    });
  }

  return candles.slice(-28);
};

const priceBandFromSeries = (candles: MiniCandle[], markers: number[]): { min: number; max: number } => {
  const values = [
    ...candles.flatMap((candle) => [candle.low, candle.high]),
    ...markers.filter((value) => Number.isFinite(value))
  ];

  if (values.length === 0) {
    return { min: 0, max: 1 };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, Math.abs(max) * 0.0025, 0.000001);

  return {
    min: min - padding,
    max: max + padding
  };
};

const formatPriceWithPrecision = (value: number, digits: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const safeDigits = clampNumber(Math.round(digits), 0, 8);
  return value.toFixed(safeDigits);
};

const resolveDepthMetric = (
  size: number,
  price: number,
  settings: OrderflowSettings
): number => (settings.general.bookInUsd ? size * price : size);

const formatDepthMetric = (
  size: number,
  price: number,
  settings: OrderflowSettings
): string => {
  const value = resolveDepthMetric(size, price, settings);

  if (!Number.isFinite(value)) {
    return "--";
  }

  if (settings.general.bookInUsd) {
    if (settings.general.minimizeVolume || value >= 10_000) {
      return `$${compactUsd(value)}`;
    }

    return `$${Math.round(value).toLocaleString("en-US")}`;
  }

  if (settings.general.minimizeVolume || value >= 10_000) {
    return compactUsd(value);
  }

  const decimals = value >= 100 ? 0 : value >= 1 ? 2 : 4;

  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

const resolveUsdEquivalent = (quantity: number, referencePrice: number): number => {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return 0;
  }

  return quantity * referencePrice;
};

const resolveQuantityFromUsdEquivalent = (valueUsd: number, referencePrice: number): number => {
  if (!Number.isFinite(valueUsd) || valueUsd <= 0 || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return 0;
  }

  return valueUsd / referencePrice;
};

const aggregateTapePrints = (
  prints: TapePrint[],
  aggregationMs: number,
  tickSize: number
): TapePrint[] => {
  if (prints.length <= 1) {
    return prints;
  }

  const aggregated: TapePrint[] = [];

  for (const print of [...prints].sort((left, right) => right.timestamp - left.timestamp)) {
    const previous = aggregated[aggregated.length - 1];

    if (
      previous &&
      previous.side === print.side &&
      Math.abs(previous.timestamp - print.timestamp) <= aggregationMs &&
      Math.abs(previous.price - print.price) <= Math.max(tickSize * 1.5, 0.000001)
    ) {
      const quantity = previous.quantity + print.quantity;
      previous.price =
        (previous.price * previous.quantity + print.price * print.quantity) /
        Math.max(quantity, minTradingQuantity);
      previous.quantity = quantity;
      previous.notionalUsd += print.notionalUsd;
      previous.count += print.count;
      previous.highlighted = previous.highlighted || print.highlighted;
      previous.muted = previous.muted && print.muted;
      continue;
    }

    aggregated.push({ ...print });
  }

  return aggregated;
};

const buildTapePrints = ({
  row,
  priceHistory,
  alerts,
  executions,
  settings
}: {
  row: ExtendedQuoteRow | null;
  priceHistory: NumericHistoryPoint[];
  alerts: ScreenerAlert[];
  executions: LocalTradeExecution[];
  settings: OrderflowSettings;
}): TapePrint[] => {
  if (!row) {
    return [];
  }

  const tickSize = inferTickSize(row);
  const largePrintThreshold = Math.max(row.tradeNotional5s * 0.75, row.tradeNotional60s / 18, 9_000);
  const historyTail = priceHistory.slice(-18);
  const syntheticPrints: TapePrint[] = historyTail.slice(1).map((point, index) => {
    const previous = historyTail[index] ?? point;
    const delta = point.value - previous.value;
    const side = delta >= 0 ? "buy" : "sell";
    const deltaWeight = Math.max(Math.abs(delta) / Math.max(tickSize, previous.value * 0.00002), 0.25);
    const notionalUsd =
      Math.max(row.tradeNotional5s * (0.3 + deltaWeight * 0.18), 250) *
      (0.82 + index / Math.max(historyTail.length, 1));
    const quantity = resolveOrderQuantity(notionalUsd, point.value);

    return {
      id: `synthetic-${point.timestamp}-${index}`,
      timestamp: point.timestamp,
      side,
      price: point.value,
      quantity,
      notionalUsd,
      source: "synthetic",
      count: 1 + Math.round(deltaWeight),
      highlighted: notionalUsd >= largePrintThreshold,
      muted: false
    };
  });

  const executionPrints: TapePrint[] = executions.slice(0, 8).map((execution, index) => ({
    id: execution.id,
    timestamp: execution.createdAt,
    side: execution.side === "LONG" ? "buy" : "sell",
    price: execution.price,
    quantity: execution.quantity,
    notionalUsd: execution.notionalUsd,
    source: "execution",
    count: 1,
    highlighted: execution.notionalUsd >= largePrintThreshold * 0.85 || index === 0,
    muted: false
  }));

  const alertPrints: TapePrint[] = alerts
    .filter((alert) => alert.symbol === row.symbol)
    .slice(0, 5)
    .map((alert, index) => {
      const side = alert.bias === "SHORT" ? "sell" : "buy";
      const priceShift = tickSize * (index - 2) * 0.45;
      const price = snapPriceToTick(row.lastPrice + priceShift, tickSize);
      const notionalUsd = Math.max(alert.notionalUsd, row.tradeNotional5s * 0.65, 1_000);

      return {
        id: alert.id,
        timestamp: alert.createdAt,
        side,
        price,
        quantity: resolveOrderQuantity(notionalUsd, price),
        notionalUsd,
        source: "alert" as const,
        count: 2,
        highlighted: true,
        muted: false
      };
    });

  const aggregated = settings.tape.aggregationEnabled
    ? aggregateTapePrints(
        [...executionPrints, ...alertPrints, ...syntheticPrints],
        Math.max(settings.tape.aggregationPeriodSeconds, 1) * 1_000,
        tickSize
      )
    : [...executionPrints, ...alertPrints, ...syntheticPrints].sort(
        (left, right) => right.timestamp - left.timestamp
      );

  return aggregated
    .filter((print) => print.quantity >= settings.tape.deleteTradeQuantityBelow)
    .map((print) => ({
      ...print,
      muted:
        print.quantity < settings.tape.hideTradeQuantityBelow ||
        print.notionalUsd < settings.tape.hideTradeValueBelowUsd
    }))
    .filter((print) => !print.muted || print.highlighted)
    .slice(0, 18);
};

const buildClusterBubblePoints = ({
  row,
  priceHistory
}: {
  row: ExtendedQuoteRow | null;
  priceHistory: NumericHistoryPoint[];
}): ClusterBubblePoint[] => {
  if (!row) {
    return [];
  }

  const candles = buildMiniCandles(priceHistory, row.tradeNotional5s).slice(-10);

  return candles.map((candle, index) => {
    const barSpan = Math.max(candle.high - candle.low, row.lastPrice * 0.00025, 0.000001);
    const candleBias = clampNumber(
      (candle.close - candle.open) / barSpan + (row.orderBookImbalance ?? 0) * 0.85,
      -1.2,
      1.2
    );
    const totalVolume = Math.max(candle.volume * candle.close, row.tradeNotional5s * 0.3);
    const buyShare = clampNumber(0.5 + candleBias * 0.18, 0.08, 0.92);
    const buyVolume = totalVolume * buyShare;
    const sellVolume = totalVolume - buyVolume;

    return {
      id: `cluster-${candle.endTimestamp}-${index}`,
      timestamp: candle.endTimestamp,
      price: candle.close,
      totalVolume,
      buyVolume,
      sellVolume,
      deltaVolume: buyVolume - sellVolume,
      tradeCount: Math.max(2, Math.round(totalVolume / Math.max(row.tradeNotional5s * 0.22, 8_000)))
    };
  });
};

type DockTabOrigin = { kind: "root"; leafId: string } | { kind: "floating"; leafId: string; windowId: string };

interface DockDropTarget {
  leafId: string;
  kind: "root" | "floating";
  position: WorkspaceDockPosition;
  windowId?: string;
}

interface FloatingWindowDragState {
  windowId: string;
  offsetX: number;
  offsetY: number;
}

interface DockTabDragState {
  origin: DockTabOrigin;
  tabId: string;
  widget: TerminalWidgetId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pointerStartX: number;
  pointerStartY: number;
  activated: boolean;
}

const cloneDockTab = (tab: WorkspaceWidgetTab): WorkspaceWidgetTab => ({
  ...tab
});

const cloneDockLeaf = (leaf: WorkspaceLeafNode): WorkspaceLeafNode => ({
  ...leaf,
  tabs: leaf.tabs.map(cloneDockTab)
});

const createDockLeaf = (
  widgetOrTabs: TerminalWidgetId | WorkspaceWidgetTab[],
  activeTabId?: string
): WorkspaceLeafNode => {
  const tabs = Array.isArray(widgetOrTabs)
    ? widgetOrTabs.map(cloneDockTab)
    : [createWorkspaceWidgetTab(widgetOrTabs)];
  const fallbackTab = tabs[0] ?? createWorkspaceWidgetTab("quotes");

  return {
    ...createWorkspaceLeaf(fallbackTab.widget),
    tabs,
    activeTabId:
      activeTabId && tabs.some((tab) => tab.id === activeTabId) ? activeTabId : fallbackTab.id
  };
};

const getLeafActiveTab = (leaf: WorkspaceLeafNode): WorkspaceWidgetTab =>
  leaf.tabs.find((tab) => tab.id === leaf.activeTabId) ?? leaf.tabs[0] ?? createWorkspaceWidgetTab("quotes");

const rootToPanesSnapshot = (root: WorkspaceLayoutNode): WorkspacePane[] =>
  collectWorkspaceLeaves(root).map((leaf) => ({
    id: leaf.id,
    widget: getLeafActiveTab(leaf).widget
  }));

const syncWorkspaceSnapshot = (tab: WorkspaceTab): WorkspaceTab => ({
  ...tab,
  panes: rootToPanesSnapshot(tab.root)
});

const findLeafInNode = (node: WorkspaceLayoutNode, leafId: string): WorkspaceLeafNode | null => {
  if (node.type === "leaf") {
    return node.id === leafId ? node : null;
  }

  for (const child of node.children) {
    const match = findLeafInNode(child, leafId);

    if (match) {
      return match;
    }
  }

  return null;
};

const findLeafByOrigin = (tab: WorkspaceTab, origin: DockTabOrigin): WorkspaceLeafNode | null =>
  origin.kind === "floating"
    ? tab.floatingWindows.find((window) => window.id === origin.windowId)?.root ?? null
    : findLeafInNode(tab.root, origin.leafId);

const findDockTargetLeaf = (tab: WorkspaceTab, target: DockDropTarget): WorkspaceLeafNode | null =>
  target.kind === "floating"
    ? tab.floatingWindows.find((window) => window.id === target.windowId)?.root ?? null
    : findLeafInNode(tab.root, target.leafId);

const collapseWorkspaceNode = (node: WorkspaceLayoutNode | null): WorkspaceLayoutNode | null => {
  if (!node) {
    return null;
  }

  if (node.type === "leaf") {
    return node.tabs.length > 0 ? node : null;
  }

  const children = node.children
    .map((child) => collapseWorkspaceNode(child))
    .filter((child): child is WorkspaceLayoutNode => child !== null);

  if (children.length === 0) {
    return null;
  }

  if (children.length === 1) {
    return children[0];
  }

  return {
    ...node,
    children,
    sizes:
      node.sizes && node.sizes.length === children.length
        ? node.sizes
        : Array.from({ length: children.length }, () => 1 / children.length)
  };
};

const updateRootLeafTabs = (
  node: WorkspaceLayoutNode,
  leafId: string,
  updater: (leaf: WorkspaceLeafNode) => WorkspaceLeafNode
): WorkspaceLayoutNode | null => {
  if (node.type === "leaf") {
    return node.id === leafId ? collapseWorkspaceNode(updater(cloneDockLeaf(node))) : node;
  }

  return collapseWorkspaceNode({
    ...node,
    children: node.children
      .map((child) => updateRootLeafTabs(child, leafId, updater))
      .filter((child): child is WorkspaceLayoutNode => child !== null)
  });
};

const replaceRootLeaf = (
  node: WorkspaceLayoutNode,
  leafId: string,
  replacement: WorkspaceLayoutNode
): WorkspaceLayoutNode => {
  if (node.type === "leaf") {
    return node.id === leafId ? replacement : node;
  }

  return {
    ...node,
    children: node.children.map((child) => replaceRootLeaf(child, leafId, replacement))
  };
};

const removeRootLeaf = (node: WorkspaceLayoutNode, leafId: string): WorkspaceLayoutNode | null => {
  if (node.type === "leaf") {
    return node.id === leafId ? null : node;
  }

  return collapseWorkspaceNode({
    ...node,
    children: node.children
      .map((child) => removeRootLeaf(child, leafId))
      .filter((child): child is WorkspaceLayoutNode => child !== null)
  });
};

const createSplitNode = (
  direction: "row" | "column",
  first: WorkspaceLayoutNode,
  second: WorkspaceLayoutNode
): WorkspaceLayoutNode => ({
  id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type: "split",
  direction,
  children: [first, second],
  sizes: [0.5, 0.5]
});

const resolveSplitDirectionForDropPosition = (
  position: Exclude<WorkspaceDockPosition, "center">
): "row" | "column" => (position === "left" || position === "right" ? "row" : "column");

const createDockSplitForTarget = (
  position: Exclude<WorkspaceDockPosition, "center">,
  incoming: WorkspaceLayoutNode,
  existing: WorkspaceLayoutNode
): WorkspaceLayoutNode => {
  const direction = resolveSplitDirectionForDropPosition(position);
  const incomingFirst = position === "left" || position === "top";

  return createSplitNode(direction, incomingFirst ? incoming : existing, incomingFirst ? existing : incoming);
};

const clampFloatingWindowBounds = (
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: DOMRect
) => ({
  x: Math.min(Math.max(16, x), Math.max(16, bounds.width - width - 16)),
  y: Math.min(Math.max(16, y), Math.max(16, bounds.height - height - 16))
});

const createDetachedWindowTitle = (widget: TerminalWidgetId): string => {
  const option = widgetOptions.find(({ id }) => id === widget);

  return option ? `${widgetLabels[option.id]} Window` : "Detached Window";
};

const matchesOrderflowAlertRule = (
  print: TapePrint,
  rule: OrderflowAlertRule
): boolean => {
  if (!rule.enabled) {
    return false;
  }

  const value = rule.unit === "qty" ? print.quantity : print.notionalUsd;

  if (value < rule.minValue) {
    return false;
  }

  if (rule.maxValue > 0 && value > rule.maxValue) {
    return false;
  }

  return true;
};

const getSortValue = (row: ExtendedQuoteRow, sortBy: QuoteSortKey): number => {
  switch (sortBy) {
    case "scoreDelta30s":
      return row.scoreDelta30s ?? Number.NEGATIVE_INFINITY;
    case "scoreDelta2m":
      return row.scoreDelta2m ?? Number.NEGATIVE_INFINITY;
    case "scoreDelta24h":
      return row.scoreDelta24h ?? Number.NEGATIVE_INFINITY;
    case "momentum30sPct":
      return row.momentum30sPct;
    case "momentum2mPct":
      return row.momentum2mPct;
    case "change24hPct":
      return row.change24hPct;
    case "volumeImpulse":
      return row.volumeImpulse;
    case "liquidation5m":
      return row.liquidation5m;
    case "tradeNotional60s":
      return row.tradeNotional60s;
    case "quoteVolume24h":
      return row.quoteVolume24h;
    case "spreadBps":
      return row.spreadBps ?? Number.NEGATIVE_INFINITY;
    case "score":
    default:
      return row.score;
  }
};

const connectionTone = (state: "connecting" | "open" | "closed"): string => {
  if (state === "open") {
    return "border-emerald-400/30 bg-emerald-500/12 text-emerald-200";
  }

  if (state === "connecting") {
    return "border-amber-400/30 bg-amber-500/12 text-amber-200";
  }

  return "border-rose-400/30 bg-rose-500/12 text-rose-200";
};

const connectionLabel = (state: "connecting" | "open" | "closed"): string => {
  if (state === "open") {
    return "Feed live";
  }

  if (state === "connecting") {
    return "Подключение";
  }

  return "Offline";
};

const tagClass = (tag: string): string => {
  if (tag === "FOCUS") {
    return "border-sky-400/30 bg-sky-500/12 text-sky-100";
  }

  if (tag === "TRADE") {
    return "border-amber-400/30 bg-amber-500/12 text-amber-100";
  }

  if (tag === "WATCH") {
    return "border-emerald-400/30 bg-emerald-500/12 text-emerald-100";
  }

  return "border-white/10 bg-white/[0.05] text-slate-300";
};

export function VatagaDesktopTerminal() {
  const [workspace, setWorkspace] = useState(() => loadWorkspaceState());
  const [filters, setFilters] = useState<QuoteFilters>(createDefaultQuoteFilters);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [activeTrades, setActiveTrades] = useState<string[]>([]);
  const [backendWsUrl, setBackendWsUrl] = useState(resolveDefaultBackendWsUrl);
  const [frame, setFrame] = useState<ScreenerFrame | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [clockLabel, setClockLabel] = useState(() => formatClockLabel(Date.now()));
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [paperTrading, setPaperTrading] = useState<PaperTradingState>(createDefaultPaperTradingState);
  const [orderflowSettings, setOrderflowSettings] = useState<OrderflowSettings>(
    createDefaultOrderflowSettings
  );
  const [settingsSection, setSettingsSection] =
    useState<OrderflowSettingsSection>("general");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [floatingWindowDrag, setFloatingWindowDrag] = useState<FloatingWindowDragState | null>(
    null
  );
  const [dockTabDrag, setDockTabDrag] = useState<DockTabDragState | null>(null);
  const [dockDropTarget, setDockDropTarget] = useState<DockDropTarget | null>(null);
  const [replaySignalId, setReplaySignalId] = useState<string | null>(null);
  const [replayData, setReplayData] = useState<SignalReplayPayload | null>(null);
  const [replayStatus, setReplayStatus] = useState<"idle" | "loading" | "error" | "loaded">("idle");
  const [replayError, setReplayError] = useState<string | null>(null);

  const requestSignalReplay = (signalId: string) => {
    setReplaySignalId(signalId);
    setReplayStatus("loading");
    setReplayError(null);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "request_signal_replay",
          signalId
        })
      );
    }
  };

  const deferredSearch = useDeferredValue(filters.search);

  const workspaceSurfaceRef = useRef<HTMLDivElement | null>(null);
  const dockDropTargetRef = useRef<DockDropTarget | null>(null);
  const dockTabDragRef = useRef<DockTabDragState | null>(null);
  const frameRef = useRef<ScreenerFrame | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const frameTransportRef = useRef(createRealtimeFrameTransportState());
  const watchlistRef = useRef(watchlist);
  const activeTradesRef = useRef(activeTrades);
  const priceHistoryRef = useRef<Map<string, NumericHistoryPoint[]>>(new Map());
  const recentScoreHistoryRef = useRef<Map<string, NumericHistoryPoint[]>>(new Map());
  const dailyScoreHistoryRef = useRef<Map<string, NumericHistoryPoint[]>>(new Map());

  useEffect(() => {
    const prefs = loadTerminalPrefs();

    if (prefs) {
      setFilters(prefs.filters);
      setWatchlist(prefs.watchlist);
      setActiveTrades(prefs.activeTrades);
      setBackendWsUrl(prefs.backendWsUrl || resolveDefaultBackendWsUrl());
      setPaperTrading(prefs.paperTrading);
      setOrderflowSettings(prefs.orderflowSettings);
    }

    setStorageHydrated(true);
  }, []);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  useEffect(() => {
    activeTradesRef.current = activeTrades;
  }, [activeTrades]);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockLabel(formatClockLabel(Date.now()));
    }, 1_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    saveWorkspaceState(workspace);
  }, [storageHydrated, workspace]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    saveTerminalPrefs({
      backendWsUrl,
      watchlist,
      activeTrades,
      filters,
      paperTrading,
      orderflowSettings
    });
  }, [
    activeTrades,
    backendWsUrl,
    filters,
    orderflowSettings,
    paperTrading,
    storageHydrated,
    watchlist
  ]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const clearTimers = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const sendSocketMessage = (message: unknown) => {
      const socket = socketRef.current;

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify(message));
    };

    const ingestFrame = (nextFrame: ScreenerFrame) => {
      if (!nextFrame.rows) {
        return;
      }

      for (const row of nextFrame.rows) {
        upsertHistoryPoint(
          priceHistoryRef.current,
          row.symbol,
          nextFrame.generatedAt,
          row.lastPrice,
          priceHistoryRetentionMs,
          priceHistoryBucketMs
        );
        upsertHistoryPoint(
          recentScoreHistoryRef.current,
          row.symbol,
          nextFrame.generatedAt,
          row.score,
          recentScoreRetentionMs,
          recentScoreBucketMs
        );
        upsertHistoryPoint(
          dailyScoreHistoryRef.current,
          row.symbol,
          nextFrame.generatedAt,
          row.score,
          dailyScoreRetentionMs,
          dailyScoreBucketMs
        );
      }
    };

    const connect = () => {
      setConnectionState("connecting");
      frameTransportRef.current = createRealtimeFrameTransportState();
      const socket = new WebSocket(backendWsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled) {
          socket.close();
          return;
        }

        setConnectionState("open");
        sendSocketMessage({
          type: "hello",
          payload: {
            capabilities: heavyClientFrameTransportCapabilities
          }
        });
        sendSocketMessage(
          buildSnapshotRequestMessage(frameTransportRef.current, "initial_connect")
        );
        sendSocketMessage({
          type: "set_watchlist",
          payload: {
            symbols: watchlistRef.current
          }
        });
        sendSocketMessage({
          type: "set_active_trades",
          payload: {
            symbols: activeTradesRef.current
          }
        });

        pingTimer = window.setInterval(() => {
          sendSocketMessage({
            type: "ping",
            payload: {
              sentAt: Date.now()
            }
          });
        }, pingIntervalMs);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          const frameUpdate = applyRealtimeFrameMessage(
            frameTransportRef.current,
            frameRef.current,
            message
          );

          if (frameUpdate) {
            frameTransportRef.current = frameUpdate.nextState;

            if (frameUpdate.requestSnapshot) {
              sendSocketMessage(frameUpdate.requestSnapshot);
            }

            if (frameUpdate.applied && frameUpdate.nextFrame) {
              frameRef.current = frameUpdate.nextFrame;
              ingestFrame(frameUpdate.nextFrame);
              setFrame(frameUpdate.nextFrame);
            }

            return;
          }

          if (message.type === "pong") {
            setLatencyMs(Math.max(message.receivedAt - message.sentAt, 0));
          }

          if (message.type === "signal_replay") {
            setReplayData(message.payload);
            setReplayStatus("loaded");
            setReplayError(null);
          }
        } catch {
          // Ignore malformed payloads; the UI continues rendering the last valid frame.
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        clearTimers();

        if (cancelled) {
          return;
        }

        frameTransportRef.current = createRealtimeFrameTransportState();
        setConnectionState("closed");
        reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimers();
      const socket = socketRef.current;

      if (socket) {
        socket.close();
      }

      socketRef.current = null;
    };
  }, [backendWsUrl]);

  useEffect(() => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "set_watchlist",
        payload: {
          symbols: watchlist
        }
      })
    );
  }, [watchlist]);

  useEffect(() => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "set_active_trades",
        payload: {
          symbols: activeTrades
        }
      })
    );
  }, [activeTrades]);

  const activeTab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0] ?? null;

  const mutateActiveWorkspaceTab = (updater: (tab: WorkspaceTab) => WorkspaceTab) => {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId ? syncWorkspaceSnapshot(updater(tab)) : tab
      )
    }));
  };

  const resolveDockTargetFromPointer = (
    clientX: number,
    clientY: number,
    allowFloatingTarget = false
  ): DockDropTarget | null => {
    const hoveredElement = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const dockLeaf = hoveredElement?.closest<HTMLElement>("[data-dock-leaf-id]");

    if (!dockLeaf) {
      return null;
    }

    const leafId = dockLeaf.dataset.dockLeafId;
    const kind = dockLeaf.dataset.dockKind === "floating" ? "floating" : "root";
    const windowId = dockLeaf.dataset.dockWindowId;

    if (!leafId || (kind === "floating" && (!allowFloatingTarget || !windowId))) {
      return null;
    }

    if (kind === "floating") {
      return {
        leafId,
        kind,
        windowId,
        position: "center"
      };
    }

    const rect = dockLeaf.getBoundingClientRect();
    const relativeX = (clientX - rect.left) / Math.max(rect.width, 1);
    const relativeY = (clientY - rect.top) / Math.max(rect.height, 1);
    const leftDistance = relativeX;
    const rightDistance = 1 - relativeX;
    const topDistance = relativeY;
    const bottomDistance = 1 - relativeY;
    const nearestEdge = Math.min(leftDistance, rightDistance, topDistance, bottomDistance);
    const edgeThreshold = 0.24;
    let position: WorkspaceDockPosition = "center";

    if (nearestEdge <= edgeThreshold) {
      if (nearestEdge === leftDistance) {
        position = "left";
      } else if (nearestEdge === rightDistance) {
        position = "right";
      } else if (nearestEdge === topDistance) {
        position = "top";
      } else {
        position = "bottom";
      }
    }

    return {
      leafId,
      kind,
      position
    };
  };

  const activateLeafTab = (origin: DockTabOrigin, tabId: string) => {
    mutateActiveWorkspaceTab((tab) => {
      if (origin.kind === "floating") {
        return {
          ...tab,
          floatingWindows: tab.floatingWindows.map((window) =>
            window.id === origin.windowId
              ? {
                  ...window,
                  root: {
                    ...window.root,
                    activeTabId: tabId
                  }
                }
              : window
          )
        };
      }

      const nextRoot =
        updateRootLeafTabs(tab.root, origin.leafId, (leaf) => ({
          ...leaf,
          activeTabId: tabId
        })) ?? tab.root;

      return {
        ...tab,
        root: nextRoot
      };
    });
  };

  const setLeafWidget = (origin: DockTabOrigin, widget: TerminalWidgetId) => {
    mutateActiveWorkspaceTab((tab) => {
      if (origin.kind === "floating") {
        return {
          ...tab,
          floatingWindows: tab.floatingWindows.map((window) =>
            window.id === origin.windowId
              ? {
                  ...window,
                  title: createDetachedWindowTitle(widget),
                  root: {
                    ...window.root,
                    tabs: window.root.tabs.map((leafTab) =>
                      leafTab.id === window.root.activeTabId ? { ...leafTab, widget } : leafTab
                    )
                  }
                }
              : window
          )
        };
      }

      const nextRoot =
        updateRootLeafTabs(tab.root, origin.leafId, (leaf) => ({
          ...leaf,
          tabs: leaf.tabs.map((leafTab) =>
            leafTab.id === leaf.activeTabId ? { ...leafTab, widget } : leafTab
          )
        })) ?? tab.root;

      return {
        ...tab,
        root: nextRoot
      };
    });
  };

  const openFloatingWidget = (widget: TerminalWidgetId) => {
    mutateActiveWorkspaceTab((tab) => {
      const leaf = createDockLeaf(widget);
      const windowId = `float-${leaf.id}`;
      const offset = tab.floatingWindows.length * 28;

      return {
        ...tab,
        floatingWindows: [
          ...tab.floatingWindows,
          {
            id: windowId,
            title: createDetachedWindowTitle(widget),
            x: 72 + offset,
            y: 72 + offset,
            width: widget === "quotes" ? 320 : 460,
            height: widget === "chart" ? 460 : 540,
            root: leaf
          }
        ]
      };
    });
  };

  const openWorkspaceWindowPreset = () => {
    mutateActiveWorkspaceTab((tab) => {
      const nextWindows = [...tab.floatingWindows];
      const existingWidgets = new Set(
        tab.floatingWindows.map((window) => getLeafActiveTab(window.root).widget)
      );

      (["quotes", "orderbook", "chart"] as TerminalWidgetId[]).forEach((widget, index) => {
        if (existingWidgets.has(widget)) {
          return;
        }

        const leaf = createDockLeaf(widget);
        nextWindows.push({
          id: `float-${leaf.id}`,
          title: createDetachedWindowTitle(widget),
          x: 56 + index * 68,
          y: 84 + index * 42,
          width: widget === "quotes" ? 318 : 468,
          height: widget === "chart" ? 468 : 560,
          root: leaf
        });
      });

      return {
        ...tab,
        floatingWindows: nextWindows
      };
    });
  };

  const closeFloatingWindow = (windowId: string) => {
    mutateActiveWorkspaceTab((tab) => ({
      ...tab,
      floatingWindows: tab.floatingWindows.filter((window) => window.id !== windowId)
    }));
  };

  const popOutLeafActiveTab = (origin: DockTabOrigin, tabId?: string) => {
    mutateActiveWorkspaceTab((tab) => {
      const rootLeafCount = collectWorkspaceLeaves(tab.root).length;
      const windowLeaf = findLeafByOrigin(tab, origin);

      if (!windowLeaf) {
        return tab;
      }

      const activeLeafTab =
        windowLeaf.tabs.find((leafTab) => leafTab.id === tabId) ?? getLeafActiveTab(windowLeaf);
      const detachedLeaf = createDockLeaf([cloneDockTab(activeLeafTab)], activeLeafTab.id);
      const floatingWindow: WorkspaceFloatingWindow = {
        id: `float-${detachedLeaf.id}`,
        title: createDetachedWindowTitle(activeLeafTab.widget),
        x: 96 + tab.floatingWindows.length * 24,
        y: 96 + tab.floatingWindows.length * 24,
        width: activeLeafTab.widget === "quotes" ? 320 : 460,
        height: activeLeafTab.widget === "chart" ? 460 : 540,
        root: detachedLeaf
      };

      if (origin.kind === "floating") {
        const nextWindows = tab.floatingWindows
          .map((window) => {
            if (window.id !== origin.windowId) {
              return window;
            }

            const nextTabs = window.root.tabs.filter((leafTab) => leafTab.id !== activeLeafTab.id);

            if (nextTabs.length === 0) {
              return null;
            }

            return {
              ...window,
              root: {
                ...window.root,
                tabs: nextTabs,
                activeTabId: nextTabs[0].id
              }
            };
          })
          .filter((window): window is WorkspaceFloatingWindow => window !== null);

        return {
          ...tab,
          floatingWindows: [...nextWindows, floatingWindow]
        };
      }

      if (windowLeaf.tabs.length === 1 && rootLeafCount === 1) {
        return {
          ...tab,
          floatingWindows: [...tab.floatingWindows, floatingWindow]
        };
      }

      const nextRoot =
        windowLeaf.tabs.length === 1
          ? removeRootLeaf(tab.root, origin.leafId)
          : updateRootLeafTabs(tab.root, origin.leafId, (leaf) => {
              const nextTabs = leaf.tabs.filter((leafTab) => leafTab.id !== activeLeafTab.id);

              return {
                ...leaf,
                tabs: nextTabs,
                activeTabId: nextTabs[0]?.id ?? leaf.activeTabId
              };
            });

      return {
        ...tab,
        root: nextRoot ?? tab.root,
        floatingWindows: [...tab.floatingWindows, floatingWindow]
      };
    });
  };

  const dockFloatingWindow = (windowId: string, target: DockDropTarget) => {
    mutateActiveWorkspaceTab((tab) => {
      if (target.kind !== "root") {
        return tab;
      }

      const floatingWindow = tab.floatingWindows.find((window) => window.id === windowId);
      const targetLeaf = findLeafInNode(tab.root, target.leafId);

      if (!floatingWindow || !targetLeaf) {
        return tab;
      }

      const detachedLeaf = cloneDockLeaf(floatingWindow.root);
      let nextRoot = tab.root;

      if (target.position === "center") {
        nextRoot =
          updateRootLeafTabs(tab.root, target.leafId, (leaf) => ({
            ...leaf,
            tabs: [...leaf.tabs.map(cloneDockTab), ...detachedLeaf.tabs.map(cloneDockTab)],
            activeTabId: detachedLeaf.activeTabId
          })) ?? tab.root;
      } else {
        const splitNode = createDockSplitForTarget(target.position, detachedLeaf, targetLeaf);
        nextRoot = replaceRootLeaf(tab.root, target.leafId, splitNode);
      }

      return {
        ...tab,
        root: nextRoot,
        floatingWindows: tab.floatingWindows.filter((window) => window.id !== windowId)
      };
    });
  };

  const beginDockTabDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    origin: DockTabOrigin,
    leafTab: WorkspaceWidgetTab
  ) => {
    if (event.button !== 0) {
      return;
    }

    const bounds = workspaceSurfaceRef.current?.getBoundingClientRect();
    const tabBounds = event.currentTarget.getBoundingClientRect();

    if (!bounds) {
      return;
    }

    const nextDrag: DockTabDragState = {
      origin,
      tabId: leafTab.id,
      widget: leafTab.widget,
      label: widgetLabels[leafTab.widget],
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      width: tabBounds.width,
      height: tabBounds.height,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      activated: false
    };

    dockTabDragRef.current = nextDrag;
    setDockTabDrag(nextDrag);
  };

  const moveDockTab = (dragState: DockTabDragState, target: DockDropTarget) => {
    mutateActiveWorkspaceTab((tab) => {
      const sourceLeaf = findLeafByOrigin(tab, dragState.origin);

      if (!sourceLeaf) {
        return tab;
      }

      const movingTab = sourceLeaf.tabs.find((leafTab) => leafTab.id === dragState.tabId);
      const targetLeaf = findDockTargetLeaf(tab, target);

      if (!movingTab || !targetLeaf) {
        return tab;
      }

      const sameLeaf =
        dragState.origin.leafId === target.leafId &&
        dragState.origin.kind === target.kind &&
        (dragState.origin.kind === "root" || dragState.origin.windowId === target.windowId);

      if (sameLeaf && (target.position === "center" || sourceLeaf.tabs.length === 1)) {
        return tab;
      }

      let nextTab = tab;
      const detachedTab = cloneDockTab(movingTab);

      if (dragState.origin.kind === "floating") {
        const sourceWindowId = dragState.origin.windowId;

        nextTab = {
          ...nextTab,
          floatingWindows: nextTab.floatingWindows
            .map((window) => {
              if (window.id !== sourceWindowId) {
                return window;
              }

              const nextTabs = window.root.tabs.filter((leafTab) => leafTab.id !== movingTab.id);

              if (nextTabs.length === 0) {
                return null;
              }

              return {
                ...window,
                title: createDetachedWindowTitle(
                  getLeafActiveTab({
                    ...window.root,
                    tabs: nextTabs,
                    activeTabId: nextTabs[0]?.id ?? window.root.activeTabId
                  }).widget
                ),
                root: {
                  ...window.root,
                  tabs: nextTabs,
                  activeTabId:
                    window.root.activeTabId === movingTab.id
                      ? nextTabs[0]?.id ?? window.root.activeTabId
                      : window.root.activeTabId
                }
              };
            })
            .filter((window): window is WorkspaceFloatingWindow => window !== null)
        };
      } else {
        const nextRoot =
          sourceLeaf.tabs.length === 1
            ? removeRootLeaf(nextTab.root, dragState.origin.leafId)
            : updateRootLeafTabs(nextTab.root, dragState.origin.leafId, (leaf) => {
                const nextTabs = leaf.tabs.filter((leafTab) => leafTab.id !== movingTab.id);

                return {
                  ...leaf,
                  tabs: nextTabs,
                  activeTabId:
                    leaf.activeTabId === movingTab.id ? nextTabs[0]?.id ?? leaf.activeTabId : leaf.activeTabId
                };
              });

        if (!nextRoot) {
          return tab;
        }

        nextTab = {
          ...nextTab,
          root: nextRoot
        };
      }

      if (target.kind === "floating") {
        return {
          ...nextTab,
          floatingWindows: nextTab.floatingWindows.map((window) => {
            if (window.id !== target.windowId) {
              return window;
            }

            return {
              ...window,
              title: createDetachedWindowTitle(detachedTab.widget),
              root: {
                ...window.root,
                tabs: [...window.root.tabs.map(cloneDockTab), detachedTab],
                activeTabId: detachedTab.id
              }
            };
          })
        };
      }

      if (target.position === "center") {
        return {
          ...nextTab,
          root:
            updateRootLeafTabs(nextTab.root, target.leafId, (leaf) => ({
              ...leaf,
              tabs: [...leaf.tabs.map(cloneDockTab), detachedTab],
              activeTabId: detachedTab.id
            })) ?? nextTab.root
        };
      }

      const refreshedTargetLeaf = findLeafInNode(nextTab.root, target.leafId);

      if (!refreshedTargetLeaf) {
        return tab;
      }

      const detachedLeaf = createDockLeaf([detachedTab], detachedTab.id);
      const splitNode = createDockSplitForTarget(target.position, detachedLeaf, refreshedTargetLeaf);

      return {
        ...nextTab,
        root: replaceRootLeaf(nextTab.root, target.leafId, splitNode)
      };
    });
  };

  const beginFloatingWindowDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    windowId: string
  ) => {
    const bounds = workspaceSurfaceRef.current?.getBoundingClientRect();

    if (!bounds || !activeTab) {
      return;
    }

    const floatingWindow = activeTab.floatingWindows.find((window) => window.id === windowId);

    if (!floatingWindow) {
      return;
    }

    event.preventDefault();
    setFloatingWindowDrag({
      windowId,
      offsetX: event.clientX - bounds.left - floatingWindow.x,
      offsetY: event.clientY - bounds.top - floatingWindow.y
    });
  };

  useEffect(() => {
    dockDropTargetRef.current = dockDropTarget;
  }, [dockDropTarget]);

  useEffect(() => {
    dockTabDragRef.current = dockTabDrag;
  }, [dockTabDrag]);

  useEffect(() => {
    if (!floatingWindowDrag) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = workspaceSurfaceRef.current?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      setWorkspace((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => {
          if (tab.id !== current.activeTabId) {
            return tab;
          }

          return {
            ...tab,
            floatingWindows: tab.floatingWindows.map((window) => {
              if (window.id !== floatingWindowDrag.windowId) {
                return window;
              }

              const nextPosition = clampFloatingWindowBounds(
                event.clientX - bounds.left - floatingWindowDrag.offsetX,
                event.clientY - bounds.top - floatingWindowDrag.offsetY,
                window.width,
                window.height,
                bounds
              );

              return {
                ...window,
                ...nextPosition
              };
            })
          };
        })
      }));

      const dropTarget = resolveDockTargetFromPointer(event.clientX, event.clientY, false);
      setDockDropTarget(dropTarget?.kind === "root" ? dropTarget : null);
    };

    const handlePointerUp = () => {
      const dropTarget = dockDropTargetRef.current;

      if (dropTarget) {
        dockFloatingWindow(floatingWindowDrag.windowId, dropTarget);
      }

      setFloatingWindowDrag(null);
      setDockDropTarget(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dockFloatingWindow, floatingWindowDrag]);

  useEffect(() => {
    if (!dockTabDrag) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = workspaceSurfaceRef.current?.getBoundingClientRect();
      const currentDrag = dockTabDragRef.current;

      if (!bounds || !currentDrag) {
        return;
      }

      const movedEnough =
        Math.abs(event.clientX - currentDrag.pointerStartX) > 6 ||
        Math.abs(event.clientY - currentDrag.pointerStartY) > 6;
      const nextDrag = {
        ...currentDrag,
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        activated: currentDrag.activated || movedEnough
      };

      dockTabDragRef.current = nextDrag;
      setDockTabDrag(nextDrag);

      if (!nextDrag.activated) {
        setDockDropTarget(null);
        return;
      }

      setDockDropTarget(resolveDockTargetFromPointer(event.clientX, event.clientY, true));
    };

    const handlePointerUp = () => {
      const currentDrag = dockTabDragRef.current;
      const dropTarget = dockDropTargetRef.current;

      if (currentDrag?.activated && dropTarget) {
        moveDockTab(currentDrag, dropTarget);
      }

      dockTabDragRef.current = null;
      setDockTabDrag(null);
      setDockDropTarget(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dockTabDrag, moveDockTab]);

  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);
  const activeTradeSet = useMemo(() => new Set(activeTrades), [activeTrades]);

  const allRows = useMemo<ExtendedQuoteRow[]>(() => {
    if (!frame?.rows) {
      return [];
    }

    return frame.rows.map((row) => ({
      ...row,
      scoreDelta30s: readHistoryDelta(recentScoreHistoryRef.current.get(row.symbol), 30_000),
      scoreDelta2m: readHistoryDelta(recentScoreHistoryRef.current.get(row.symbol), 120_000),
      scoreDelta24h: readHistoryDelta(dailyScoreHistoryRef.current.get(row.symbol), 24 * 60 * 60_000)
    }));
  }, [frame]);

  const availableTags = useMemo(
    () =>
      Array.from(new Set(allRows.flatMap((row) => row.tags)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [allRows]
  );

  const filteredRows = useMemo(() => {
    const query = deferredSearch.trim().toUpperCase();

    return [...allRows]
      .filter((row) => row.quoteVolume24h >= filters.minQuoteVolume)
      .filter((row) => (filters.bias === "ALL" ? true : row.bias === filters.bias))
      .filter((row) => (filters.onlyFocus ? row.isFocus : true))
      .filter((row) => (filters.onlyWatchlist ? watchlistSet.has(row.symbol) : true))
      .filter((row) => (filters.onlyActiveTrades ? activeTradeSet.has(row.symbol) : true))
      .filter((row) => (filters.tag === "ALL" ? true : row.tags.includes(filters.tag)))
      .filter((row) => {
        if (!query) {
          return true;
        }

        return (
          row.symbol.includes(query) ||
          row.baseAsset.includes(query) ||
          row.tags.some((tag) => tag.toUpperCase().includes(query))
        );
      })
      .sort((left, right) => {
        const leftValue = getSortValue(left, filters.sortBy);
        const rightValue = getSortValue(right, filters.sortBy);

        if (leftValue !== rightValue) {
          return filters.sortDirection === "desc" ? rightValue - leftValue : leftValue - rightValue;
        }

        return filters.sortDirection === "desc"
          ? right.quoteVolume24h - left.quoteVolume24h
          : left.quoteVolume24h - right.quoteVolume24h;
      });
  }, [activeTradeSet, allRows, deferredSearch, filters, watchlistSet]);

  const rowsBySymbol = useMemo(() => new Map(allRows.map((row) => [row.symbol, row])), [allRows]);

  const selectedRow = useMemo(() => {
    if (!activeTab) {
      return null;
    }

    return (
      (activeTab.symbol ? rowsBySymbol.get(activeTab.symbol) ?? null : null) ??
      filteredRows[0] ??
      allRows[0] ??
      null
    );
  }, [activeTab, allRows, filteredRows, rowsBySymbol]);

  useEffect(() => {
    if (!activeTab || activeTab.symbol || !selectedRow) {
      return;
    }

    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId
          ? {
              ...tab,
              symbol: selectedRow.symbol
            }
          : tab
      )
    }));
  }, [activeTab, selectedRow]);

  useEffect(() => {
    if (!selectedRow) {
      return;
    }

    setPaperTrading((current) => {
      if (current.workingPrices[selectedRow.symbol]) {
        return current;
      }

      return {
        ...current,
        workingPrices: {
          ...current.workingPrices,
          [selectedRow.symbol]: snapPriceToTick(
            resolveReferencePrice(selectedRow, current.ticketSide),
            inferTickSize(selectedRow)
          )
        }
      };
    });
  }, [selectedRow]);

  const setWorkingPriceForSymbol = (symbol: string, price: number) => {
    const row = rowsBySymbol.get(symbol) ?? (selectedRow?.symbol === symbol ? selectedRow : null);

    if (!row) {
      return;
    }

    const nextPrice = snapPriceToTick(price, inferTickSize(row));

    setPaperTrading((current) => ({
      ...current,
      workingPrices: {
        ...current.workingPrices,
        [symbol]: nextPrice
      }
    }));
  };

  const updateTicketNotional = (value: string) => {
    setPaperTrading((current) => ({
      ...current,
      ticketNotionalUsd: value
    }));
  };

  const updateTicketSide = (value: TradingSide) => {
    setPaperTrading((current) => ({
      ...current,
      ticketSide: value
    }));
  };

  const updateTicketOrderType = (value: TradingOrderType) => {
    setPaperTrading((current) => ({
      ...current,
      ticketOrderType: value
    }));
  };

  const updateOrderflowSettings = (updater: (current: OrderflowSettings) => OrderflowSettings) => {
    setOrderflowSettings((current) => updater(current));
  };

  const resetOrderflowSettings = () => {
    setOrderflowSettings(createDefaultOrderflowSettings());
  };

  const submitOrder = ({
    row,
    side,
    type,
    source,
    requestedPrice,
    quantity,
    notionalUsd
  }: SubmitOrderInput) => {
    const orderReferencePrice =
      type === "LIMIT"
        ? snapPriceToTick(
            requestedPrice ?? resolveReferencePrice(row, side),
            inferTickSize(row)
          )
        : resolveReferencePrice(row, side);
    const resolvedQuantity =
      quantity ??
      (() => {
        const parsedNotional = notionalUsd ?? parseNotionalUsd(paperTrading.ticketNotionalUsd);

        if (parsedNotional === null) {
          return null;
        }

        return resolveOrderQuantity(parsedNotional, orderReferencePrice);
      })();

    if (resolvedQuantity === null || !Number.isFinite(resolvedQuantity) || resolvedQuantity <= 0) {
      return;
    }

    const createdAt = Date.now();
    const order: LocalTradeOrder = {
      id: createTradeId("ord"),
      symbol: row.symbol,
      side,
      type,
      status: "WORKING",
      source,
      requestedPrice: orderReferencePrice,
      price: orderReferencePrice,
      quantity: resolvedQuantity,
      notionalUsd: resolvedQuantity * orderReferencePrice,
      createdAt,
      updatedAt: createdAt,
      filledAt: null
    };

    setPaperTrading((current) => {
      if (type === "MARKET") {
        return applyOrderFill(current, order, resolveReferencePrice(row, side), createdAt);
      }

      const fillPrice = resolveLimitFillPrice(order, row);

      if (fillPrice !== null) {
        return applyOrderFill(current, order, fillPrice, createdAt);
      }

      return {
        ...current,
        workingPrices: {
          ...current.workingPrices,
          [row.symbol]: order.requestedPrice
        },
        orders: [order, ...current.orders]
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, maxRetainedLocalOrders)
      };
    });
  };

  const cancelOrder = (orderId: string) => {
    const cancelledAt = Date.now();

    setPaperTrading((current) => {
      let hasChanges = false;
      const nextOrders: LocalTradeOrder[] = current.orders.map((order) => {
        if (order.id !== orderId || order.status !== "WORKING") {
          return order;
        }

        hasChanges = true;

        return {
          ...order,
          status: "CANCELLED" as const,
          updatedAt: cancelledAt
        };
      });

      return hasChanges
        ? {
            ...current,
            orders: nextOrders.sort((left, right) => right.updatedAt - left.updatedAt)
          }
        : current;
    });
  };

  const cancelOrdersForSymbol = (symbol: string) => {
    const cancelledAt = Date.now();

    setPaperTrading((current) => {
      let hasChanges = false;
      const nextOrders: LocalTradeOrder[] = current.orders.map((order) => {
        if (order.symbol !== symbol || order.status !== "WORKING") {
          return order;
        }

        hasChanges = true;

        return {
          ...order,
          status: "CANCELLED" as const,
          updatedAt: cancelledAt
        };
      });

      return hasChanges
        ? {
            ...current,
            orders: nextOrders.sort((left, right) => right.updatedAt - left.updatedAt)
          }
        : current;
    });
  };

  const selectedWorkingPrice = resolveDisplayedWorkingPrice(selectedRow, paperTrading);
  const selectedOrders = selectedRow
    ? paperTrading.orders
        .filter((order) => order.symbol === selectedRow.symbol && order.status === "WORKING")
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, maxVisibleOrders)
    : [];
  const selectedExecutions = selectedRow
    ? paperTrading.executions
        .filter((execution) => execution.symbol === selectedRow.symbol)
        .slice(0, maxVisibleExecutions)
    : [];
  const selectedPosition =
    selectedRow
      ? paperTrading.positions.find((position) => position.symbol === selectedRow.symbol) ?? null
      : null;
  const selectedUnrealizedPnlUsd = resolveUnrealizedPnlUsd(selectedPosition, selectedRow);
  const openPaperPositions = paperTrading.positions.filter(
    (position) => Math.abs(position.quantity) >= minTradingQuantity
  );
  const paperNetPnlUsd = openPaperPositions.reduce(
    (sum, position) =>
      sum +
      position.realizedPnlUsd +
      resolveUnrealizedPnlUsd(position, rowsBySymbol.get(position.symbol) ?? null),
    0
  );
  const paperActiveSymbols = Array.from(
    new Set([
      ...paperTrading.orders
        .filter((order) => order.status === "WORKING")
        .map((order) => order.symbol),
      ...openPaperPositions.map((position) => position.symbol)
    ])
  );

  const submitTicketOrder = (
    side: TradingSide = paperTrading.ticketSide,
    type: TradingOrderType = paperTrading.ticketOrderType,
    source: TradingOrderSource = "ticket"
  ) => {
    if (!selectedRow) {
      return;
    }

    submitOrder({
      row: selectedRow,
      side,
      type,
      source,
      requestedPrice:
        type === "LIMIT"
          ? selectedWorkingPrice ?? resolveReferencePrice(selectedRow, side)
          : undefined
    });
  };

  const flattenSelectedPosition = () => {
    if (!selectedRow || !selectedPosition || Math.abs(selectedPosition.quantity) < minTradingQuantity) {
      return;
    }

    const side = selectedPosition.quantity > 0 ? "SHORT" : "LONG";
    const marketPrice = resolveReferencePrice(selectedRow, side);

    submitOrder({
      row: selectedRow,
      side,
      type: "MARKET",
      source: "flatten",
      quantity: Math.abs(selectedPosition.quantity),
      notionalUsd: Math.abs(selectedPosition.quantity) * marketPrice
    });
  };

  useEffect(() => {
    if (allRows.length === 0) {
      return;
    }

    setPaperTrading((current) => {
      const workingOrders = current.orders.filter((order) => order.status === "WORKING");

      if (workingOrders.length === 0) {
        return current;
      }

      let nextState = current;
      let hasChanges = false;

      for (const order of workingOrders) {
        const row = rowsBySymbol.get(order.symbol);

        if (!row) {
          continue;
        }

        const fillPrice = resolveLimitFillPrice(order, row);

        if (fillPrice === null) {
          continue;
        }

        nextState = applyOrderFill(nextState, order, fillPrice, row.updatedAt || Date.now());
        hasChanges = true;
      }

      return hasChanges ? nextState : current;
    });
  }, [allRows, rowsBySymbol]);

  useEffect(() => {
    if (!selectedRow) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target) || event.metaKey || event.ctrlKey) {
        return;
      }

      if (event.code.startsWith("Digit")) {
        const presetIndex = Number(event.code.replace("Digit", "")) - 1;
        const preset = quickNotionalOptions[presetIndex];

        if (preset) {
          event.preventDefault();
          updateTicketNotional(String(preset));
        }

        return;
      }

      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        const currentPrice = selectedWorkingPrice ?? resolveReferencePrice(selectedRow, paperTrading.ticketSide);
        const direction = event.code === "BracketRight" ? 1 : -1;
        event.preventDefault();
        setWorkingPriceForSymbol(
          selectedRow.symbol,
          currentPrice + inferTickSize(selectedRow) * direction
        );
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "b") {
        event.preventDefault();
        submitOrder({
          row: selectedRow,
          side: "LONG",
          type: event.shiftKey ? "LIMIT" : "MARKET",
          source: "hotkey",
          requestedPrice: selectedWorkingPrice ?? resolveReferencePrice(selectedRow, "LONG")
        });
        return;
      }

      if (key === "s") {
        event.preventDefault();
        submitOrder({
          row: selectedRow,
          side: "SHORT",
          type: event.shiftKey ? "LIMIT" : "MARKET",
          source: "hotkey",
          requestedPrice: selectedWorkingPrice ?? resolveReferencePrice(selectedRow, "SHORT")
        });
        return;
      }

      if (key === "m") {
        event.preventDefault();
        updateTicketOrderType(paperTrading.ticketOrderType === "LIMIT" ? "MARKET" : "LIMIT");
        return;
      }

      if (key === "l") {
        event.preventDefault();
        submitTicketOrder(paperTrading.ticketSide, "LIMIT", "hotkey");
        return;
      }

      if (key === "c") {
        event.preventDefault();
        cancelOrdersForSymbol(selectedRow.symbol);
        return;
      }

      if (key === "f") {
        event.preventDefault();
        flattenSelectedPosition();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    allRows.length,
    paperTrading.ticketOrderType,
    paperTrading.ticketSide,
    selectedPosition,
    selectedRow,
    selectedWorkingPrice
  ]);

  const selectedPriceHistory =
    (selectedRow ? priceHistoryRef.current.get(selectedRow.symbol) : undefined) ?? [];
  const selectedTapePrints = useMemo(
    () =>
      buildTapePrints({
        row: selectedRow,
        priceHistory: selectedPriceHistory,
        alerts: frame?.alerts ?? [],
        executions: selectedExecutions,
        settings: orderflowSettings
      }),
    [frame?.alerts, orderflowSettings, selectedExecutions, selectedPriceHistory, selectedRow]
  );
  const selectedClusterPoints = useMemo(
    () =>
      buildClusterBubblePoints({
        row: selectedRow,
        priceHistory: selectedPriceHistory
      }),
    [selectedPriceHistory, selectedRow]
  );

  const watchlistRows = useMemo(
    () => watchlist.map((symbol) => rowsBySymbol.get(symbol)).filter(Boolean) as ExtendedQuoteRow[],
    [rowsBySymbol, watchlist]
  );
  const activeTradeRows = useMemo(
    () =>
      [
        ...new Set([
          ...activeTrades,
          ...(frame?.status.accountStream.activePositions ?? []),
          ...paperActiveSymbols
        ])
      ]
        .map((symbol) => rowsBySymbol.get(symbol))
        .filter(Boolean) as ExtendedQuoteRow[],
    [activeTrades, frame?.status.accountStream.activePositions, paperActiveSymbols, rowsBySymbol]
  );
  const focusRows = useMemo(
    () => allRows.filter((row) => row.isFocus).slice(0, 12),
    [allRows]
  );

  const setActiveTabSymbol = (symbol: string) => {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId
          ? {
              ...tab,
              symbol,
              title: tab.title.startsWith("Вкладка") ? symbol : tab.title
            }
          : tab
      )
    }));
  };

  const addTab = (symbol: string | null = null) => {
    setWorkspace((current) => {
      const nextIndex = current.tabs.reduce((max, tab) => Math.max(max, Number(tab.title.replace(/\D/g, "")) || 0), 0) + 1;
      const nextTab = createWorkspaceTab(nextIndex, symbol);

      return {
        activeTabId: nextTab.id,
        tabs: [...current.tabs, nextTab]
      };
    });
  };

  const closeTab = (tabId: string) => {
    setWorkspace((current) => {
      if (current.tabs.length === 1) {
        return current;
      }

      const tabs = current.tabs.filter((tab) => tab.id !== tabId);

      return {
        activeTabId:
          current.activeTabId === tabId ? tabs[tabs.length - 1]?.id ?? tabs[0].id : current.activeTabId,
        tabs
      };
    });
  };

  const setLayout = (layout: LayoutPreset) => {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId ? syncTabPanesToLayout(tab, layout) : tab
      )
    }));
  };

  const toggleWatchlist = (symbol: string) => {
    const normalized = normalizeSymbol(symbol);

    setWatchlist((current) =>
      current.includes(normalized)
        ? current.filter((item) => item !== normalized)
        : [...current, normalized]
    );
  };

  const toggleActiveTrade = (symbol: string) => {
    const normalized = normalizeSymbol(symbol);

    setActiveTrades((current) =>
      current.includes(normalized)
        ? current.filter((item) => item !== normalized)
        : [...current, normalized]
    );
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#171a24] text-slate-100">
      <div className="flex min-h-screen flex-col bg-[#1f2331]">
        <header className="border-b border-[#454b60] bg-[#36394c]">
          <div className="flex min-h-10 items-center justify-between gap-3 px-2 pr-36">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
              <div className="flex h-7 w-7 items-center justify-center text-[#3894ff]">
                <LogoIcon />
              </div>
              <div className="hidden items-center gap-1 md:flex">
                {layoutOptions.map((layout) => (
                  <ToolbarButton
                    key={layout.id}
                    active={activeTab?.layout === layout.id}
                    title={`Layout ${layout.label}`}
                    onClick={() => setLayout(layout.id)}
                  >
                    {layout.label}
                  </ToolbarButton>
                ))}
              </div>
              <div className="mx-1 hidden h-5 w-px bg-white/10 lg:block" />
              <div className="hidden items-center gap-1 lg:flex">
                {widgetOptions
                  .filter((widget) => ["quotes", "orderbook", "chart"].includes(widget.id))
                  .map((widget) => (
                    <ToolbarButton
                      key={widget.id}
                      title={`Open ${widgetLabels[widget.id]} in window`}
                      onClick={() => openFloatingWidget(widget.id)}
                    >
                      <WidgetIcon widget={widget.id} />
                    </ToolbarButton>
                  ))}
                <ToolbarButton title="Open trading windows" onClick={openWorkspaceWindowPreset}>
                  []
                </ToolbarButton>
              </div>
              <div className="h-5 w-px bg-white/10" />
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-px">
                {workspace.tabs.map((tab) => {
                  const active = tab.id === workspace.activeTabId;
                  const label = tab.symbol ?? tab.title;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        setWorkspace((current) => ({
                          ...current,
                          activeTabId: tab.id
                        }))
                      }
                      className={`group flex shrink-0 items-center gap-2 rounded-sm border px-3 py-1.5 text-sm transition ${
                        active
                          ? "border-[#8a92b1] bg-[#10141d] text-white"
                          : "border-transparent bg-[#2a2f40] text-slate-200 hover:border-[#5f6783] hover:bg-[#222735]"
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      {workspace.tabs.length > 1 ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeTab(tab.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              closeTab(tab.id);
                            }
                          }}
                          className="text-slate-500 transition group-hover:text-slate-200"
                        >
                          x
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                <ToolbarButton title="Добавить вкладку" onClick={() => addTab()}>
                  +
                </ToolbarButton>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {selectedRow ? (
                <div className={`text-sm font-semibold ${deltaClass(selectedRow.change24hPct)}`}>
                  {selectedRow.symbol} {formatPercent(selectedRow.change24hPct, 2)}
                </div>
              ) : null}
              <StatusBadge className={connectionTone(connectionState)}>
                {connectionLabel(connectionState)}
              </StatusBadge>
              <StatusBadge>{selectedRow?.symbol ?? "Нет символа"}</StatusBadge>
              <StatusBadge>{`${paperTrading.orders.filter((order) => order.status === "WORKING").length} ord`}</StatusBadge>
              <StatusBadge>{`${openPaperPositions.length} pos`}</StatusBadge>
              <StatusBadge className={deltaClass(paperNetPnlUsd)}>
                {formatUsdAmount(paperNetPnlUsd)}
              </StatusBadge>
              <StatusBadge>{frame ? `${frame.overview.focusSymbols} focus` : "waiting"}</StatusBadge>
              <StatusBadge>{latencyMs !== null ? `${latencyMs}ms` : "..."}</StatusBadge>
              <StatusBadge>{clockLabel}</StatusBadge>
            </div>
          </div>
          <div className="hidden flex-wrap items-center gap-2 border-t border-[#44495d] bg-[#1f2433] px-2 py-1.5 sm:px-3">
            <div className="flex items-center gap-2 rounded-sm border border-[#3d4358] bg-[#141923] px-2 py-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Feed</span>
              <input
                value={backendWsUrl}
                onChange={(event) => setBackendWsUrl(event.target.value)}
                className="w-[190px] bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
                placeholder="ws://127.0.0.1:3001/ws"
              />
            </div>
            <div className="flex items-center gap-2 rounded-sm border border-[#3d4358] bg-[#141923] px-2 py-1 text-xs text-slate-300">
              <span>{wsHostLabel(backendWsUrl)}</span>
              <span className="text-slate-500">|</span>
              <span>{selectedRow ? formatPrice(selectedRow.lastPrice) : "--"}</span>
              <span className={scoreClass(selectedRow?.score ?? 50)}>
                {selectedRow ? selectedRow.score.toFixed(1) : "--"}
              </span>
              <span className={deltaClass(selectedRow?.change24hPct ?? null)}>
                {selectedRow ? formatPercent(selectedRow.change24hPct, 2) : "--"}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-sm border border-[#3d4358] bg-[#141923] px-1.5 py-1 text-xs text-slate-300">
              <button
                type="button"
                disabled={!selectedRow}
                onClick={() => selectedRow && toggleWatchlist(selectedRow.symbol)}
                className={`rounded-sm px-2 py-1 transition ${
                  selectedRow && watchlistSet.has(selectedRow.symbol)
                    ? "bg-emerald-500/18 text-emerald-200"
                    : "bg-white/[0.05] text-slate-300 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Watch
              </button>
              <button
                type="button"
                disabled={!selectedRow}
                onClick={() => selectedRow && toggleActiveTrade(selectedRow.symbol)}
                className={`rounded-sm px-2 py-1 transition ${
                  selectedRow && activeTradeSet.has(selectedRow.symbol)
                    ? "bg-amber-500/18 text-amber-200"
                    : "bg-white/[0.05] text-slate-300 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Trade
              </button>
              <button
                type="button"
                disabled={!selectedRow}
                onClick={() => selectedRow && addTab(selectedRow.symbol)}
                className="rounded-sm bg-white/[0.04] px-2 py-1 text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                New tab
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setSettingsSection("general");
                setSettingsModalOpen(true);
              }}
              className="rounded-sm border border-[#3d4358] bg-[#141923] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-[#636b84] hover:text-white"
            >
              DOM settings
            </button>
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
              <span>Watchlist {watchlist.length}</span>
              <span>Active {activeTrades.length}</span>
              <span>Pulse {frame ? frame.overview.marketPulse.toFixed(0) : "--"}</span>
            </div>
          </div>
        </header>

        {activeTab ? (
          <section className="flex-1 overflow-hidden p-0.5">
            <div className="flex h-full min-h-0 flex-col">
              <div
                ref={workspaceSurfaceRef}
                className="relative flex-1 overflow-hidden border border-[#303648] bg-[#10141d] p-0.5"
              >
                <DockWorkspaceNode
                  node={activeTab.root}
                  selectedRow={selectedRow}
                  filteredRows={filteredRows}
                  allRows={allRows}
                  watchlistRows={watchlistRows}
                  activeTradeRows={activeTradeRows}
                  focusRows={focusRows}
                  availableTags={availableTags}
                  watchlistSet={watchlistSet}
                  activeTradeSet={activeTradeSet}
                  filters={filters}
                  priceHistory={selectedPriceHistory}
                  tapePrints={selectedTapePrints}
                  clusterPoints={selectedClusterPoints}
                  orderflowSettings={orderflowSettings}
                  ticketNotional={paperTrading.ticketNotionalUsd}
                  ticketSide={paperTrading.ticketSide}
                  ticketOrderType={paperTrading.ticketOrderType}
                  workingPrice={selectedWorkingPrice}
                  orders={selectedOrders}
                  executions={selectedExecutions}
                  position={selectedPosition}
                  unrealizedPnlUsd={selectedUnrealizedPnlUsd}
                  frame={frame}
                  dragActive={floatingWindowDrag !== null || dockTabDrag?.activated === true}
                  dockDropTarget={dockDropTarget}
                  onFiltersChange={setFilters}
                  onSelectRow={(symbol) => setActiveTabSymbol(symbol)}
                  onOpenInNewTab={(symbol) => addTab(symbol)}
                  onToggleWatchlist={toggleWatchlist}
                  onToggleActiveTrade={toggleActiveTrade}
                  onWorkingPriceChange={setWorkingPriceForSymbol}
                  onTicketNotionalChange={updateTicketNotional}
                  onTicketSideChange={updateTicketSide}
                  onTicketOrderTypeChange={updateTicketOrderType}
                  onSubmitOrder={submitOrder}
                  onSubmitTicketOrder={submitTicketOrder}
                  onCancelOrder={cancelOrder}
                  onCancelOrdersForSymbol={cancelOrdersForSymbol}
                  onFlattenPosition={flattenSelectedPosition}
                  onOpenOrderflowSettings={(section = "general") => {
                    setSettingsSection(section);
                    setSettingsModalOpen(true);
                  }}
                  onActivateLeafTab={activateLeafTab}
                  replaySignalId={replaySignalId}
                  replayData={replayData}
                  replayStatus={replayStatus}
                  replayError={replayError}
                  onRequestReplay={requestSignalReplay}
                  onChangeLeafWidget={setLeafWidget}
                  onPopOutLeafTab={popOutLeafActiveTab}
                  onStartTabDrag={beginDockTabDrag}
                />
                {activeTab.floatingWindows.map((window) => (
                  <FloatingDockWindow
                    key={window.id}
                    window={window}
                    dragging={floatingWindowDrag?.windowId === window.id}
                    selectedRow={selectedRow}
                    filteredRows={filteredRows}
                    allRows={allRows}
                    watchlistRows={watchlistRows}
                    activeTradeRows={activeTradeRows}
                    focusRows={focusRows}
                    availableTags={availableTags}
                    watchlistSet={watchlistSet}
                    activeTradeSet={activeTradeSet}
                    filters={filters}
                    priceHistory={selectedPriceHistory}
                    tapePrints={selectedTapePrints}
                    clusterPoints={selectedClusterPoints}
                    orderflowSettings={orderflowSettings}
                    ticketNotional={paperTrading.ticketNotionalUsd}
                    ticketSide={paperTrading.ticketSide}
                    ticketOrderType={paperTrading.ticketOrderType}
                    workingPrice={selectedWorkingPrice}
                    orders={selectedOrders}
                    executions={selectedExecutions}
                    position={selectedPosition}
                    unrealizedPnlUsd={selectedUnrealizedPnlUsd}
                    frame={frame}
                    dragActive={dockTabDrag?.activated === true}
                    dockDropTarget={dockDropTarget}
                    onFiltersChange={setFilters}
                    onSelectRow={(symbol) => setActiveTabSymbol(symbol)}
                    onOpenInNewTab={(symbol) => addTab(symbol)}
                    onToggleWatchlist={toggleWatchlist}
                    onToggleActiveTrade={toggleActiveTrade}
                    onWorkingPriceChange={setWorkingPriceForSymbol}
                    onTicketNotionalChange={updateTicketNotional}
                    onTicketSideChange={updateTicketSide}
                    onTicketOrderTypeChange={updateTicketOrderType}
                    onSubmitOrder={submitOrder}
                    onSubmitTicketOrder={submitTicketOrder}
                    onCancelOrder={cancelOrder}
                    onCancelOrdersForSymbol={cancelOrdersForSymbol}
                    onFlattenPosition={flattenSelectedPosition}
                    onOpenOrderflowSettings={(section = "general") => {
                      setSettingsSection(section);
                      setSettingsModalOpen(true);
                    }}
                    onActivateLeafTab={activateLeafTab}
                    replaySignalId={replaySignalId}
                    replayData={replayData}
                    replayStatus={replayStatus}
                    replayError={replayError}
                    onRequestReplay={requestSignalReplay}
                    onChangeLeafWidget={setLeafWidget}
                    onPopOutLeafTab={popOutLeafActiveTab}
                    onStartTabDrag={beginDockTabDrag}
                    onClose={() => closeFloatingWindow(window.id)}
                    onStartDrag={(event) => beginFloatingWindowDrag(event, window.id)}
                  />
                ))}
                {dockTabDrag?.activated ? (
                  <div
                    className="pointer-events-none absolute z-40 rounded-md border border-cyan-300/40 bg-[#182132]/96 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100 shadow-[0_10px_24px_rgba(0,0,0,0.34)]"
                    style={{
                      left: dockTabDrag.x - dockTabDrag.width / 2,
                      top: dockTabDrag.y - dockTabDrag.height / 2
                    }}
                  >
                    {dockTabDrag.label}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
      <OrderflowSettingsModal
        open={settingsModalOpen}
        section={settingsSection}
        settings={orderflowSettings}
        referenceSymbol={selectedRow?.symbol ?? null}
        referencePrice={selectedRow?.lastPrice ?? 0}
        onClose={() => setSettingsModalOpen(false)}
        onSectionChange={setSettingsSection}
        onUpdate={updateOrderflowSettings}
        onReset={resetOrderflowSettings}
      />
    </main>
  );
}

interface DockWorkspaceNodeProps {
  node: WorkspaceLayoutNode;
  selectedRow: ExtendedQuoteRow | null;
  filteredRows: ExtendedQuoteRow[];
  allRows: ExtendedQuoteRow[];
  watchlistRows: ExtendedQuoteRow[];
  activeTradeRows: ExtendedQuoteRow[];
  focusRows: ExtendedQuoteRow[];
  availableTags: string[];
  watchlistSet: Set<string>;
  activeTradeSet: Set<string>;
  filters: QuoteFilters;
  priceHistory: NumericHistoryPoint[];
  tapePrints: TapePrint[];
  clusterPoints: ClusterBubblePoint[];
  orderflowSettings: OrderflowSettings;
  ticketNotional: string;
  ticketSide: TradingSide;
  ticketOrderType: TradingOrderType;
  workingPrice: number | null;
  orders: LocalTradeOrder[];
  executions: LocalTradeExecution[];
  position: LocalTradePosition | null;
  unrealizedPnlUsd: number;
  frame: ScreenerFrame | null;
  dragActive: boolean;
  dockDropTarget: DockDropTarget | null;
  onFiltersChange: Dispatch<SetStateAction<QuoteFilters>>;
  onSelectRow: (symbol: string) => void;
  onOpenInNewTab: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onToggleActiveTrade: (symbol: string) => void;
  onWorkingPriceChange: (symbol: string, price: number) => void;
  onTicketNotionalChange: (value: string) => void;
  onTicketSideChange: (side: TradingSide) => void;
  onTicketOrderTypeChange: (type: TradingOrderType) => void;
  onSubmitOrder: (params: SubmitOrderInput) => void;
  onSubmitTicketOrder: (
    side?: TradingSide,
    type?: TradingOrderType,
    source?: TradingOrderSource
  ) => void;
  onCancelOrder: (orderId: string) => void;
  onCancelOrdersForSymbol: (symbol: string) => void;
  onFlattenPosition: () => void;
  onOpenOrderflowSettings: (section?: OrderflowSettingsSection) => void;
  onActivateLeafTab: (origin: DockTabOrigin, tabId: string) => void;
  onChangeLeafWidget: (origin: DockTabOrigin, widget: TerminalWidgetId) => void;
  onPopOutLeafTab: (origin: DockTabOrigin, tabId?: string) => void;
  onStartTabDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    origin: DockTabOrigin,
    tab: WorkspaceWidgetTab
  ) => void;
  replaySignalId: string | null;
  replayData: SignalReplayPayload | null;
  replayStatus: "idle" | "loading" | "error" | "loaded";
  replayError: string | null;
  onRequestReplay: (signalId: string) => void;
}

function DockWorkspaceNode({
  node,
  dragActive,
  dockDropTarget,
  onActivateLeafTab,
  onChangeLeafWidget,
  onPopOutLeafTab,
  onStartTabDrag,
  ...paneProps
}: DockWorkspaceNodeProps) {
  if (node.type === "split") {
    return (
      <div
        className={`flex h-full min-h-0 min-w-0 gap-1.5 ${
          node.direction === "row" ? "flex-row" : "flex-col"
        }`}
      >
        {node.children.map((child, index) => {
          const size = node.sizes?.[index] ?? 1 / node.children.length;

          return (
            <div
              key={child.id}
              className="min-h-0 min-w-0"
              style={{
                flexBasis: `${size * 100}%`,
                flexGrow: size
              }}
            >
              <DockWorkspaceNode
                node={child}
                dragActive={dragActive}
                dockDropTarget={dockDropTarget}
                onActivateLeafTab={onActivateLeafTab}
                onChangeLeafWidget={onChangeLeafWidget}
                onPopOutLeafTab={onPopOutLeafTab}
                onStartTabDrag={onStartTabDrag}
                {...paneProps}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <DockLeafPane
      leaf={node}
      origin={{ kind: "root", leafId: node.id }}
      dragActive={dragActive}
      dockDropTarget={dockDropTarget}
      onActivateLeafTab={onActivateLeafTab}
      onChangeLeafWidget={onChangeLeafWidget}
      onPopOutLeafTab={onPopOutLeafTab}
      onStartTabDrag={onStartTabDrag}
      {...paneProps}
    />
  );
}

interface DockLeafPaneProps extends Omit<DockWorkspaceNodeProps, "node" | "dragActive" | "dockDropTarget"> {
  leaf: WorkspaceLeafNode;
  origin: DockTabOrigin;
  dragActive?: boolean;
  dockDropTarget?: DockDropTarget | null;
  floating?: boolean;
}

function DockLeafPane({
  leaf,
  origin,
  dragActive = false,
  dockDropTarget = null,
  floating = false,
  onActivateLeafTab,
  onChangeLeafWidget,
  onPopOutLeafTab,
  onStartTabDrag,
  ...paneProps
}: DockLeafPaneProps) {
  const activeLeafTab = getLeafActiveTab(leaf);
  const activeWidgetOption =
    widgetOptions.find((item) => item.id === activeLeafTab.widget) ?? widgetOptions[0];
  const dropTone =
    dockDropTarget?.leafId === leaf.id
      ? dockDropTarget.position === "center"
        ? "border-cyan-400/60 bg-cyan-400/14 text-cyan-100"
        : "border-emerald-400/60 bg-emerald-400/14 text-emerald-100"
      : "border-white/10 bg-[#0d1320]/82 text-slate-400";
  const rootDropTargets: Array<{
    position: WorkspaceDockPosition;
    className: string;
    label: string;
  }> = [
    { position: "top", className: "col-start-2 row-start-1", label: "Split Top" },
    { position: "left", className: "col-start-1 row-start-2", label: "Split Left" },
    { position: "center", className: "col-start-2 row-start-2", label: `Tab into ${widgetLabels[activeWidgetOption.id]}` },
    { position: "right", className: "col-start-3 row-start-2", label: "Split Right" },
    { position: "bottom", className: "col-start-2 row-start-3", label: "Split Bottom" }
  ];

  return (
    <section
      data-dock-leaf-id={leaf.id}
      data-dock-kind={origin.kind}
      data-dock-window-id={origin.kind === "floating" ? origin.windowId : undefined}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden rounded-[6px] border ${
        floating
          ? "border-[#454b5f] bg-[#151925] shadow-[0_14px_32px_rgba(0,0,0,0.34)]"
          : "border-[#2f3444] bg-[#161a25]"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-[#363b4d] bg-[#2e3243] px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {leaf.tabs.map((tab) => {
            const widget = widgetOptions.find((item) => item.id === tab.widget) ?? widgetOptions[0];
            const active = tab.id === leaf.activeTabId;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onActivateLeafTab(origin, tab.id)}
                onDoubleClick={() => onPopOutLeafTab(origin, tab.id)}
                onPointerDown={(event) => onStartTabDrag(event, origin, tab)}
                className={`flex shrink-0 cursor-grab items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] transition active:cursor-grabbing ${
                  active
                    ? "border-[#6d7694] bg-[#141924] text-white"
                    : "border-[#43495d] bg-[#252a39] text-slate-300 hover:text-white"
                }`}
              >
                <WidgetIcon widget={tab.widget} />
                <span>{widgetLabels[widget.id]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activeLeafTab.widget}
            onChange={(event) => onChangeLeafWidget(origin, event.target.value as TerminalWidgetId)}
            className="rounded-sm border border-[#474d61] bg-[#222736] px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-200 outline-none"
          >
            {widgetOptions.map((widget) => (
              <option key={widget.id} value={widget.id}>
                {widgetLabels[widget.id]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onPopOutLeafTab(origin)}
            className="rounded-md border border-[#474d61] bg-[#242939] px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-[#69718a] hover:text-white"
            title="Detach active tab into a floating window"
          >
            ↗
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-0.5">
        <PaneRenderer
          pane={{
            id: leaf.id,
            widget: activeLeafTab.widget
          }}
          {...paneProps}
        />
      </div>
      {dragActive ? (
        <div
          className={`pointer-events-none absolute inset-3 z-20 ${
            origin.kind === "root"
              ? "grid grid-cols-[0.9fr_1.15fr_0.9fr] grid-rows-[0.85fr_1.15fr_0.85fr] gap-2"
              : "flex items-center justify-center"
          }`}
        >
          {(origin.kind === "root"
            ? rootDropTargets
            : [
                {
                  position: "center" as WorkspaceDockPosition,
                  className: "",
                  label: `Tab into ${widgetLabels[activeWidgetOption.id]}`
                }
              ]
          ).map((target) => {
            const position = target.position;
            const active = dockDropTarget?.leafId === leaf.id && dockDropTarget.position === position;

            return (
              <div
                key={position}
                className={`${target.className} rounded-md border px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.22em] transition ${active ? dropTone : "border-white/8 bg-[#151b28]/92 text-slate-500"}`}
              >
                {target.label}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

interface FloatingDockWindowProps extends Omit<DockLeafPaneProps, "leaf" | "origin" | "floating"> {
  window: WorkspaceFloatingWindow;
  dragging: boolean;
  onClose: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  replaySignalId: string | null;
  replayData: SignalReplayPayload | null;
  replayStatus: "idle" | "loading" | "error" | "loaded";
  replayError: string | null;
  onRequestReplay: (signalId: string) => void;
}

function FloatingDockWindow({
  window,
  dragging,
  onClose,
  onStartDrag,
  ...paneProps
}: FloatingDockWindowProps) {
  return (
    <div
      className={`absolute z-30 flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-[#3b4153] bg-[#131722]/98 shadow-[0_18px_40px_rgba(0,0,0,0.42)] ${
        dragging ? "pointer-events-none opacity-90" : ""
      }`}
      style={{
        left: window.x,
        top: window.y,
        width: window.width,
        height: window.height
      }}
    >
      <div
        onPointerDown={onStartDrag}
        className="flex cursor-move items-center justify-between border-b border-[#3a4052] bg-[#2f3447] px-3 py-1.5"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{window.title}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Drag onto any pane to dock or split
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[#474d61] bg-[#242939] px-2.5 py-1 text-xs text-slate-300 transition hover:border-[#69718a] hover:text-white"
        >
          x
        </button>
      </div>
      <div className="min-h-0 flex-1 p-1.5">
        <DockLeafPane
          leaf={window.root}
          origin={{ kind: "floating", leafId: window.root.id, windowId: window.id }}
          floating
          {...paneProps}
        />
      </div>
    </div>
  );
}

function PaneRenderer({
  pane,
  selectedRow,
  filteredRows,
  allRows,
  watchlistRows,
  activeTradeRows,
  focusRows,
  availableTags,
  watchlistSet,
  activeTradeSet,
  filters,
  priceHistory,
  tapePrints,
  clusterPoints,
  orderflowSettings,
  ticketNotional,
  ticketSide,
  ticketOrderType,
  workingPrice,
  orders,
  executions,
  position,
  unrealizedPnlUsd,
  frame,
  onFiltersChange,
  onSelectRow,
  onOpenInNewTab,
  onToggleWatchlist,
  onToggleActiveTrade,
  onWorkingPriceChange,
  onTicketNotionalChange,
  onTicketSideChange,
  onTicketOrderTypeChange,
  onSubmitOrder,
  onSubmitTicketOrder,
  onCancelOrder,
  onCancelOrdersForSymbol,
  onFlattenPosition,
  onOpenOrderflowSettings,
  replaySignalId,
  replayData,
  replayStatus,
  replayError,
  onRequestReplay
}: {
  pane: WorkspacePane;
  selectedRow: ExtendedQuoteRow | null;
  filteredRows: ExtendedQuoteRow[];
  allRows: ExtendedQuoteRow[];
  watchlistRows: ExtendedQuoteRow[];
  activeTradeRows: ExtendedQuoteRow[];
  focusRows: ExtendedQuoteRow[];
  availableTags: string[];
  watchlistSet: Set<string>;
  activeTradeSet: Set<string>;
  filters: QuoteFilters;
  priceHistory: NumericHistoryPoint[];
  tapePrints: TapePrint[];
  clusterPoints: ClusterBubblePoint[];
  orderflowSettings: OrderflowSettings;
  ticketNotional: string;
  ticketSide: TradingSide;
  ticketOrderType: TradingOrderType;
  workingPrice: number | null;
  orders: LocalTradeOrder[];
  executions: LocalTradeExecution[];
  position: LocalTradePosition | null;
  unrealizedPnlUsd: number;
  frame: ScreenerFrame | null;
  onFiltersChange: Dispatch<SetStateAction<QuoteFilters>>;
  onSelectRow: (symbol: string) => void;
  onOpenInNewTab: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onToggleActiveTrade: (symbol: string) => void;
  onWorkingPriceChange: (symbol: string, price: number) => void;
  onTicketNotionalChange: (value: string) => void;
  onTicketSideChange: (value: TradingSide) => void;
  onTicketOrderTypeChange: (value: TradingOrderType) => void;
  onSubmitOrder: (input: SubmitOrderInput) => void;
  onSubmitTicketOrder: (
    side?: TradingSide,
    type?: TradingOrderType,
    source?: TradingOrderSource
  ) => void;
  onCancelOrder: (orderId: string) => void;
  onCancelOrdersForSymbol: (symbol: string) => void;
  onFlattenPosition: () => void;
  onOpenOrderflowSettings: (section?: OrderflowSettingsSection) => void;
  replaySignalId: string | null;
  replayData: SignalReplayPayload | null;
  replayStatus: "idle" | "loading" | "error" | "loaded";
  replayError: string | null;
  onRequestReplay: (signalId: string) => void;
}) {
  if (pane.widget === "chart") {
    return (
      <AdvancedChartPane
        row={selectedRow}
        priceHistory={priceHistory}
        workingPrice={workingPrice}
        ticketSide={ticketSide}
        ticketOrderType={ticketOrderType}
        orders={orders}
        position={position}
        onWorkingPriceChange={onWorkingPriceChange}
        onSubmitOrder={onSubmitOrder}
      />
    );
  }

  if (pane.widget === "orderbook") {
    return (
      <AdvancedOrderBookPane
        row={selectedRow}
        workingPrice={workingPrice}
        ticketNotional={ticketNotional}
        ticketSide={ticketSide}
        ticketOrderType={ticketOrderType}
        tapePrints={tapePrints}
        clusterPoints={clusterPoints}
        settings={orderflowSettings}
        orders={orders}
        alerts={frame?.alerts ?? []}
        position={position}
        onWorkingPriceChange={onWorkingPriceChange}
        onTicketSideChange={onTicketSideChange}
        onSubmitOrder={onSubmitOrder}
        onSubmitTicketOrder={onSubmitTicketOrder}
        onCancelOrder={onCancelOrder}
        onCancelOrdersForSymbol={onCancelOrdersForSymbol}
        onOpenSettings={onOpenOrderflowSettings}
      />
    );
  }

  if (pane.widget === "watchlist") {
    return (
      <WatchlistPane
        selectedSymbol={selectedRow?.symbol ?? null}
        watchlistRows={watchlistRows}
        activeTradeRows={activeTradeRows}
        focusRows={focusRows}
        watchlistSet={watchlistSet}
        activeTradeSet={activeTradeSet}
        onSelectRow={onSelectRow}
        onToggleWatchlist={onToggleWatchlist}
        onToggleActiveTrade={onToggleActiveTrade}
      />
    );
  }

  if (pane.widget === "signalTape") {
    return <SignalTapePane alerts={frame?.alerts ?? []} onRequestReplay={onRequestReplay} />;
  }

  if (pane.widget === "tradePad") {
    return (
      <AdvancedTradePadPane
        row={selectedRow}
        ticketNotional={ticketNotional}
        ticketSide={ticketSide}
        ticketOrderType={ticketOrderType}
        workingPrice={workingPrice}
        orders={orders}
        executions={executions}
        position={position}
        unrealizedPnlUsd={unrealizedPnlUsd}
        onTicketNotionalChange={onTicketNotionalChange}
        onTicketSideChange={onTicketSideChange}
        onTicketOrderTypeChange={onTicketOrderTypeChange}
        onWorkingPriceChange={onWorkingPriceChange}
        onSubmitTicketOrder={onSubmitTicketOrder}
        onCancelOrder={onCancelOrder}
        onCancelOrdersForSymbol={onCancelOrdersForSymbol}
        onFlattenPosition={onFlattenPosition}
      />
    );
  }

  if (pane.widget === "replay") {
    return (
      <ReplayPanel
        signalId={replaySignalId}
        replayData={replayData}
        status={replayStatus}
        error={replayError}
        onRequestReplay={onRequestReplay}
        learningMode={false}
      />
    );
  }

  return (
    <DesktopMarketQuotesPanel
      rows={filteredRows}
      selectedSymbol={selectedRow?.symbol ?? null}
      watchlistSet={watchlistSet}
      activeTradeSet={activeTradeSet}
      watchlistCount={watchlistSet.size}
      activeTradeCount={activeTradeSet.size}
      embedded
      onSelectRow={onSelectRow}
      onToggleWatchlist={onToggleWatchlist}
      onToggleActiveTrade={onToggleActiveTrade}
    />
  );
}

function DesktopMarketQuotesPanel({
  rows,
  selectedSymbol,
  watchlistSet,
  activeTradeSet,
  watchlistCount,
  activeTradeCount,
  embedded = false,
  onSelectRow,
  onToggleWatchlist,
  onToggleActiveTrade
}: {
  rows: ExtendedQuoteRow[];
  selectedSymbol: string | null;
  watchlistSet: Set<string>;
  activeTradeSet: Set<string>;
  watchlistCount: number;
  activeTradeCount: number;
  embedded?: boolean;
  onSelectRow: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onToggleActiveTrade: (symbol: string) => void;
}) {
  const positiveCount = rows.filter((row) => row.change24hPct >= 0).length;
  const negativeCount = Math.max(rows.length - positiveCount, 0);

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-[#33394b] bg-[#151923] ${
        embedded ? "h-full w-full" : "w-[320px] flex-shrink-0"
      }`}
    >
      <div className={`border-b border-[#363c4e] bg-[#2f3447] ${embedded ? "px-2 py-1.5" : "px-3 py-2"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Котировки</div>
            <div className={embedded ? "mt-0.5 text-[10px] text-slate-500" : "mt-0.5 text-xs text-slate-500"}>
              Futures board
            </div>
          </div>
          <div className="rounded-md border border-[#3a4252] bg-[#171d29] px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-slate-400">
            {rows.length}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[#394154] bg-[#151b27] text-[11px] text-slate-300">
            +
          </div>
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[#394154] bg-[#151b27] text-[11px] text-slate-300">
            =
          </div>
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[#394154] bg-[#151b27] text-[11px] text-slate-300">
            o
          </div>
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[#394154] bg-[#151b27] text-[11px] text-slate-300">
            F
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]">
            <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
              Up {positiveCount}
            </span>
            <span className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-200">
              Down {negativeCount}
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
          <span className="rounded-md border border-[#363d4d] bg-[#151b27] px-2 py-1 text-slate-300">
            Watchlist {watchlistCount}
          </span>
          <span className="rounded-md border border-[#363d4d] bg-[#151b27] px-2 py-1 text-slate-300">
            Trades {activeTradeCount}
          </span>
        </div>
      </div>
      <div
        className={`grid grid-cols-[20px_20px_minmax(0,1fr)_78px_84px] items-center gap-2 border-b border-[#2b3140] bg-[#171d29] text-[10px] uppercase tracking-[0.16em] text-slate-400 ${
          embedded ? "px-2 py-1.5" : "px-3 py-2"
        }`}
      >
        <span className="text-center">*</span>
        <span className="text-center">Бир</span>
        <span>Тикер</span>
        <span className="text-right">Изм.</span>
        <span className="text-right">Цена</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#121722]">
        {rows.map((row) => {
          const selected = selectedSymbol === row.symbol;
          const changeTone = deltaClass(row.change24hPct);

          return (
            <div
              key={row.symbol}
              className={`border-b border-[#232938] transition ${
                selected ? "bg-[#2a3140]" : "hover:bg-[#171d29]"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectRow(row.symbol)}
                className={`grid w-full grid-cols-[20px_20px_minmax(0,1fr)_78px_84px] items-center gap-2 text-left ${
                  embedded ? "px-2 py-1.5" : "px-3 py-2"
                }`}
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleWatchlist(row.symbol);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleWatchlist(row.symbol);
                    }
                  }}
                  className={`flex h-4 w-4 items-center justify-center rounded-sm border text-[9px] ${
                    watchlistSet.has(row.symbol)
                      ? "border-amber-400/40 bg-amber-400/16 text-amber-100"
                      : "border-[#3a4252] bg-[#161c28] text-slate-500"
                  }`}
                >
                  *
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleActiveTrade(row.symbol);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleActiveTrade(row.symbol);
                    }
                  }}
                  className={`relative flex h-4 w-4 items-center justify-center rounded-sm border ${
                    activeTradeSet.has(row.symbol)
                      ? "border-violet-400/40 bg-violet-500/16"
                      : "border-[#3a4252] bg-[#161c28]"
                  }`}
                >
                  <span className="absolute h-1.5 w-1.5 -translate-x-[3px] rounded-full bg-violet-400" />
                  <span className="absolute h-1.5 w-1.5 translate-x-[3px] rotate-45 bg-amber-300" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200">F</span>
                    <span className={`truncate font-medium text-white ${embedded ? "text-[11px]" : "text-sm"}`}>
                      {row.symbol}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-slate-500">
                    <span>{row.bias}</span>
                    {row.isFocus ? <span className="text-cyan-300">Focus</span> : null}
                  </div>
                </div>
                <span className={`text-right font-semibold ${embedded ? "text-[11px]" : "text-xs"} ${changeTone}`}>
                  {formatPercent(row.change24hPct, 2)}
                </span>
                <span className={`text-right font-semibold text-slate-100 ${embedded ? "text-[11px]" : "text-sm"}`}>
                  {formatPrice(row.lastPrice)}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ChartPane({
  row,
  priceHistory
}: {
  row: ExtendedQuoteRow | null;
  priceHistory: NumericHistoryPoint[];
}) {
  const width = 860;
  const height = 280;
  const path = buildSparklinePath(priceHistory, width, height);
  const firstPrice = priceHistory[0]?.value ?? row?.lastPrice ?? 0;
  const lastPrice = priceHistory[priceHistory.length - 1]?.value ?? row?.lastPrice ?? 0;
  const sessionDelta = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  return (
    <div className="flex h-full flex-col bg-[#1a1d2a]">
      {row ? (
        <>
          <div className="grid gap-3 border-b border-white/8 p-3 sm:grid-cols-4">
            <MetricTile label="Last" value={formatPrice(row.lastPrice)} className="text-white" />
            <MetricTile
              label="Score"
              value={row.score.toFixed(1)}
              className={scoreClass(row.score)}
            />
            <MetricTile
              label="Score 30s / 2m"
              value={`${scoreDeltaLabel(row.scoreDelta30s)} / ${scoreDeltaLabel(row.scoreDelta2m)}`}
              className={deltaClass(row.scoreDelta30s)}
            />
            <MetricTile
              label="24h / Funding"
              value={`${formatPercent(row.change24hPct, 2)} / ${formatPercent(row.fundingRate, 3)}`}
              className={deltaClass(row.change24hPct)}
            />
          </div>
          <div className="flex-1 p-3">
            {path ? (
              <div className="h-full rounded-md border border-white/8 bg-[linear-gradient(180deg,rgba(34,40,60,0.92),rgba(15,18,26,0.92))] p-4">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.16em] text-slate-400">
                  <span>{row.symbol}</span>
                  <span className={deltaClass(sessionDelta)}>{formatPercent(sessionDelta, 2)} session</span>
                </div>
                <svg
                  viewBox={`0 0 ${width} ${height}`}
                  className="mt-4 h-[calc(100%-4rem)] w-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="chart-stroke" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#7ab2ff" />
                      <stop offset="100%" stopColor="#9df3d1" />
                    </linearGradient>
                  </defs>
                  <path d={path} fill="none" stroke="url(#chart-stroke)" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <div className="grid gap-2 pt-3 text-xs text-slate-300 sm:grid-cols-3">
                  <span>Momentum 30s {formatPercent(row.momentum30sPct, 2)}</span>
                  <span>Momentum 2m {formatPercent(row.momentum2mPct, 2)}</span>
                  <span>Quote vol {compactUsd(row.quoteVolume24h)}</span>
                </div>
              </div>
            ) : (
              <EmptyPane
                title="Недостаточно истории"
                description="Подождите несколько апдейтов, и здесь появится живая микроистория по выбранному символу."
              />
            )}
          </div>
        </>
      ) : (
        <EmptyPane
          title="Символ не выбран"
          description="Кликните по котировке или по элементу watchlist, чтобы привязать график."
        />
      )}
    </div>
  );
}

function OrderBookPane({ row }: { row: ExtendedQuoteRow | null }) {
  const levels = buildOrderBookLevels(row);
  const spreadLabel =
    row && row.bestBid !== null && row.bestAsk !== null
      ? `${formatPrice(row.bestAsk - row.bestBid)} | ${row.spreadBps?.toFixed(2) ?? "--"} bps`
      : "--";

  return (
    <div className="flex h-full flex-col bg-[#1a1d2a]">
      {row ? (
        <>
          <div className="grid gap-3 border-b border-white/8 p-3 sm:grid-cols-3">
            <MetricTile label="Spread" value={spreadLabel} className="text-white" />
            <MetricTile
              label="Imbalance"
              value={row.orderBookImbalance !== null ? row.orderBookImbalance.toFixed(3) : "--"}
              className={deltaClass(row.orderBookImbalance ?? null)}
            />
            <MetricTile
              label="Tape 5s / 60s"
              value={`${compactUsd(row.tradeNotional5s)} / ${compactUsd(row.tradeNotional60s)}`}
              className="text-slate-100"
            />
          </div>
          <div className="flex-1 overflow-auto p-3">
            <div className="rounded-md border border-white/8 bg-[#0f131c]/90">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-white/8 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <span>Depth</span>
                <span>Size</span>
                <span>Price</span>
              </div>
              <div className="space-y-px bg-white/5 p-px">
                {levels.asks.map((level) => (
                  <OrderBookRow key={`ask-${level.price}`} level={level} />
                ))}
                <div className="grid grid-cols-1 border-y border-white/8 bg-[#202536] px-4 py-2 text-center text-sm font-semibold text-white">
                  {formatPrice(row.lastPrice)}
                </div>
                {levels.bids.map((level) => (
                  <OrderBookRow key={`bid-${level.price}`} level={level} />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <EmptyPane
          title="Стакан ждёт привязки"
          description="Выберите символ в котировках или в watchlist, чтобы построить связанный стакан."
        />
      )}
    </div>
  );
}

function QuotesPane({
  rows,
  allRows,
  availableTags,
  filters,
  selectedSymbol,
  watchlistSet,
  activeTradeSet,
  onFiltersChange,
  onSelectRow,
  onOpenInNewTab,
  onToggleWatchlist,
  onToggleActiveTrade
}: {
  rows: ExtendedQuoteRow[];
  allRows: ExtendedQuoteRow[];
  availableTags: string[];
  filters: QuoteFilters;
  selectedSymbol: string | null;
  watchlistSet: Set<string>;
  activeTradeSet: Set<string>;
  onFiltersChange: Dispatch<SetStateAction<QuoteFilters>>;
  onSelectRow: (symbol: string) => void;
  onOpenInNewTab: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onToggleActiveTrade: (symbol: string) => void;
}) {
  const handleColumnSort = (sortBy: QuoteSortKey) => {
    onFiltersChange((current) => ({
      ...current,
      sortBy,
      sortDirection:
        current.sortBy === sortBy
          ? current.sortDirection === "desc"
            ? "asc"
            : "desc"
          : "desc"
    }));
  };

  return (
    <div className="flex h-full flex-col bg-[#1a1d2a]">
      <div className="border-b border-white/8 p-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.7fr))]">
          <input
            value={filters.search}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                search: event.target.value
              }))
            }
            placeholder="Поиск symbol / tag"
            className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
          />
          <select
            value={filters.sortBy}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                sortBy: event.target.value as QuoteSortKey
              }))
            }
            className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            {Object.entries(sortLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={filters.bias}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                bias: event.target.value as QuoteFilters["bias"]
              }))
            }
            className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="ALL">Bias: All</option>
            <option value="LONG">Bias: Long</option>
            <option value="SHORT">Bias: Short</option>
            <option value="NEUTRAL">Bias: Neutral</option>
          </select>
          <input
            type="number"
            min={0}
            step={100000}
            value={filters.minQuoteVolume}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                minQuoteVolume: Number(event.target.value || 0)
              }))
            }
            className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none"
          />
          <button
            type="button"
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                sortDirection: current.sortDirection === "desc" ? "asc" : "desc"
              }))
            }
            className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 transition hover:border-white/20"
          >
            {filters.sortDirection === "desc" ? "DESC" : "ASC"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <QuickToggle
            active={filters.onlyFocus}
            label="Focus"
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                onlyFocus: !current.onlyFocus
              }))
            }
          />
          <QuickToggle
            active={filters.onlyWatchlist}
            label="Watchlist"
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                onlyWatchlist: !current.onlyWatchlist
              }))
            }
          />
          <QuickToggle
            active={filters.onlyActiveTrades}
            label="Trades"
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                onlyActiveTrades: !current.onlyActiveTrades
              }))
            }
          />
          <div className="mx-1 h-5 w-px bg-white/10" />
          <QuickToggle
            active={filters.tag === "ALL"}
            label="All tags"
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                tag: "ALL"
              }))
            }
          />
          {availableTags.slice(0, 8).map((tag) => (
            <QuickToggle
              key={tag}
              active={filters.tag === tag}
              label={tag}
              onClick={() =>
                onFiltersChange((current) => ({
                  ...current,
                  tag: current.tag === tag ? "ALL" : tag
                }))
              }
            />
          ))}
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
            <span>
              Sort: {sortLabels[filters.sortBy]} {filters.sortDirection.toUpperCase()}
            </span>
            <span>
              {rows.length} / {allRows.length} symbols
            </span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-[1260px] text-sm">
          <thead className="sticky top-0 z-10 bg-[#181b27] text-[11px] uppercase tracking-[0.16em] text-slate-500">
            <tr>
              {quoteTableColumns.map((column) => (
                <HeaderCell
                  key={column.label || "actions"}
                  active={column.sortBy === filters.sortBy}
                  sortDirection={filters.sortDirection}
                  onClick={
                    column.sortBy
                      ? () => handleColumnSort(column.sortBy as QuoteSortKey)
                      : undefined
                  }
                >
                  {column.label}
                </HeaderCell>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedSymbol === row.symbol;

              return (
                <tr
                  key={row.symbol}
                  onClick={() => onSelectRow(row.symbol)}
                  onDoubleClick={() => onOpenInNewTab(row.symbol)}
                  className={`cursor-pointer border-b border-white/6 transition ${
                    selected ? "bg-sky-500/10" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <Cell className="font-semibold text-white">
                    <div className="flex items-center gap-2">
                      <span>{row.symbol}</span>
                      {row.isFocus ? (
                        <span className="rounded-full border border-sky-400/30 bg-sky-500/12 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-sky-100">
                          focus
                        </span>
                      ) : null}
                    </div>
                  </Cell>
                  <Cell>{formatPrice(row.lastPrice)}</Cell>
                  <Cell className={scoreClass(row.score)}>{row.score.toFixed(1)}</Cell>
                  <Cell className={deltaClass(row.scoreDelta30s)}>{scoreDeltaLabel(row.scoreDelta30s)}</Cell>
                  <Cell className={deltaClass(row.scoreDelta2m)}>{scoreDeltaLabel(row.scoreDelta2m)}</Cell>
                  <Cell className={deltaClass(row.scoreDelta24h)}>{scoreDeltaLabel(row.scoreDelta24h)}</Cell>
                  <Cell className={deltaClass(row.momentum30sPct)}>{formatPercent(row.momentum30sPct, 2)}</Cell>
                  <Cell className={deltaClass(row.momentum2mPct)}>{formatPercent(row.momentum2mPct, 2)}</Cell>
                  <Cell className={deltaClass(row.change24hPct)}>{formatPercent(row.change24hPct, 2)}</Cell>
                  <Cell>{row.volumeImpulse.toFixed(2)}x</Cell>
                  <Cell>{compactUsd(row.liquidation5m)}</Cell>
                  <Cell>{compactUsd(row.tradeNotional60s)}</Cell>
                  <Cell>{compactUsd(row.quoteVolume24h)}</Cell>
                  <Cell>{row.spreadBps !== null ? `${row.spreadBps.toFixed(2)} bps` : "--"}</Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-1">
                      {row.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${tagClass(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </Cell>
                  <Cell>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleWatchlist(row.symbol);
                        }}
                        className={`rounded px-2 py-1 text-[11px] uppercase tracking-[0.16em] transition ${
                          watchlistSet.has(row.symbol)
                            ? "bg-emerald-500/18 text-emerald-200"
                            : "bg-white/[0.05] text-slate-300 hover:text-white"
                        }`}
                      >
                        W
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleActiveTrade(row.symbol);
                        }}
                        className={`rounded px-2 py-1 text-[11px] uppercase tracking-[0.16em] transition ${
                          activeTradeSet.has(row.symbol)
                            ? "bg-amber-500/18 text-amber-200"
                            : "bg-white/[0.05] text-slate-300 hover:text-white"
                        }`}
                      >
                        T
                      </button>
                    </div>
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WatchlistPane({
  selectedSymbol,
  watchlistRows,
  activeTradeRows,
  focusRows,
  watchlistSet,
  activeTradeSet,
  onSelectRow,
  onToggleWatchlist,
  onToggleActiveTrade
}: {
  selectedSymbol: string | null;
  watchlistRows: ExtendedQuoteRow[];
  activeTradeRows: ExtendedQuoteRow[];
  focusRows: ExtendedQuoteRow[];
  watchlistSet: Set<string>;
  activeTradeSet: Set<string>;
  onSelectRow: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onToggleActiveTrade: (symbol: string) => void;
}) {
  return (
    <div className="grid h-full gap-3 overflow-auto bg-[#1a1d2a] p-3 xl:grid-cols-3">
      <SymbolBucket
        title="Watchlist"
        rows={watchlistRows}
        selectedSymbol={selectedSymbol}
        emptyText="Ничего не закреплено."
        watchlistSet={watchlistSet}
        activeTradeSet={activeTradeSet}
        onSelectRow={onSelectRow}
        onToggleWatchlist={onToggleWatchlist}
        onToggleActiveTrade={onToggleActiveTrade}
      />
      <SymbolBucket
        title="Active trades"
        rows={activeTradeRows}
        selectedSymbol={selectedSymbol}
        emptyText="Сделок пока нет."
        watchlistSet={watchlistSet}
        activeTradeSet={activeTradeSet}
        onSelectRow={onSelectRow}
        onToggleWatchlist={onToggleWatchlist}
        onToggleActiveTrade={onToggleActiveTrade}
      />
      <SymbolBucket
        title="Focus"
        rows={focusRows}
        selectedSymbol={selectedSymbol}
        emptyText="Фокус-лист пока пуст."
        watchlistSet={watchlistSet}
        activeTradeSet={activeTradeSet}
        onSelectRow={onSelectRow}
        onToggleWatchlist={onToggleWatchlist}
        onToggleActiveTrade={onToggleActiveTrade}
      />
    </div>
  );
}

function SignalTapePane({
  alerts,
  onRequestReplay
}: {
  alerts: ScreenerAlert[];
  onRequestReplay?: (signalId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-[#1a1d2a]">
      <div className="border-b border-white/8 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-500">
        Последние сигналы
      </div>
      <div className="flex-1 overflow-auto p-3">
        {alerts.length > 0 ? (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-md border px-3 py-3 text-sm ${alertSeverityClass(alert)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-white">{alert.symbol}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-300">
                      {formatClockLabel(alert.createdAt)}
                    </div>
                    {onRequestReplay && alert.id && (
                      <button
                        type="button"
                        onClick={() => onRequestReplay(alert.id)}
                        className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-sky-400/40 hover:bg-sky-500/12 hover:text-sky-200"
                      >
                        Replay
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-slate-200">{alert.reason}</div>
                <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                  {alert.bias} | {compactUsd(alert.notionalUsd)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPane
            title="Сигналы появятся здесь"
            description="Лента покажет последние tape/liquidation импульсы с backend-потока."
          />
        )}
      </div>
    </div>
  );
}

function TradePadPane({
  row,
  ticketNotional,
  ticketSide,
  onTicketNotionalChange,
  onTicketSideChange
}: {
  row: ExtendedQuoteRow | null;
  ticketNotional: string;
  ticketSide: "LONG" | "SHORT";
  onTicketNotionalChange: (value: string) => void;
  onTicketSideChange: (value: "LONG" | "SHORT") => void;
}) {
  return (
    <div className="flex h-full flex-col bg-[#1a1d2a]">
      {row ? (
        <div className="grid h-full gap-3 p-3 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-md border border-white/8 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Связанный символ</div>
                <div className="mt-1 text-2xl font-semibold text-white">{row.symbol}</div>
              </div>
              <div className={`text-lg font-semibold ${scoreClass(row.score)}`}>{row.score.toFixed(1)}</div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MetricTile label="Bid / Ask" value={`${formatPrice(row.bestBid ?? row.lastPrice)} / ${formatPrice(row.bestAsk ?? row.lastPrice)}`} className="text-white" />
              <MetricTile label="Spread" value={row.spreadBps !== null ? `${row.spreadBps.toFixed(2)} bps` : "--"} className="text-slate-100" />
              <MetricTile label="Momentum" value={`${formatPercent(row.momentum30sPct, 2)} / ${formatPercent(row.momentum2mPct, 2)}`} className={deltaClass(row.momentum30sPct)} />
              <MetricTile label="Score delta" value={`${scoreDeltaLabel(row.scoreDelta30s)} / ${scoreDeltaLabel(row.scoreDelta2m)}`} className={deltaClass(row.scoreDelta30s)} />
            </div>
            <div className="mt-4 rounded-md border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
              Отправка реальных ордеров в этой изолированной сборке не подключена. Панель сделана как
              заготовка под торговый тикет и привязана к выбранной котировке.
            </div>
          </div>
          <div className="rounded-md border border-white/8 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Тикет</div>
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onTicketSideChange("LONG")}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    ticketSide === "LONG"
                      ? "border-emerald-400/40 bg-emerald-500/12 text-emerald-200"
                      : "border-white/10 bg-white/[0.05] text-slate-300"
                  }`}
                >
                  LONG
                </button>
                <button
                  type="button"
                  onClick={() => onTicketSideChange("SHORT")}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    ticketSide === "SHORT"
                      ? "border-rose-400/40 bg-rose-500/12 text-rose-200"
                      : "border-white/10 bg-white/[0.05] text-slate-300"
                  }`}
                >
                  SHORT
                </button>
              </div>
              <label className="text-sm text-slate-300">
                Notional USD
                <input
                  value={ticketNotional}
                  onChange={(event) => onTicketNotionalChange(event.target.value)}
                  className="mt-1 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-slate-100 outline-none"
                />
              </label>
              <button
                type="button"
                disabled
                className="rounded-md border border-sky-400/30 bg-sky-500/12 px-3 py-3 text-sm font-medium text-sky-200 opacity-70"
              >
                Подготовить ордер
              </button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyPane
          title="Тикет ждёт символ"
          description="Привяжите котировку из таблицы, и сюда подтянутся price, spread, score и momentum."
        />
      )}
    </div>
  );
}

function AdvancedChartPane({
  row,
  priceHistory,
  workingPrice,
  ticketSide,
  ticketOrderType,
  orders,
  position,
  onWorkingPriceChange,
  onSubmitOrder
}: {
  row: ExtendedQuoteRow | null;
  priceHistory: NumericHistoryPoint[];
  workingPrice: number | null;
  ticketSide: TradingSide;
  ticketOrderType: TradingOrderType;
  orders: LocalTradeOrder[];
  position: LocalTradePosition | null;
  onWorkingPriceChange: (symbol: string, price: number) => void;
  onSubmitOrder: (input: SubmitOrderInput) => void;
}) {
  const candles = useMemo(
    () => buildMiniCandles(priceHistory, row?.tradeNotional5s ?? 0),
    [priceHistory, row?.tradeNotional5s]
  );
  const avgEntryPrice =
    position && Math.abs(position.quantity) >= minTradingQuantity ? position.avgEntryPrice : Number.NaN;
  const priceBand = useMemo(
    () =>
      priceBandFromSeries(candles, [
        row?.lastPrice ?? Number.NaN,
        workingPrice ?? Number.NaN,
        avgEntryPrice,
        ...orders.map((order) => order.requestedPrice)
      ]),
    [avgEntryPrice, candles, orders, row?.lastPrice, workingPrice]
  );

  if (!row) {
    return (
      <EmptyPane
        title="Chart needs a symbol"
        description="Select a symbol from quotes or watchlist to attach the chart, working price, and paper orders."
      />
    );
  }

  const tickSize = inferTickSize(row);
  const spreadLabel =
    row.bestBid !== null && row.bestAsk !== null
      ? `${formatPrice(row.bestAsk - row.bestBid)} | ${row.spreadBps?.toFixed(2) ?? "--"} bps`
      : "--";
  const chartPriceHeight = chartHeight - chartVolumeHeight - 18;
  const volumeStartY = chartPriceHeight + 18;
  const bandSpan = Math.max(priceBand.max - priceBand.min, tickSize);
  const slotWidth = chartWidth / Math.max(candles.length, 1);
  const candleBodyWidth = Math.max(slotWidth * 0.58, 6);
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);
  const sessionBase = candles[0]?.open ?? priceHistory[0]?.value ?? row.lastPrice;
  const sessionLast = candles[candles.length - 1]?.close ?? row.lastPrice;
  const sessionDelta = sessionBase > 0 ? ((sessionLast - sessionBase) / sessionBase) * 100 : 0;
  const positionPnl = resolveUnrealizedPnlUsd(position, row);
  const activeOrders = orders.slice(0, 5);
  const currentWorkingPrice = workingPrice ?? resolveReferencePrice(row, ticketSide);

  const priceToY = (price: number): number =>
    clampNumber(((priceBand.max - price) / bandSpan) * chartPriceHeight, 0, chartPriceHeight);

  const resolvePriceFromPointer = (event: React.MouseEvent<SVGSVGElement>): number => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offsetY = clampNumber(event.clientY - bounds.top, 0, chartPriceHeight);
    const ratio = offsetY / Math.max(chartPriceHeight, 1);
    return snapPriceToTick(priceBand.max - bandSpan * ratio, tickSize);
  };

  const handleChartInteraction = (
    event: React.MouseEvent<SVGSVGElement>,
    shouldSubmit: boolean
  ) => {
    const nextPrice = resolvePriceFromPointer(event);
    onWorkingPriceChange(row.symbol, nextPrice);

    if (shouldSubmit) {
      onSubmitOrder({
        row,
        side: ticketSide,
        type: "LIMIT",
        source: "chart",
        requestedPrice: nextPrice
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#131722]">
      <div className="grid gap-3 border-b border-white/8 p-3 sm:grid-cols-5">
        <MetricTile label="Last" value={formatPrice(row.lastPrice)} className="text-white" />
        <MetricTile label="Spread" value={spreadLabel} className="text-slate-100" />
        <MetricTile label="Session" value={formatPercent(sessionDelta, 2)} className={deltaClass(sessionDelta)} />
        <MetricTile
          label="Working"
          value={formatPrice(currentWorkingPrice)}
          className={ticketSide === "LONG" ? "text-emerald-200" : "text-rose-200"}
        />
        <MetricTile
          label="Position"
          value={
            position && Math.abs(position.quantity) >= minTradingQuantity
              ? `${formatQuantity(position.quantity)} | ${formatUsdAmount(positionPnl)}`
              : "flat"
          }
          className={
            position && Math.abs(position.quantity) >= minTradingQuantity
              ? deltaClass(positionPnl)
              : "text-slate-400"
          }
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_34%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(10,14,22,0.96))]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{row.symbol}</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-200">
                <span className="font-semibold text-white">{ticketSide === "LONG" ? "Buy side" : "Sell side"}</span>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                  {ticketOrderType}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <HotkeyHint keys="B / S" label="market" />
              <HotkeyHint keys="Shift+B / Shift+S" label="limit" />
              <HotkeyHint keys="[ ]" label="tick" />
              <HotkeyHint keys="L" label="send" />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 bg-black/10 px-4 py-2">
            <div className="flex items-center gap-2">
              <ChartToolbarPill label="1M" />
              <ChartToolbarPill label="5M" active />
              <ChartToolbarPill label="15M" />
              <ChartToolbarPill label="Vol" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                Свечи
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                Tape {compactUsd(row.tradeNotional60s)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                Momentum {formatPercent(row.momentum30sPct, 2)}
              </span>
            </div>
          </div>
          {candles.length > 0 ? (
            <div className="min-h-0 flex-1 p-3">
              <div className="grid h-full gap-3 xl:grid-cols-[46px_minmax(0,1fr)]">
                <div className="hidden rounded-lg border border-white/8 bg-black/20 p-2 xl:flex xl:flex-col xl:items-center xl:gap-2">
                  <ChartToolButton label="+" />
                  <ChartToolButton label="TL" />
                  <ChartToolButton label="R" />
                  <ChartToolButton label="O" />
                  <ChartToolButton label="M" />
                </div>
                <div className="min-h-0">
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="h-full min-h-[320px] w-full cursor-crosshair rounded-lg bg-[#0f1622]"
                    preserveAspectRatio="none"
                    onClick={(event) => handleChartInteraction(event, false)}
                    onDoubleClick={(event) => handleChartInteraction(event, true)}
                  >
                    {Array.from({ length: 5 }).map((_, index) => {
                      const y = (chartPriceHeight / 4) * index;
                      const price = priceBand.max - (bandSpan * index) / 4;

                      return (
                        <g key={`grid-y-${index}`}>
                          <line x1="0" y1={y} x2={chartWidth} y2={y} stroke="rgba(148,163,184,0.12)" />
                          <text x={chartWidth - 4} y={Math.max(y - 4, 12)} textAnchor="end" fontSize="10" fill="#64748b">
                            {formatPrice(price)}
                          </text>
                        </g>
                      );
                    })}
                    {Array.from({ length: Math.max(candles.length, 1) }).map((_, index) => {
                      const x = slotWidth * index + slotWidth / 2;

                      return (
                        <line
                          key={`grid-x-${index}`}
                          x1={x}
                          y1="0"
                          x2={x}
                          y2={chartPriceHeight}
                          stroke="rgba(71,85,105,0.09)"
                        />
                      );
                    })}
                    {candles.map((candle, index) => {
                      const centerX = slotWidth * index + slotWidth / 2;
                      const wickTop = priceToY(candle.high);
                      const wickBottom = priceToY(candle.low);
                      const bodyTop = priceToY(Math.max(candle.open, candle.close));
                      const bodyBottom = priceToY(Math.min(candle.open, candle.close));
                      const bodyHeight = Math.max(bodyBottom - bodyTop, 2);
                      const bodyX = centerX - candleBodyWidth / 2;
                      const bullish = candle.close >= candle.open;
                      const volumeHeight = (candle.volume / maxVolume) * (chartVolumeHeight - 14);

                      return (
                        <g key={`${candle.startTimestamp}-${candle.endTimestamp}`}>
                          <line
                            x1={centerX}
                            y1={wickTop}
                            x2={centerX}
                            y2={wickBottom}
                            stroke={bullish ? "#34d399" : "#fb7185"}
                            strokeWidth="1.2"
                          />
                          <rect
                            x={bodyX}
                            y={bodyTop}
                            width={candleBodyWidth}
                            height={bodyHeight}
                            rx="1.5"
                            fill={bullish ? "#14b8a6" : "#f43f5e"}
                          />
                          <rect
                            x={bodyX}
                            y={volumeStartY + chartVolumeHeight - volumeHeight}
                            width={candleBodyWidth}
                            height={Math.max(volumeHeight, 2)}
                            rx="1.5"
                            fill={bullish ? "rgba(20,184,166,0.52)" : "rgba(244,63,94,0.48)"}
                          />
                        </g>
                      );
                    })}
                    <ChartPriceLine y={priceToY(row.lastPrice)} label="Last" price={row.lastPrice} color="#f87171" />
                    <ChartPriceLine
                      y={priceToY(currentWorkingPrice)}
                      label="Work"
                      price={currentWorkingPrice}
                      color={ticketSide === "LONG" ? "#38bdf8" : "#f59e0b"}
                      dashed
                    />
                    {Number.isFinite(avgEntryPrice) ? (
                      <ChartPriceLine
                        y={priceToY(avgEntryPrice)}
                        label="Avg"
                        price={avgEntryPrice}
                        color="#a78bfa"
                        dashed
                      />
                    ) : null}
                    {activeOrders.slice(0, 4).map((order, index) => (
                      <ChartPriceLine
                        key={order.id}
                        y={priceToY(order.requestedPrice)}
                        label={`L${index + 1}`}
                        price={order.requestedPrice}
                        color={order.side === "LONG" ? "#34d399" : "#fb7185"}
                        dashed
                      />
                    ))}
                  </svg>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>Click to move working price. Double click to place a {ticketSide === "LONG" ? "buy" : "sell"} limit.</span>
                    <span>Tick {formatPrice(tickSize)} | Orders {orders.length}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyPane
              title="History is still warming up"
              description="A few more price updates are needed before the candle layer can be rendered."
            />
          )}
        </div>
        <div className="grid min-h-0 gap-3">
          <div className="rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Ticket context</div>
            <div className="mt-3 grid gap-2 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span>Side</span>
                <span className={ticketSide === "LONG" ? "text-emerald-300" : "text-rose-300"}>
                  {ticketSide}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Mode</span>
                <span className="text-slate-100">{ticketOrderType}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Best bid / ask</span>
                <span className="text-slate-100">
                  {formatPrice(row.bestBid ?? row.lastPrice)} / {formatPrice(row.bestAsk ?? row.lastPrice)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Momentum</span>
                <span className={deltaClass(row.momentum30sPct)}>{formatPercent(row.momentum30sPct, 2)}</span>
              </div>
            </div>
          </div>
          <div className="min-h-0 rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Working orders</div>
              <span className="text-xs text-slate-500">{orders.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {activeOrders.length > 0 ? (
                activeOrders.map((order) => <PaperOrderRow key={order.id} order={order} />)
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-sm text-slate-500">
                  No active paper orders on this symbol yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdvancedOrderBookPane({
  row,
  workingPrice,
  ticketNotional,
  ticketSide,
  ticketOrderType,
  tapePrints,
  clusterPoints,
  settings,
  orders,
  alerts,
  position,
  onWorkingPriceChange,
  onTicketSideChange,
  onSubmitOrder,
  onSubmitTicketOrder,
  onCancelOrder,
  onCancelOrdersForSymbol,
  onOpenSettings
}: {
  row: ExtendedQuoteRow | null;
  workingPrice: number | null;
  ticketNotional: string;
  ticketSide: TradingSide;
  ticketOrderType: TradingOrderType;
  tapePrints: TapePrint[];
  clusterPoints: ClusterBubblePoint[];
  settings: OrderflowSettings;
  orders: LocalTradeOrder[];
  alerts: ScreenerAlert[];
  position: LocalTradePosition | null;
  onWorkingPriceChange: (symbol: string, price: number) => void;
  onTicketSideChange: (value: TradingSide) => void;
  onSubmitOrder: (input: SubmitOrderInput) => void;
  onSubmitTicketOrder: (
    side?: TradingSide,
    type?: TradingOrderType,
    source?: TradingOrderSource
  ) => void;
  onCancelOrder: (orderId: string) => void;
  onCancelOrdersForSymbol: (symbol: string) => void;
  onOpenSettings: (section?: OrderflowSettingsSection) => void;
}) {
  if (!row) {
    return (
      <EmptyPane
        title="Order book needs a symbol"
        description="Select a symbol first. Then you can click ladder prices, size your ticket, and place paper orders from the book."
      />
    );
  }

  const levels = buildOrderBookLevels(row);
  const tickSize = inferTickSize(row);
  const spreadLabel =
    row.bestBid !== null && row.bestAsk !== null
      ? `${formatPrice(row.bestAsk - row.bestBid)} | ${row.spreadBps?.toFixed(2) ?? "--"} bps`
      : "--";
  const currentWorkingPrice = workingPrice ?? resolveReferencePrice(row, ticketSide);
  const parsedNotional = parseNotionalUsd(ticketNotional);
  const estimatedQuantity =
    parsedNotional !== null ? resolveOrderQuantity(parsedNotional, currentWorkingPrice) : null;
  const positionPnl = resolveUnrealizedPnlUsd(position, row);
  const activeAlertRules = settings.alerts.filter((rule) => rule.enabled);
  const triggeredAlerts = activeAlertRules.filter((rule) =>
    tapePrints.some((print) => matchesOrderflowAlertRule(print, rule))
  );
  const lastPrint = tapePrints[0] ?? null;
  const tapeDisplayMode = settings.tape.displayMode;

  const handleLevelInteraction = (
    level: ReturnType<typeof buildOrderBookLevels>["bids"][number],
    shouldSubmit: boolean
  ) => {
    const nextSide: TradingSide = level.side === "ask" ? "LONG" : "SHORT";
    onTicketSideChange(nextSide);
    onWorkingPriceChange(row.symbol, level.price);

    if (shouldSubmit) {
      onSubmitOrder({
        row,
        side: nextSide,
        type: "LIMIT",
        source: "orderbook",
        requestedPrice: level.price
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#131722]">
      <div className="flex items-start justify-between gap-3 border-b border-white/8 p-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-4">
          <MetricTile label="Spread" value={spreadLabel} className="text-white" />
          <MetricTile
            label="Imbalance"
            value={row.orderBookImbalance !== null ? row.orderBookImbalance.toFixed(3) : "--"}
            className={deltaClass(row.orderBookImbalance ?? null)}
          />
          <MetricTile
            label="Tape"
            value={
              lastPrint
                ? `${lastPrint.count}x ${
                    tapeDisplayMode === "usd"
                      ? compactUsd(lastPrint.notionalUsd)
                      : formatQuantity(lastPrint.quantity)
                  }`
                : "--"
            }
            className={lastPrint ? (lastPrint.side === "buy" ? "text-emerald-200" : "text-rose-200") : "text-slate-400"}
          />
          <MetricTile
            label="Ticket"
            value={`${ticketSide} ${ticketOrderType}`}
            className={ticketSide === "LONG" ? "text-emerald-200" : "text-rose-200"}
          />
        </div>
        <button
          type="button"
          onClick={() => onOpenSettings("general")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/20 hover:text-white"
          title="Настройки стакана"
        >
          <SettingsIcon />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-h-0 gap-3 xl:grid-rows-[minmax(0,1fr)_230px]">
          <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_270px]">
            <OrderflowClusterPanel
              row={row}
              points={clusterPoints}
              settings={settings}
              onOpenSettings={() => onOpenSettings("clusters")}
            />
            <div className="min-h-0 rounded-xl border border-white/8 bg-[#0f131c]/95 p-2">
              <div className="flex items-center justify-between gap-3 border-b border-white/8 px-3 py-2">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <span>Depth</span>
                  <span>{settings.general.bookInUsd ? "Value" : "Size"}</span>
                  <span>Price</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-100">
                    Tape {tapeDisplayMode === "usd" ? "$" : "Qty"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenSettings("tape")}
                    className="rounded-md border border-white/10 px-2 py-1 text-slate-300 transition hover:border-white/20 hover:text-white"
                  >
                    Tape
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSettings("clusters")}
                    className="rounded-md border border-white/10 px-2 py-1 text-slate-300 transition hover:border-white/20 hover:text-white"
                  >
                    Clusters
                  </button>
                </div>
              </div>
              <div className="relative overflow-hidden px-1 pt-1">
                <div className="space-y-px">
                  {levels.asks.map((level) => (
                    <AdvancedOrderBookRow
                      key={`advanced-ask-${level.price}`}
                      level={level}
                      tickSize={tickSize}
                      workingPrice={currentWorkingPrice}
                      orders={orders}
                      settings={settings}
                      onClick={() => handleLevelInteraction(level, false)}
                      onDoubleClick={() => handleLevelInteraction(level, true)}
                    />
                  ))}
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-y border-white/8 bg-[#202536] px-3 py-2 text-sm font-semibold text-white">
                    <span className="text-left text-slate-500">mid</span>
                    <span className="text-center">
                      {formatPriceWithPrecision(row.lastPrice, settings.general.priceDecimals)}
                    </span>
                    <span className="text-right text-slate-500">{formatClockLabel(row.updatedAt)}</span>
                  </div>
                  {levels.bids.map((level) => (
                    <AdvancedOrderBookRow
                      key={`advanced-bid-${level.price}`}
                      level={level}
                      tickSize={tickSize}
                      workingPrice={currentWorkingPrice}
                      orders={orders}
                      settings={settings}
                      onClick={() => handleLevelInteraction(level, false)}
                      onDoubleClick={() => handleLevelInteraction(level, true)}
                    />
                  ))}
                </div>
                <CenterTapeRail
                  prints={tapePrints}
                  pricePrecision={settings.general.priceDecimals}
                  displayMode={tapeDisplayMode}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-2 text-xs text-slate-500">
                <span>Single click sets side and working price. Double click sends a level-aligned limit.</span>
                <span>{orders.length} working orders</span>
              </div>
            </div>
          </div>
        </div>
        <div className="grid min-h-0 gap-3">
          <div className="rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Quick actions</div>
              <button
                type="button"
                onClick={() => onOpenSettings("trading")}
                className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-white/20 hover:text-white"
              >
                Trading
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              <TradeActionButton
                label="Buy market"
                detail="B"
                tone="buy"
                disabled={parsedNotional === null}
                onClick={() => onSubmitTicketOrder("LONG", "MARKET", "orderbook")}
              />
              <TradeActionButton
                label="Sell market"
                detail="S"
                tone="sell"
                disabled={parsedNotional === null}
                onClick={() => onSubmitTicketOrder("SHORT", "MARKET", "orderbook")}
              />
              <TradeActionButton
                label={`Send ${ticketSide.toLowerCase()} limit`}
                detail="L"
                tone="neutral"
                disabled={parsedNotional === null}
                onClick={() => onSubmitTicketOrder(ticketSide, "LIMIT", "orderbook")}
              />
              <TradeActionButton
                label="Cancel symbol orders"
                detail="C"
                tone="ghost"
                disabled={orders.length === 0}
                onClick={() => onCancelOrdersForSymbol(row.symbol)}
              />
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span>Notional</span>
                <span className="text-slate-100">
                  {parsedNotional !== null ? `$${parsedNotional.toFixed(0)}` : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Working</span>
                <span className="text-slate-100">{formatPrice(currentWorkingPrice)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Estimated qty</span>
                <span className="text-slate-100">
                  {estimatedQuantity !== null ? formatQuantity(estimatedQuantity) : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Auto stop / take</span>
                <span className="text-slate-100">
                  {settings.trading.autoStopValue || 0}
                  {settings.trading.autoStopMode === "percent" ? "%" : "p"} / {settings.trading.autoTakeValue || 0}
                  {settings.trading.autoTakeMode === "percent" ? "%" : "p"}
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Alert manager</div>
              <button
                type="button"
                onClick={() => onOpenSettings("alerts")}
                className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-white/20 hover:text-white"
              >
                Rules
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {settings.alerts.map((rule) => {
                const hit = tapePrints.some((print) => matchesOrderflowAlertRule(print, rule));

                return (
                  <div
                    key={rule.id}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      rule.enabled
                        ? hit
                          ? "border-emerald-400/30 bg-emerald-500/10"
                          : "border-white/10 bg-white/[0.03]"
                        : "border-white/8 bg-black/10 opacity-65"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-white">{rule.label}</span>
                      <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                        {rule.sound}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {rule.minValue || 0} - {rule.maxValue || 0} {rule.unit}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
              <span>{activeAlertRules.length} active rules</span>
              <span>{triggeredAlerts.length} triggered now</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Position</div>
            <div className="mt-3 grid gap-2 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span>Quantity</span>
                <span className="text-slate-100">
                  {position ? formatQuantity(position.quantity) : "flat"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Avg entry</span>
                <span className="text-slate-100">
                  {position && Math.abs(position.quantity) >= minTradingQuantity
                    ? formatPrice(position.avgEntryPrice)
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>UPnL</span>
                <span className={deltaClass(positionPnl)}>{formatUsdAmount(positionPnl)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Realized</span>
                <span className={deltaClass(position?.realizedPnlUsd ?? 0)}>
                  {formatUsdAmount(position?.realizedPnlUsd ?? 0)}
                </span>
              </div>
            </div>
          </div>
          <div className="min-h-0 rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Working orders</div>
              <span className="text-xs text-slate-500">{orders.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {orders.length > 0 ? (
                orders.slice(0, 4).map((order) => (
                  <PaperOrderRow key={order.id} order={order} onCancelOrder={onCancelOrder} compact />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                  No working orders on this ladder.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdvancedTradePadPane({
  row,
  ticketNotional,
  ticketSide,
  ticketOrderType,
  workingPrice,
  orders,
  executions,
  position,
  unrealizedPnlUsd,
  onTicketNotionalChange,
  onTicketSideChange,
  onTicketOrderTypeChange,
  onWorkingPriceChange,
  onSubmitTicketOrder,
  onCancelOrder,
  onCancelOrdersForSymbol,
  onFlattenPosition
}: {
  row: ExtendedQuoteRow | null;
  ticketNotional: string;
  ticketSide: TradingSide;
  ticketOrderType: TradingOrderType;
  workingPrice: number | null;
  orders: LocalTradeOrder[];
  executions: LocalTradeExecution[];
  position: LocalTradePosition | null;
  unrealizedPnlUsd: number;
  onTicketNotionalChange: (value: string) => void;
  onTicketSideChange: (value: TradingSide) => void;
  onTicketOrderTypeChange: (value: TradingOrderType) => void;
  onWorkingPriceChange: (symbol: string, price: number) => void;
  onSubmitTicketOrder: (
    side?: TradingSide,
    type?: TradingOrderType,
    source?: TradingOrderSource
  ) => void;
  onCancelOrder: (orderId: string) => void;
  onCancelOrdersForSymbol: (symbol: string) => void;
  onFlattenPosition: () => void;
}) {
  if (!row) {
    return (
      <EmptyPane
        title="Trade pad is waiting for a symbol"
        description="Pick a symbol in the quotes table or watchlist. The ticket, ladder, chart, and hotkeys all follow the selected symbol."
      />
    );
  }

  const tickSize = inferTickSize(row);
  const referencePrice = resolveReferencePrice(row, ticketSide);
  const currentWorkingPrice = workingPrice ?? referencePrice;
  const parsedNotional = parseNotionalUsd(ticketNotional);
  const priceForQuantity = ticketOrderType === "LIMIT" ? currentWorkingPrice : referencePrice;
  const estimatedQuantity =
    parsedNotional !== null ? resolveOrderQuantity(parsedNotional, priceForQuantity) : null;
  const canFlatten = Boolean(position && Math.abs(position.quantity) >= minTradingQuantity);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#131722]">
      <div className="grid gap-3 border-b border-white/8 p-3 sm:grid-cols-5">
        <MetricTile label="Symbol" value={row.symbol} className="text-white" />
        <MetricTile
          label="Bid / Ask"
          value={`${formatPrice(row.bestBid ?? row.lastPrice)} / ${formatPrice(row.bestAsk ?? row.lastPrice)}`}
          className="text-slate-100"
        />
        <MetricTile
          label="Working"
          value={formatPrice(currentWorkingPrice)}
          className={ticketSide === "LONG" ? "text-emerald-200" : "text-rose-200"}
        />
        <MetricTile
          label="Est qty"
          value={estimatedQuantity !== null ? formatQuantity(estimatedQuantity) : "--"}
          className="text-slate-100"
        />
        <MetricTile
          label="UPnL"
          value={formatUsdAmount(unrealizedPnlUsd)}
          className={deltaClass(unrealizedPnlUsd)}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-xl border border-white/8 bg-black/20 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Ticket</div>
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <TradeActionButton
                  label="Buy"
                  tone="buy"
                  active={ticketSide === "LONG"}
                  onClick={() => onTicketSideChange("LONG")}
                />
                <TradeActionButton
                  label="Sell"
                  tone="sell"
                  active={ticketSide === "SHORT"}
                  onClick={() => onTicketSideChange("SHORT")}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TradeActionButton
                  label="Limit"
                  tone="neutral"
                  active={ticketOrderType === "LIMIT"}
                  onClick={() => onTicketOrderTypeChange("LIMIT")}
                />
                <TradeActionButton
                  label="Market"
                  tone="ghost"
                  active={ticketOrderType === "MARKET"}
                  onClick={() => onTicketOrderTypeChange("MARKET")}
                />
              </div>
              <label className="text-sm text-slate-300">
                Notional USD
                <input
                  value={ticketNotional}
                  onChange={(event) => onTicketNotionalChange(event.target.value)}
                  placeholder="100"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
                />
              </label>
              <div className="grid grid-cols-5 gap-2">
                {quickNotionalOptions.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onTicketNotionalChange(String(option))}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                      ticketNotional === String(option)
                        ? "border-sky-400/40 bg-sky-500/12 text-sky-100"
                        : "border-white/10 bg-white/[0.04] text-slate-300 hover:text-white"
                    }`}
                  >
                    ${option}
                    <span className="mt-1 block text-[10px] text-slate-500">{index + 1}</span>
                  </button>
                ))}
              </div>
              <label className="text-sm text-slate-300">
                Working price
                <input
                  type="number"
                  min={tickSize}
                  step={tickSize}
                  value={workingPrice !== null ? String(workingPrice) : ""}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);

                    if (Number.isFinite(nextValue) && nextValue > 0) {
                      onWorkingPriceChange(row.symbol, nextValue);
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-100 outline-none focus:border-sky-400/40"
                />
              </label>
              <div className="grid gap-2">
                <TradeActionButton
                  label={`${ticketSide === "LONG" ? "Buy" : "Sell"} market`}
                  detail={ticketSide === "LONG" ? "B" : "S"}
                  tone={ticketSide === "LONG" ? "buy" : "sell"}
                  disabled={parsedNotional === null}
                  onClick={() => onSubmitTicketOrder(ticketSide, "MARKET", "ticket")}
                />
                <TradeActionButton
                  label={`Send ${ticketSide.toLowerCase()} limit`}
                  detail="L"
                  tone="neutral"
                  disabled={parsedNotional === null}
                  onClick={() => onSubmitTicketOrder(ticketSide, "LIMIT", "ticket")}
                />
                <div className="grid grid-cols-2 gap-2">
                  <TradeActionButton
                    label="Cancel symbol"
                    detail="C"
                    tone="ghost"
                    disabled={orders.length === 0}
                    onClick={() => onCancelOrdersForSymbol(row.symbol)}
                  />
                  <TradeActionButton
                    label="Flatten"
                    detail="F"
                    tone="sell"
                    disabled={!canFlatten}
                    onClick={onFlattenPosition}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-black/20 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Hotkeys</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <HotkeyHint keys="1-5" label="size preset" />
              <HotkeyHint keys="[ ]" label="tick move" />
              <HotkeyHint keys="B / S" label="market" />
              <HotkeyHint keys="Shift+B / Shift+S" label="limit" />
              <HotkeyHint keys="M" label="toggle mode" />
              <HotkeyHint keys="L" label="send limit" />
              <HotkeyHint keys="C" label="cancel" />
              <HotkeyHint keys="F" label="flatten" />
            </div>
          </div>
        </div>
        <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
          <div className="space-y-3">
            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Position</div>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span>Quantity</span>
                  <span className="text-slate-100">
                    {position ? formatQuantity(position.quantity) : "flat"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Avg entry</span>
                  <span className="text-slate-100">
                    {position && Math.abs(position.quantity) >= minTradingQuantity
                      ? formatPrice(position.avgEntryPrice)
                      : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Unrealized</span>
                  <span className={deltaClass(unrealizedPnlUsd)}>{formatUsdAmount(unrealizedPnlUsd)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Realized</span>
                  <span className={deltaClass(position?.realizedPnlUsd ?? 0)}>
                    {formatUsdAmount(position?.realizedPnlUsd ?? 0)}
                  </span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Last executions</div>
              <div className="mt-3 space-y-2">
                {executions.length > 0 ? (
                  executions.slice(0, 6).map((execution) => (
                    <PaperExecutionRow key={execution.id} execution={execution} />
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-sm text-slate-500">
                    No fills yet. Market orders and crossed limits will appear here.
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="min-h-0 rounded-xl border border-white/8 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Working orders</div>
              <span className="text-xs text-slate-500">{orders.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {orders.length > 0 ? (
                orders.map((order) => (
                  <PaperOrderRow key={order.id} order={order} onCancelOrder={onCancelOrder} />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-sm text-slate-500">
                  This symbol has no active paper orders. Use the ladder, chart, or trade buttons to create one.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopMarketSidebar({
  rows,
  selectedSymbol,
  watchlistSet,
  activeTradeSet,
  watchlistCount,
  activeTradeCount,
  embedded = false,
  onSelectRow,
  onToggleWatchlist,
  onToggleActiveTrade
}: {
  rows: ExtendedQuoteRow[];
  selectedSymbol: string | null;
  watchlistSet: Set<string>;
  activeTradeSet: Set<string>;
  watchlistCount: number;
  activeTradeCount: number;
  embedded?: boolean;
  onSelectRow: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onToggleActiveTrade: (symbol: string) => void;
}) {
  const visibleRows = rows;
  const positiveCount = visibleRows.filter((row) => row.change24hPct >= 0).length;
  const negativeCount = Math.max(visibleRows.length - positiveCount, 0);

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#303747] bg-[#101521] ${
        embedded ? "h-full w-full" : "w-[320px] flex-shrink-0"
      }`}
    >
      <div className={`border-b border-[#2b3140] ${embedded ? "px-2 py-2" : "px-3 py-3"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Котировки</div>
            <div className={embedded ? "mt-1 text-[11px] text-slate-400" : "mt-1 text-sm text-slate-300"}>
              {rows.length} symbols
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-slate-400">
            {embedded ? "dock" : "live desktop"}
          </div>
        </div>
        <div className={embedded ? "mt-2 grid grid-cols-2 gap-1.5" : "mt-3 grid grid-cols-2 gap-2"}>
          <MetricTile label="Watchlist" value={String(watchlistCount)} className="text-slate-100" />
          <MetricTile label="Trades" value={String(activeTradeCount)} className="text-slate-100" />
        </div>
      </div>
      <div
        className={`grid grid-cols-[minmax(0,1.08fr)_auto_auto] gap-2 border-b border-white/8 text-[9px] uppercase tracking-[0.18em] text-slate-500 ${
          embedded ? "px-2 py-1" : "px-3 py-2"
        }`}
      >
        <span>Тикер</span>
        <span>24h</span>
        <span>Price</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visibleRows.map((row) => {
          const selected = selectedSymbol === row.symbol;

          return (
            <button
              key={row.symbol}
              type="button"
              onClick={() => onSelectRow(row.symbol)}
              className={`grid w-full grid-cols-[minmax(0,1.08fr)_auto_auto] items-center gap-2 border-b border-white/6 text-left transition ${
                selected ? "bg-sky-500/12" : "hover:bg-white/[0.04]"
              } ${embedded ? "px-2 py-1" : "px-3 py-2"}`}
            >
              <div className="min-w-0">
                <div className={`truncate font-medium text-white ${embedded ? "text-[10px]" : ""}`}>
                  {row.symbol}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-slate-500">
                  <span>{row.bias}</span>
                  {watchlistSet.has(row.symbol) ? <span>W</span> : null}
                  {activeTradeSet.has(row.symbol) ? <span>T</span> : null}
                </div>
              </div>
              <span className={`font-medium ${embedded ? "text-[10px]" : "text-xs"} ${deltaClass(row.change24hPct)}`}>
                {formatPercent(row.change24hPct, 2)}
              </span>
              <div className="text-right">
                <div className={`${embedded ? "text-[10px]" : "text-sm"} text-slate-100`}>
                  {formatPrice(row.lastPrice)}
                </div>
                <div className="mt-0.5 flex justify-end gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleWatchlist(row.symbol);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleWatchlist(row.symbol);
                      }
                    }}
                    className={`rounded px-1 py-0.5 text-[9px] uppercase tracking-[0.16em] ${
                      watchlistSet.has(row.symbol)
                        ? "bg-emerald-500/18 text-emerald-200"
                        : "bg-white/[0.05] text-slate-400"
                    }`}
                  >
                    W
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleActiveTrade(row.symbol);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleActiveTrade(row.symbol);
                      }
                    }}
                    className={`rounded px-1 py-0.5 text-[9px] uppercase tracking-[0.16em] ${
                      activeTradeSet.has(row.symbol)
                        ? "bg-amber-500/18 text-amber-200"
                        : "bg-white/[0.05] text-slate-400"
                    }`}
                  >
                    T
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function OrderflowClusterPanel({
  row,
  points,
  settings,
  onOpenSettings
}: {
  row: ExtendedQuoteRow;
  points: ClusterBubblePoint[];
  settings: OrderflowSettings;
  onOpenSettings: () => void;
}) {
  const prices = points.map((point) => point.price);
  const minPrice = Math.min(...prices, row.lastPrice);
  const maxPrice = Math.max(...prices, row.lastPrice);
  const priceSpan = Math.max(maxPrice - minPrice, inferTickSize(row) * 3);
  const fullScaleVolume = Math.max(
    settings.clusters.fullScaleVolume,
    ...points.map((point) => point.totalVolume),
    1
  );

  return (
    <div className="flex min-h-[340px] min-w-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.14),transparent_34%),linear-gradient(180deg,rgba(16,22,34,0.96),rgba(9,13,21,0.96))]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Кластеры</div>
          <div className="mt-1 text-sm text-slate-300">{row.symbol} flow heatmap</div>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-white/20 hover:text-white"
        >
          Настроить
        </button>
      </div>
      <div className="relative min-h-0 flex-1 px-4 py-3">
        {points.length > 0 ? (
          <>
            {Array.from({ length: 5 }).map((_, index) => {
              const offset = index / 4;
              const price = maxPrice - priceSpan * offset;

              return (
                <div
                  key={`cluster-grid-${index}`}
                  className="absolute inset-x-4 flex items-center justify-between border-t border-white/6 text-[10px] text-slate-500"
                  style={{ top: `${index * 25}%` }}
                >
                  <span className="-translate-y-1/2 rounded bg-[#101621]/90 px-1.5 py-0.5">
                    {formatPriceWithPrecision(price, settings.general.priceDecimals)}
                  </span>
                  <span className="-translate-y-1/2 rounded bg-[#101621]/90 px-1.5 py-0.5">
                    {index === 0 ? `scale ${compactUsd(fullScaleVolume)}` : ""}
                  </span>
                </div>
              );
            })}
            {points.map((point, index) => {
              const size = 26 + (Math.min(point.totalVolume / fullScaleVolume, 1) * 54);
              const topRatio = (maxPrice - point.price) / priceSpan;
              const leftRatio = points.length === 1 ? 0.5 : index / (points.length - 1);
              const positive = point.deltaVolume >= 0;
              const bubbleColor = settings.clusters.colorByDelta
                ? positive
                  ? "rgba(34,197,94,0.78)"
                  : "rgba(248,113,113,0.82)"
                : "rgba(59,130,246,0.78)";

              return (
                <div
                  key={point.id}
                  className="absolute flex items-center justify-center rounded-full border border-white/10 text-center text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
                  style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    left: `calc(${leftRatio * 100}% + ${leftRatio * 28}px)`,
                    top: `${topRatio * 78 + 10}%`,
                    transform: "translate(-50%, -50%)",
                    background: bubbleColor
                  }}
                >
                  <div>
                    <div className="text-xs font-semibold">{point.tradeCount}</div>
                    <div className="text-[10px] opacity-80">
                      {positive ? "+" : "-"}
                      {compactUsd(Math.abs(point.deltaVolume))}
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="absolute inset-x-4 bottom-3 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-slate-500">
              {points.map((point) => (
                <span key={`${point.id}-time`} className="first:text-left last:text-right">
                  {formatClockLabel(point.timestamp)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">
            Кластеры появятся после накопления микростатистики.
          </div>
        )}
      </div>
    </div>
  );
}

function CenterTapeRail({
  prints,
  pricePrecision,
  displayMode
}: {
  prints: TapePrint[];
  pricePrecision: number;
  displayMode: "usd" | "qty";
}) {
  const visiblePrints = prints.slice(0, 10);
  const averageNotional =
    visiblePrints.reduce((total, print) => total + print.notionalUsd, 0) /
      Math.max(visiblePrints.length, 1) || 1;
  let buyIndex = 0;
  let sellIndex = 0;
  const layeredPrints = visiblePrints.map((print) => {
    const sideIndex = print.side === "buy" ? buyIndex++ : sellIndex++;
    const notionalRatio = clampNumber(print.notionalUsd / averageNotional, 0.65, 3.6);
    const speed = 0.9 + notionalRatio * 0.55 + (print.highlighted ? 0.32 : 0);

    return {
      ...print,
      direction: print.side === "buy" ? -1 : 1,
      sideIndex,
      speed
    };
  });

  return (
    <div className="pointer-events-none absolute inset-y-3 left-1/2 z-10 hidden w-[94px] -translate-x-1/2 rounded-[20px] border border-white/8 bg-[#08111d]/72 backdrop-blur xl:block">
      <div className="relative h-full overflow-hidden px-1.5 py-3">
        <div className="absolute inset-x-2 top-1/2 h-px bg-cyan-400/22" />
        <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-white/6" />
        <div className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-500/10 text-[8px] uppercase tracking-[0.1em] text-cyan-100">
          Mid
        </div>
        {layeredPrints.map((print) => {
          const offset = print.direction * (16 + print.sideIndex * 22 * print.speed);
          const label =
            displayMode === "usd"
              ? compactUsd(print.notionalUsd)
              : formatQuantity(print.quantity);

          return (
            <div
              key={print.id}
              className={`absolute left-1/2 flex w-[76px] -translate-x-1/2 flex-col items-center rounded-2xl border px-2 py-1 text-center text-[9px] font-semibold uppercase tracking-[0.14em] transition-[transform,opacity] duration-500 ${
                print.side === "buy"
                  ? "border-emerald-400/30 bg-emerald-500/14 text-emerald-100"
                  : "border-rose-400/30 bg-rose-500/14 text-rose-100"
              } ${print.highlighted ? "shadow-[0_0_20px_rgba(45,212,191,0.18)]" : ""}`}
              style={{
                top: "50%",
                opacity: Math.max(1 - print.sideIndex * 0.14, 0.22),
                transform: `translate(-50%, calc(-50% + ${offset}px)) scale(${Math.max(
                  1.04 - print.sideIndex * 0.05 + (print.highlighted ? 0.08 : 0),
                  0.76
                )})`
              }}
            >
              <span>{label}</span>
              <span className="text-[8px] tracking-[0.16em] text-slate-300/80">
                {formatPriceWithPrecision(print.price, pricePrecision)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TapePrintsPanel({
  row,
  prints,
  settings,
  alertCount,
  onOpenSettings
}: {
  row: ExtendedQuoteRow;
  prints: TapePrint[];
  settings: OrderflowSettings;
  alertCount: number;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex min-h-[220px] min-w-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-[#0d121b]/96">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Лента сделок</div>
          <div className="mt-1 text-sm text-slate-300">
            {settings.tape.aggregationEnabled
              ? `Aggregation ${settings.tape.aggregationPeriodSeconds}s`
              : "Tick by tick"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
            alerts {alertCount}
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            Фильтры
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {prints.length > 0 ? (
          <div className="space-y-2">
            {prints.map((print) => (
              <div
                key={print.id}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  print.side === "buy"
                    ? "border-emerald-400/15 bg-emerald-500/[0.07]"
                    : "border-rose-400/15 bg-rose-500/[0.07]"
                } ${print.muted ? "opacity-70" : ""}`}
              >
                <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  {formatClockLabel(print.timestamp)}
                </span>
                <div className="min-w-0">
                  <div
                    className={`font-medium ${
                      print.side === "buy" ? "text-emerald-200" : "text-rose-200"
                    }`}
                  >
                    {row.symbol} {formatPriceWithPrecision(print.price, settings.general.priceDecimals)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {formatQuantity(print.quantity)} | {print.source}
                  </div>
                </div>
                <span className="text-xs text-slate-200">{formatDepthMetric(print.quantity, print.price, settings)}</span>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                    print.highlighted
                      ? "bg-amber-500/18 text-amber-100"
                      : "bg-white/[0.05] text-slate-400"
                  }`}
                >
                  x{print.count}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">
            Лента сделок ждёт поток по выбранному символу.
          </div>
        )}
      </div>
    </div>
  );
}

function OrderflowSettingsModal({
  open,
  section,
  settings,
  referenceSymbol,
  referencePrice,
  onClose,
  onSectionChange,
  onUpdate,
  onReset
}: {
  open: boolean;
  section: OrderflowSettingsSection;
  settings: OrderflowSettings;
  referenceSymbol: string | null;
  referencePrice: number;
  onClose: () => void;
  onSectionChange: (section: OrderflowSettingsSection) => void;
  onUpdate: (updater: (current: OrderflowSettings) => OrderflowSettings) => void;
  onReset: () => void;
}) {
  if (!open) {
    return null;
  }

  const normalizedReferencePrice =
    Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : 0;
  const referenceLabel = referenceSymbol ? `${referenceSymbol} | ${formatPrice(referencePrice)}` : "Нет активного символа";
  const quantityFromUsd = (valueUsd: number) =>
    resolveQuantityFromUsdEquivalent(valueUsd, normalizedReferencePrice);
  const usdFromQuantity = (quantity: number) =>
    resolveUsdEquivalent(quantity, normalizedReferencePrice);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#04070d]/78 p-6 backdrop-blur-sm">
      <div className="grid h-[min(90vh,660px)] w-[min(96vw,1040px)] overflow-hidden rounded-[24px] border border-white/10 bg-[#171a26] shadow-[0_30px_80px_rgba(0,0,0,0.52)] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-r border-white/8 bg-[#131722] p-5">
          <div className="text-3xl font-semibold text-white">Настройки стакана</div>
          <div className="mt-5 space-y-2">
            {[
              ["general", "Общие настройки"],
              ["tape", "Лента сделок"],
              ["clusters", "Кластеры"],
              ["trading", "Торговля"],
              ["alerts", "Менеджер оповещений"]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onSectionChange(id as OrderflowSettingsSection)}
                className={`w-full rounded-xl px-4 py-3 text-left text-sm transition ${
                  section === id
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-300 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onReset}
            className="mt-8 w-full rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-slate-400 transition hover:bg-white/[0.08] hover:text-white"
          >
            Сбросить на глобальные
          </button>
        </aside>
        <section className="min-h-0 overflow-auto p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold text-white">
              {section === "general"
                ? "Общие настройки"
                : section === "tape"
                  ? "Лента сделок"
                  : section === "clusters"
                    ? "Кластеры"
                    : section === "trading"
                      ? "Торговля"
                      : "Менеджер оповещений"}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                Конвертация объёма и стоимости привязана к активному инструменту: {referenceLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
            >
              ×
            </button>
          </div>

          {section === "general" ? (
            <div className="space-y-4">
              <SettingsSwitch
                label="Автозаполнение"
                checked={settings.general.autoFill}
                onChange={(checked) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      autoFill: checked
                    }
                  }))
                }
              />
              <SettingsValueRow
                label="Объем полной шкалы"
                primaryValue={settings.general.fullScaleVolume}
                secondaryValue={usdFromQuantity(settings.general.fullScaleVolume)}
                secondaryPrefix="$"
                onPrimaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      fullScaleVolume: value
                    }
                  }))
                }
                onSecondaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      fullScaleVolume: quantityFromUsd(value)
                    }
                  }))
                }
              />
              <SettingsValueRow
                label="Крупный объем 1"
                primaryValue={settings.general.bigVolume1}
                secondaryValue={usdFromQuantity(settings.general.bigVolume1)}
                secondaryPrefix="$"
                onPrimaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      bigVolume1: value
                    }
                  }))
                }
                onSecondaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      bigVolume1: quantityFromUsd(value)
                    }
                  }))
                }
              />
              <SettingsValueRow
                label="Крупный объем 2"
                primaryValue={settings.general.bigVolume2}
                secondaryValue={usdFromQuantity(settings.general.bigVolume2)}
                secondaryPrefix="$"
                onPrimaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      bigVolume2: value
                    }
                  }))
                }
                onSecondaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      bigVolume2: quantityFromUsd(value)
                    }
                  }))
                }
              />
              <SettingsSwitch
                label="Стакан в $"
                checked={settings.general.bookInUsd}
                onChange={(checked) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      bookInUsd: checked
                    }
                  }))
                }
              />
              <SettingsSwitch
                label="Минимизировать объем"
                checked={settings.general.minimizeVolume}
                onChange={(checked) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      minimizeVolume: checked
                    }
                  }))
                }
              />
              <SettingsModeRow
                label="Tape display unit"
                value={settings.tape.displayMode}
                options={[
                  { value: "usd", label: "USD" },
                  { value: "qty", label: "Token" }
                ]}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      displayMode: value as OrderflowSettings["tape"]["displayMode"]
                    }
                  }))
                }
              />
              <SettingsNumberRow
                label="Кол-во знаков после запятой"
                value={settings.general.priceDecimals}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      priceDecimals: value
                    }
                  }))
                }
              />
            </div>
          ) : null}

          {section === "tape" ? (
            <div className="space-y-4">
              <SettingsValueRow
                label="Скрывать сделки объемом менее"
                primaryValue={settings.tape.hideTradeQuantityBelow}
                secondaryValue={usdFromQuantity(settings.tape.hideTradeQuantityBelow)}
                secondaryPrefix="$"
                onPrimaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      hideTradeQuantityBelow: value
                    }
                  }))
                }
                onSecondaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      hideTradeQuantityBelow: quantityFromUsd(value)
                    }
                  }))
                }
              />
              <SettingsValueRow
                label="РЎРєСЂС‹РІР°С‚СЊ Р·РЅР°С‡РµРЅРёРµ РѕР±СЉРµРјР° РјРµРЅРµРµ"
                primaryValue={quantityFromUsd(settings.tape.hideTradeValueBelowUsd)}
                secondaryValue={settings.tape.hideTradeValueBelowUsd}
                secondaryPrefix="$"
                onPrimaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      hideTradeValueBelowUsd: usdFromQuantity(value)
                    }
                  }))
                }
                onSecondaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      hideTradeValueBelowUsd: value
                    }
                  }))
                }
              />
              <SettingsValueRow
                label="Удалять сделки объемом менее"
                primaryValue={settings.tape.deleteTradeQuantityBelow}
                secondaryValue={usdFromQuantity(settings.tape.deleteTradeQuantityBelow)}
                secondaryPrefix="$"
                onPrimaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      deleteTradeQuantityBelow: value
                    }
                  }))
                }
                onSecondaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      deleteTradeQuantityBelow: quantityFromUsd(value)
                    }
                  }))
                }
              />
              <SettingsSwitch
                label="Агрегация сделок"
                checked={settings.tape.aggregationEnabled}
                onChange={(checked) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      aggregationEnabled: checked
                    }
                  }))
                }
              />
              <SettingsNumberRow
                label="Период агрегации"
                value={settings.tape.aggregationPeriodSeconds}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    tape: {
                      ...current.tape,
                      aggregationPeriodSeconds: value
                    }
                  }))
                }
              />
            </div>
          ) : null}

          {section === "clusters" ? (
            <div className="space-y-4">
              <SettingsValueRow
                label="Объем полной шкалы"
                primaryValue={settings.clusters.fullScaleVolume}
                secondaryValue={usdFromQuantity(settings.clusters.fullScaleVolume)}
                secondaryPrefix="$"
                onPrimaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    clusters: {
                      ...current.clusters,
                      fullScaleVolume: value
                    }
                  }))
                }
                onSecondaryChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    clusters: {
                      ...current.clusters,
                      fullScaleVolume: quantityFromUsd(value)
                    }
                  }))
                }
              />
              <SettingsSwitch
                label="Раскрашивать по дельте"
                checked={settings.clusters.colorByDelta}
                onChange={(checked) =>
                  onUpdate((current) => ({
                    ...current,
                    clusters: {
                      ...current.clusters,
                      colorByDelta: checked
                    }
                  }))
                }
              />
            </div>
          ) : null}

          {section === "trading" ? (
            <div className="space-y-4">
              <SettingsNumberModeRow
                label="Автостоп"
                value={settings.trading.autoStopValue}
                mode={settings.trading.autoStopMode}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      autoStopValue: value
                    }
                  }))
                }
                onModeChange={(mode) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      autoStopMode: mode
                    }
                  }))
                }
              />
              <SettingsNumberModeRow
                label="Автотейк"
                value={settings.trading.autoTakeValue}
                mode={settings.trading.autoTakeMode}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      autoTakeValue: value
                    }
                  }))
                }
                onModeChange={(mode) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      autoTakeMode: mode
                    }
                  }))
                }
              />
              <SettingsNumberModeRow
                label="Дальность заброса лимитных заявок"
                value={settings.trading.limitOffsetValue}
                mode={settings.trading.limitOffsetMode}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      limitOffsetValue: value
                    }
                  }))
                }
                onModeChange={(mode) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      limitOffsetMode: mode
                    }
                  }))
                }
              />
              <SettingsNumberModeRow
                label="Проскальзывание стоп-заявки"
                value={settings.trading.stopSlippageValue}
                mode={settings.trading.stopSlippageMode}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      stopSlippageValue: value
                    }
                  }))
                }
                onModeChange={(mode) =>
                  onUpdate((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      stopSlippageMode: mode
                    }
                  }))
                }
              />
            </div>
          ) : null}

          {section === "alerts" ? (
            <div className="space-y-4">
              {settings.alerts.map((rule) => (
                <div
                  key={rule.id}
                  className="grid gap-3 rounded-2xl border border-white/8 bg-black/20 p-4 lg:grid-cols-[minmax(0,1.2fr)_120px_120px_100px_auto]"
                >
                  <div className="min-w-0">
                    <div className="mb-1 text-sm font-medium text-white">{rule.label}</div>
                    <select
                      value={rule.sound}
                      onChange={(event) =>
                        onUpdate((current) => ({
                          ...current,
                          alerts: current.alerts.map((item) =>
                            item.id === rule.id ? { ...item, sound: event.target.value } : item
                          )
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="Sound 1">Sound 1</option>
                      <option value="Sound 2">Sound 2</option>
                      <option value="Sound 3">Sound 3</option>
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-slate-300">Мин значение</div>
                    <input
                      type="number"
                      min={0}
                      value={rule.minValue}
                      onChange={(event) =>
                        onUpdate((current) => ({
                          ...current,
                          alerts: current.alerts.map((item) =>
                            item.id === rule.id
                              ? { ...item, minValue: Math.max(Number(event.target.value || 0), 0) }
                              : item
                          )
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-slate-300">Макс значение</div>
                    <input
                      type="number"
                      min={0}
                      value={rule.maxValue}
                      onChange={(event) =>
                        onUpdate((current) => ({
                          ...current,
                          alerts: current.alerts.map((item) =>
                            item.id === rule.id
                              ? { ...item, maxValue: Math.max(Number(event.target.value || 0), 0) }
                              : item
                          )
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-slate-300">Ед.</div>
                    <select
                      value={rule.unit}
                      onChange={(event) =>
                        onUpdate((current) => ({
                          ...current,
                          alerts: current.alerts.map((item) =>
                            item.id === rule.id
                              ? { ...item, unit: event.target.value as OrderflowAlertRule["unit"] }
                              : item
                          )
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="$">$</option>
                      <option value="qty">qty</option>
                    </select>
                  </div>
                  <div className="flex items-end justify-end">
                    <SettingsSwitch
                      compact
                      label=""
                      checked={rule.enabled}
                      onChange={(checked) =>
                        onUpdate((current) => ({
                          ...current,
                          alerts: current.alerts.map((item) =>
                            item.id === rule.id ? { ...item, enabled: checked } : item
                          )
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function SettingsValueRow({
  label,
  primaryValue,
  secondaryValue,
  secondaryPrefix,
  onPrimaryChange,
  onSecondaryChange
}: {
  label: string;
  primaryValue: number;
  secondaryValue?: number;
  secondaryPrefix?: string;
  onPrimaryChange: (value: number) => void;
  onSecondaryChange?: (value: number) => void;
}) {
  return (
    <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_120px_120px]">
      <div className="text-sm text-slate-300">{label}</div>
      <input
        type="number"
        min={0}
        step="any"
        value={primaryValue}
        onChange={(event) => onPrimaryChange(Math.max(Number(event.target.value || 0), 0))}
        className="w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none"
      />
      {typeof secondaryValue === "number" ? (
        <div className="relative">
          {secondaryPrefix ? (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              {secondaryPrefix}
            </span>
          ) : null}
          <input
            type="number"
            min={0}
            step="any"
            value={secondaryValue}
            onChange={(event) =>
              onSecondaryChange?.(Math.max(Number(event.target.value || 0), 0))
            }
            className={`w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none ${
              secondaryPrefix ? "pl-7" : ""
            }`}
          />
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}

function SettingsNumberRow({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_120px]">
      <div className="text-sm text-slate-300">{label}</div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(Number(event.target.value || 0), 0))}
        className="w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none"
      />
    </div>
  );
}

function SettingsNumberModeRow({
  label,
  value,
  mode,
  onChange,
  onModeChange
}: {
  label: string;
  value: number;
  mode: TradingOffsetMode;
  onChange: (value: number) => void;
  onModeChange: (mode: TradingOffsetMode) => void;
}) {
  return (
    <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_120px_110px]">
      <div className="text-sm text-slate-300">{label}</div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(Number(event.target.value || 0), 0))}
        className="w-full rounded-xl border border-white/10 bg-[#1f2431] px-3 py-2 text-sm text-slate-100 outline-none"
      />
      <div className="flex rounded-full border border-white/10 bg-[#1f2431] p-1">
        <button
          type="button"
          onClick={() => onModeChange("points")}
          className={`flex-1 rounded-full px-3 py-1 text-sm transition ${
            mode === "points" ? "bg-white text-[#171a26]" : "text-slate-300"
          }`}
        >
          Пункты
        </button>
        <button
          type="button"
          onClick={() => onModeChange("percent")}
          className={`flex-1 rounded-full px-3 py-1 text-sm transition ${
            mode === "percent" ? "bg-white text-[#171a26]" : "text-slate-300"
          }`}
        >
          %
        </button>
      </div>
    </div>
  );
}

function SettingsModeRow({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="text-sm text-slate-300">{label}</div>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#1f2431] p-1">
        {options.map((option) => {
          const active = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? "bg-sky-500/20 text-sky-100" : "text-slate-300 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsSwitch({
  label,
  checked,
  onChange,
  compact = false
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${compact ? "" : "py-1"}`}>
      {label ? <div className="text-sm text-slate-300">{label}</div> : <div />}
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-8 w-14 items-center rounded-full border transition ${
          checked
            ? "border-sky-400/40 bg-sky-500/30"
            : "border-white/10 bg-white/[0.05]"
        }`}
      >
        <span
          className={`inline-block h-6 w-6 rounded-full bg-white transition ${
            checked ? "translate-x-7" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function ChartToolbarPill({
  label,
  active = false
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={`rounded-sm border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
        active
          ? "border-[#58a6ff]/35 bg-[#17304f] text-[#9ed0ff]"
          : "border-[#3a4052] bg-[#171c28] text-slate-300"
      }`}
    >
      {label}
    </span>
  );
}

function ChartToolButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#353b4d] bg-[#151b27] text-[10px] font-semibold text-slate-300 transition hover:border-[#626a83] hover:text-white"
    >
      {label}
    </button>
  );
}

function ChartPriceLine({
  y,
  label,
  price,
  color,
  dashed = false
}: {
  y: number;
  label: string;
  price: number;
  color: string;
  dashed?: boolean;
}) {
  return (
    <g transform={`translate(0 ${y})`} pointerEvents="none">
      <line
        x1="0"
        y1="0"
        x2={chartWidth - 94}
        y2="0"
        stroke={color}
        strokeWidth="1"
        strokeDasharray={dashed ? "5 4" : undefined}
        opacity="0.9"
      />
      <rect
        x={chartWidth - 92}
        y="-11"
        width="88"
        height="18"
        rx="5"
        fill="rgba(15,23,42,0.92)"
        stroke={color}
        strokeWidth="1"
      />
      <text x={chartWidth - 48} y="2.5" textAnchor="middle" fontSize="10" fill={color}>
        {label} {formatPrice(price)}
      </text>
    </g>
  );
}

function AdvancedOrderBookRow({
  level,
  tickSize,
  workingPrice,
  orders,
  settings,
  onClick,
  onDoubleClick
}: {
  level: ReturnType<typeof buildOrderBookLevels>["bids"][number];
  tickSize: number;
  workingPrice: number;
  orders: LocalTradeOrder[];
  settings: OrderflowSettings;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const levelOrders = orders.filter(
    (order) => Math.abs(order.requestedPrice - level.price) <= Math.max(tickSize * 0.5, 0.000001)
  );
  const levelQuantity = levelOrders.reduce((sum, order) => sum + order.quantity, 0);
  const isWorkingLevel =
    Math.abs(workingPrice - level.price) <= Math.max(tickSize * 0.5, 0.000001);
  const metricValue = resolveDepthMetric(level.size, level.price, settings);
  const warningTone =
    settings.general.bigVolume2 > 0 && metricValue >= settings.general.bigVolume2
      ? "border-amber-300/20"
      : settings.general.bigVolume1 > 0 && metricValue >= settings.general.bigVolume1
        ? "border-sky-300/20"
        : "";

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`relative grid w-full grid-cols-[1fr_auto_auto] gap-3 overflow-hidden px-3 py-2 text-left text-sm transition ${
        isWorkingLevel ? "bg-sky-500/12" : "bg-[#131722] hover:bg-white/[0.04]"
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${
          level.side === "bid" ? "bg-emerald-500/12" : "bg-rose-500/12"
        }`}
        style={{ width: `${Math.max(level.depthRatio * 100, 4)}%` }}
      />
      {isWorkingLevel ? (
        <div className="absolute inset-0 border border-sky-400/35" />
      ) : null}
      {warningTone ? <div className={`absolute inset-0 border ${warningTone}`} /> : null}
      <div className="relative z-[1] flex items-center gap-2 text-slate-300">
        <span>{level.cumulative.toFixed(2)}</span>
        {levelOrders.length > 0 ? (
          <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-amber-100">
            {formatQuantity(levelQuantity)}
          </span>
        ) : null}
      </div>
      <span className="relative z-[1] text-slate-200">
        {formatDepthMetric(level.size, level.price, settings)}
      </span>
      <span
        className={`relative z-[1] font-medium ${
          level.side === "bid" ? "text-emerald-200" : "text-rose-200"
        }`}
      >
        {formatPriceWithPrecision(level.price, settings.general.priceDecimals)}
      </span>
    </button>
  );
}

function PaperOrderRow({
  order,
  onCancelOrder,
  compact = false
}: {
  order: LocalTradeOrder;
  onCancelOrder?: (orderId: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-semibold ${order.side === "LONG" ? "text-emerald-300" : "text-rose-300"}`}>
              {order.side}
            </span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
              {order.type}
            </span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              {order.source}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-200">
            {formatPrice(order.requestedPrice)} x {formatQuantity(order.quantity)}
          </div>
          {!compact ? (
            <div className="mt-1 text-xs text-slate-500">
              {formatClockLabel(order.updatedAt)} | {compactUsd(order.notionalUsd)}
            </div>
          ) : null}
        </div>
        {onCancelOrder ? (
          <button
            type="button"
            onClick={() => onCancelOrder(order.id)}
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PaperExecutionRow({ execution }: { execution: LocalTradeExecution }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className={`text-sm font-semibold ${execution.side === "LONG" ? "text-emerald-300" : "text-rose-300"}`}>
          {execution.side}
        </span>
        <span className="text-xs text-slate-500">{formatClockLabel(execution.createdAt)}</span>
      </div>
      <div className="mt-1 text-sm text-slate-200">
        {formatPrice(execution.price)} x {formatQuantity(execution.quantity)}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {compactUsd(execution.notionalUsd)} via {execution.source}
      </div>
    </div>
  );
}

function TradeActionButton({
  label,
  onClick,
  tone,
  detail,
  disabled = false,
  active = false
}: {
  label: string;
  onClick: () => void;
  tone: "buy" | "sell" | "neutral" | "ghost";
  detail?: string;
  disabled?: boolean;
  active?: boolean;
}) {
  const toneClass =
    tone === "buy"
      ? active
        ? "border-emerald-400/45 bg-emerald-500/18 text-emerald-100"
        : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/35"
      : tone === "sell"
        ? active
          ? "border-rose-400/45 bg-rose-500/18 text-rose-100"
          : "border-rose-400/20 bg-rose-500/10 text-rose-200 hover:border-rose-400/35"
        : tone === "neutral"
          ? active
            ? "border-sky-400/45 bg-sky-500/16 text-sky-100"
            : "border-sky-400/20 bg-sky-500/10 text-sky-200 hover:border-sky-400/35"
          : active
            ? "border-white/20 bg-white/[0.12] text-white"
            : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-white";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition ${toneClass} ${
        disabled ? "cursor-not-allowed opacity-45" : ""
      }`}
    >
      <span>{label}</span>
      {detail ? <span className="text-[10px] uppercase tracking-[0.18em] opacity-80">{detail}</span> : null}
    </button>
  );
}

function HotkeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
      {keys}
      <span className="ml-2 text-slate-500">{label}</span>
    </div>
  );
}

function TerminalPaneShell({
  pane,
  className,
  selectedSymbol,
  detail,
  onWidgetChange,
  children
}: {
  pane: WorkspacePane;
  className: string;
  selectedSymbol: string | null;
  detail: string;
  onWidgetChange: (widget: TerminalWidgetId) => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`overflow-hidden bg-[#1d2130] ${className}`}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-[#1b1f2c] px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <WidgetIcon widget={pane.widget} />
              <span>{widgetLabels[pane.widget]}</span>
              {selectedSymbol && pane.widget !== "quotes" ? (
                <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-sky-100">
                  {selectedSymbol}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
          </div>
          <select
            value={pane.widget}
            onChange={(event) => onWidgetChange(event.target.value as TerminalWidgetId)}
            className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-slate-100 outline-none"
          >
            {widgetOptions.map((widget) => (
              <option key={widget.id} value={widget.id}>
                {widgetLabels[widget.id]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </section>
  );
}

function SymbolBucket({
  title,
  rows,
  selectedSymbol,
  emptyText,
  watchlistSet,
  activeTradeSet,
  onSelectRow,
  onToggleWatchlist,
  onToggleActiveTrade
}: {
  title: string;
  rows: ExtendedQuoteRow[];
  selectedSymbol: string | null;
  emptyText: string;
  watchlistSet: Set<string>;
  activeTradeSet: Set<string>;
  onSelectRow: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onToggleActiveTrade: (symbol: string) => void;
}) {
  return (
    <div className="rounded-md border border-white/8 bg-black/20">
      <div className="border-b border-white/8 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
      <div className="space-y-2 p-3">
        {rows.length > 0 ? (
          rows.map((row) => (
            <button
              key={`${title}-${row.symbol}`}
              type="button"
              onClick={() => onSelectRow(row.symbol)}
              className={`w-full rounded-md border p-3 text-left transition ${
                selectedSymbol === row.symbol
                  ? "border-sky-400/25 bg-sky-500/10"
                  : "border-white/8 bg-white/[0.03] hover:border-white/15"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{row.symbol}</div>
                  <div className={`mt-1 text-xs ${deltaClass(row.momentum30sPct)}`}>
                    {formatPercent(row.momentum30sPct, 2)} | {formatPrice(row.lastPrice)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleWatchlist(row.symbol);
                    }}
                    className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                      watchlistSet.has(row.symbol)
                        ? "bg-emerald-500/18 text-emerald-200"
                        : "bg-white/[0.05] text-slate-300"
                    }`}
                  >
                    W
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleActiveTrade(row.symbol);
                    }}
                    className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                      activeTradeSet.has(row.symbol)
                        ? "bg-amber-500/18 text-amber-200"
                        : "bg-white/[0.05] text-slate-300"
                    }`}
                  >
                    T
                  </button>
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-white/10 px-3 py-5 text-sm text-slate-500">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyPane({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="text-lg font-semibold text-white">{title}</div>
        <div className="mt-2 text-sm leading-6 text-slate-400">{description}</div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  className
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className="rounded-sm border border-[#31384a] bg-[#111722] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${className}`}>{value}</div>
    </div>
  );
}

function OrderBookRow({ level }: { level: ReturnType<typeof buildOrderBookLevels>["bids"][number] }) {
  return (
    <div className="relative grid grid-cols-[1fr_auto_auto] gap-3 overflow-hidden bg-[#131722] px-4 py-2 text-sm">
      <div
        className={`absolute inset-y-0 left-0 ${
          level.side === "bid" ? "bg-emerald-500/10" : "bg-rose-500/10"
        }`}
        style={{ width: `${Math.max(level.depthRatio * 100, 4)}%` }}
      />
      <span className="relative z-[1] text-slate-300">{level.cumulative.toFixed(2)}</span>
      <span className="relative z-[1] text-slate-200">{level.size.toFixed(2)}</span>
      <span className={`relative z-[1] font-medium ${level.side === "bid" ? "text-emerald-200" : "text-rose-200"}`}>
        {formatPrice(level.price)}
      </span>
    </div>
  );
}

function QuickToggle({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] transition ${
        active
          ? "border-sky-400/25 bg-sky-500/12 text-sky-100"
          : "border-white/10 bg-white/[0.05] text-slate-300 hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function HeaderCell({
  children,
  active = false,
  sortDirection = "desc",
  onClick
}: {
  children?: React.ReactNode;
  active?: boolean;
  sortDirection?: QuoteFilters["sortDirection"];
  onClick?: () => void;
}) {
  const sortMarker = active ? (sortDirection === "desc" ? "v" : "^") : "";

  return (
    <th
      aria-sort={onClick ? (active ? (sortDirection === "desc" ? "descending" : "ascending") : "none") : undefined}
      className="px-3 py-2 text-left font-medium"
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex items-center gap-1 transition ${
            active ? "text-slate-100" : "text-slate-500 hover:text-slate-200"
          }`}
        >
          <span>{children}</span>
          <span className="w-2 text-[10px] text-slate-400">{sortMarker}</span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Cell({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 text-slate-200 ${className ?? ""}`}>{children}</td>;
}

function ToolbarButton({
  children,
  title,
  active = false,
  onClick
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center rounded-sm border px-2 text-sm transition ${
        active
          ? "border-[#58a6ff]/35 bg-[#111722] text-[#9ed0ff]"
          : "border-[#43495c] bg-[#2a2e40] text-slate-300 hover:border-[#687089] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-sm border border-[#43495c] bg-[#232737] px-2.5 py-1 text-[11px] text-slate-300 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6.5 9.4 4l4 6.1L8.2 20 4 6.5Z" />
      <path d="m13.4 10.1 2.8-4.1L20 8.2 16.8 20l-3.7-9.9Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3.75v2.5" />
      <path d="M12 17.75v2.5" />
      <path d="m5.46 5.46 1.77 1.77" />
      <path d="m16.77 16.77 1.77 1.77" />
      <path d="M3.75 12h2.5" />
      <path d="M17.75 12h2.5" />
      <path d="m5.46 18.54 1.77-1.77" />
      <path d="m16.77 7.23 1.77-1.77" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

function WidgetIcon({ widget }: { widget: TerminalWidgetId }) {
  if (widget === "chart") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 18h16" />
        <path d="m5 15 4-5 4 2 6-7" />
      </svg>
    );
  }

  if (widget === "orderbook") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 5v14" />
        <path d="M12 8h7" />
        <path d="M12 12h5" />
        <path d="M12 16h7" />
        <path d="M5 8h1" />
        <path d="M5 12h1" />
        <path d="M5 16h1" />
      </svg>
    );
  }

  if (widget === "quotes") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </svg>
    );
  }

  if (widget === "watchlist") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 6h12v12H6z" />
        <path d="M10 6v12" />
        <path d="M6 12h12" />
      </svg>
    );
  }

  if (widget === "signalTape") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m4 12 3-3 3 6 4-8 2 5h4" />
      </svg>
    );
  }

  if (widget === "replay") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 5h10v14H7z" />
      <path d="M9 9h6" />
      <path d="M9 13h6" />
    </svg>
  );
}
