import type { Bias, ScreenerRow } from "@/lib/types";

export type TerminalWidgetId =
  | "chart"
  | "orderbook"
  | "quotes"
  | "watchlist"
  | "signalTape"
  | "tradePad"
  | "replay";

export type LayoutPreset = "single" | "split" | "triple" | "quad";
export type WorkspaceSplitDirection = "row" | "column";
export type WorkspaceDockPosition = "center" | "top" | "bottom" | "left" | "right";

export interface WorkspacePane {
  id: string;
  widget: TerminalWidgetId;
}

export interface WorkspaceWidgetTab {
  id: string;
  widget: TerminalWidgetId;
}

export interface WorkspaceLeafNode {
  id: string;
  type: "leaf";
  tabs: WorkspaceWidgetTab[];
  activeTabId: string;
}

export interface WorkspaceSplitNode {
  id: string;
  type: "split";
  direction: WorkspaceSplitDirection;
  children: WorkspaceLayoutNode[];
  sizes?: number[];
}

export type WorkspaceLayoutNode = WorkspaceLeafNode | WorkspaceSplitNode;

export interface WorkspaceFloatingWindow {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  root: WorkspaceLeafNode;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  symbol: string | null;
  layout: LayoutPreset;
  panes: WorkspacePane[];
  root: WorkspaceLayoutNode;
  floatingWindows: WorkspaceFloatingWindow[];
}

export interface WorkspaceState {
  activeTabId: string;
  tabs: WorkspaceTab[];
}

export type QuoteSortKey =
  | "score"
  | "scoreDelta30s"
  | "scoreDelta2m"
  | "scoreDelta24h"
  | "momentum30sPct"
  | "momentum2mPct"
  | "change24hPct"
  | "volumeImpulse"
  | "liquidation5m"
  | "tradeNotional60s"
  | "quoteVolume24h"
  | "spreadBps";

export interface QuoteFilters {
  search: string;
  bias: "ALL" | Bias;
  tag: string;
  minQuoteVolume: number;
  sortBy: QuoteSortKey;
  sortDirection: "asc" | "desc";
  onlyFocus: boolean;
  onlyWatchlist: boolean;
  onlyActiveTrades: boolean;
}

export interface NumericHistoryPoint {
  timestamp: number;
  value: number;
}

export interface ExtendedQuoteRow extends ScreenerRow {
  scoreDelta30s: number | null;
  scoreDelta2m: number | null;
  scoreDelta24h: number | null;
}

export type TradingSide = "LONG" | "SHORT";
export type TradingOrderType = "LIMIT" | "MARKET";
export type TradingOrderStatus = "WORKING" | "FILLED" | "CANCELLED";
export type TradingOrderSource = "ticket" | "orderbook" | "chart" | "hotkey" | "flatten";
export type TradingOffsetMode = "points" | "percent";
export type OrderflowValueMode = "usd" | "qty";
export type OrderflowSettingsSection = "general" | "tape" | "clusters" | "trading" | "alerts";

export interface LocalTradeOrder {
  id: string;
  symbol: string;
  side: TradingSide;
  type: TradingOrderType;
  status: TradingOrderStatus;
  source: TradingOrderSource;
  requestedPrice: number;
  price: number;
  quantity: number;
  notionalUsd: number;
  createdAt: number;
  updatedAt: number;
  filledAt: number | null;
}

export interface LocalTradePosition {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  realizedPnlUsd: number;
  updatedAt: number;
}

export interface LocalTradeExecution {
  id: string;
  orderId: string;
  symbol: string;
  side: TradingSide;
  source: TradingOrderSource;
  price: number;
  quantity: number;
  notionalUsd: number;
  createdAt: number;
}

export interface PaperTradingState {
  ticketNotionalUsd: string;
  ticketSide: TradingSide;
  ticketOrderType: TradingOrderType;
  workingPrices: Record<string, number>;
  orders: LocalTradeOrder[];
  positions: LocalTradePosition[];
  executions: LocalTradeExecution[];
}

export interface OrderflowAlertRule {
  id: string;
  label: string;
  sound: string;
  minValue: number;
  maxValue: number;
  unit: "$" | "qty";
  enabled: boolean;
}

export interface OrderflowSettings {
  general: {
    autoFill: boolean;
    fullScaleVolume: number;
    bigVolume1: number;
    bigVolume2: number;
    bookInUsd: boolean;
    minimizeVolume: boolean;
    priceDecimals: number;
  };
  tape: {
    hideTradeQuantityBelow: number;
    hideTradeValueBelowUsd: number;
    deleteTradeQuantityBelow: number;
    aggregationEnabled: boolean;
    aggregationPeriodSeconds: number;
    displayMode: OrderflowValueMode;
  };
  clusters: {
    fullScaleVolume: number;
    colorByDelta: boolean;
  };
  trading: {
    autoStopValue: number;
    autoStopMode: TradingOffsetMode;
    autoTakeValue: number;
    autoTakeMode: TradingOffsetMode;
    limitOffsetValue: number;
    limitOffsetMode: TradingOffsetMode;
    stopSlippageValue: number;
    stopSlippageMode: TradingOffsetMode;
  };
  alerts: OrderflowAlertRule[];
}
