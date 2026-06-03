import type {
  LocalTradeExecution,
  LocalTradeOrder,
  LocalTradePosition,
  OrderflowAlertRule,
  OrderflowSettings,
  PaperTradingState,
  QuoteFilters,
  TradingOffsetMode,
  WorkspaceState
} from "./types";
import { createDefaultWorkspaceState, normalizeWorkspaceState } from "./workspace";

const workspaceStorageKey = "desktopdaraterminal:workspace";
const prefsStorageKey = "desktopdaraterminal:prefs";

export interface TerminalPrefs {
  backendWsUrl: string;
  watchlist: string[];
  activeTrades: string[];
  filters: QuoteFilters;
  paperTrading: PaperTradingState;
  orderflowSettings: OrderflowSettings;
}

const maxStoredOrders = 80;
const maxStoredExecutions = 60;

const normalizeSymbols = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
        .filter(Boolean)
        .filter((item, index, items) => items.indexOf(item) === index)
    : [];

export const createDefaultQuoteFilters = (): QuoteFilters => ({
  search: "",
  bias: "ALL",
  tag: "ALL",
  minQuoteVolume: 5_000_000,
  sortBy: "score",
  sortDirection: "desc",
  onlyFocus: false,
  onlyWatchlist: false,
  onlyActiveTrades: false
});

export const createDefaultPaperTradingState = (): PaperTradingState => ({
  ticketNotionalUsd: "250",
  ticketSide: "LONG",
  ticketOrderType: "LIMIT",
  workingPrices: {},
  orders: [],
  positions: [],
  executions: []
});

export const createDefaultOrderflowSettings = (): OrderflowSettings => ({
  general: {
    autoFill: true,
    fullScaleVolume: 27_351_224,
    bigVolume1: 27_351_224,
    bigVolume2: 54_702_449,
    bookInUsd: true,
    minimizeVolume: false,
    priceDecimals: 4
  },
  tape: {
    hideTradeQuantityBelow: 0,
    hideTradeValueBelowUsd: 0,
    deleteTradeQuantityBelow: 0,
    aggregationEnabled: true,
    aggregationPeriodSeconds: 5,
    displayMode: "usd"
  },
  clusters: {
    fullScaleVolume: 27_351_224,
    colorByDelta: true
  },
  trading: {
    autoStopValue: 0,
    autoStopMode: "points",
    autoTakeValue: 0,
    autoTakeMode: "points",
    limitOffsetValue: 0,
    limitOffsetMode: "points",
    stopSlippageValue: 0,
    stopSlippageMode: "points"
  },
  alerts: [
    {
      id: "book-large-size",
      label: "Крупный объём стакана",
      sound: "Sound 2",
      minValue: 0,
      maxValue: 0,
      unit: "$",
      enabled: false
    },
    {
      id: "tape-large-print",
      label: "Крупный принт стакана",
      sound: "Sound 1",
      minValue: 0,
      maxValue: 0,
      unit: "$",
      enabled: false
    }
  ]
});

const normalizeOrder = (value: unknown): LocalTradeOrder | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const order = value as Partial<LocalTradeOrder>;
  const side = order.side === "SHORT" ? "SHORT" : order.side === "LONG" ? "LONG" : null;
  const type = order.type === "MARKET" ? "MARKET" : order.type === "LIMIT" ? "LIMIT" : null;
  const status =
    order.status === "FILLED"
      ? "FILLED"
      : order.status === "CANCELLED"
        ? "CANCELLED"
        : order.status === "WORKING"
          ? "WORKING"
          : null;
  const source =
    order.source === "orderbook" ||
    order.source === "chart" ||
    order.source === "hotkey" ||
    order.source === "flatten" ||
    order.source === "ticket"
      ? order.source
      : null;

  if (
    typeof order.id !== "string" ||
    typeof order.symbol !== "string" ||
    !side ||
    !type ||
    !status ||
    !source ||
    typeof order.requestedPrice !== "number" ||
    !Number.isFinite(order.requestedPrice) ||
    typeof order.price !== "number" ||
    !Number.isFinite(order.price) ||
    typeof order.quantity !== "number" ||
    !Number.isFinite(order.quantity) ||
    typeof order.notionalUsd !== "number" ||
    !Number.isFinite(order.notionalUsd) ||
    typeof order.createdAt !== "number" ||
    !Number.isFinite(order.createdAt) ||
    typeof order.updatedAt !== "number" ||
    !Number.isFinite(order.updatedAt)
  ) {
    return null;
  }

  return {
    id: order.id,
    symbol: order.symbol.trim().toUpperCase(),
    side,
    type,
    status,
    source,
    requestedPrice: order.requestedPrice,
    price: order.price,
    quantity: Math.max(order.quantity, 0),
    notionalUsd: Math.max(order.notionalUsd, 0),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    filledAt:
      typeof order.filledAt === "number" && Number.isFinite(order.filledAt) ? order.filledAt : null
  };
};

const normalizePosition = (value: unknown): LocalTradePosition | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const position = value as Partial<LocalTradePosition>;

  if (
    typeof position.symbol !== "string" ||
    typeof position.quantity !== "number" ||
    !Number.isFinite(position.quantity) ||
    typeof position.avgEntryPrice !== "number" ||
    !Number.isFinite(position.avgEntryPrice) ||
    typeof position.realizedPnlUsd !== "number" ||
    !Number.isFinite(position.realizedPnlUsd) ||
    typeof position.updatedAt !== "number" ||
    !Number.isFinite(position.updatedAt)
  ) {
    return null;
  }

  return {
    symbol: position.symbol.trim().toUpperCase(),
    quantity: position.quantity,
    avgEntryPrice: Math.max(position.avgEntryPrice, 0),
    realizedPnlUsd: position.realizedPnlUsd,
    updatedAt: position.updatedAt
  };
};

const normalizeExecution = (value: unknown): LocalTradeExecution | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const execution = value as Partial<LocalTradeExecution>;
  const side = execution.side === "SHORT" ? "SHORT" : execution.side === "LONG" ? "LONG" : null;
  const source =
    execution.source === "orderbook" ||
    execution.source === "chart" ||
    execution.source === "hotkey" ||
    execution.source === "flatten" ||
    execution.source === "ticket"
      ? execution.source
      : null;

  if (
    typeof execution.id !== "string" ||
    typeof execution.orderId !== "string" ||
    typeof execution.symbol !== "string" ||
    !side ||
    !source ||
    typeof execution.price !== "number" ||
    !Number.isFinite(execution.price) ||
    typeof execution.quantity !== "number" ||
    !Number.isFinite(execution.quantity) ||
    typeof execution.notionalUsd !== "number" ||
    !Number.isFinite(execution.notionalUsd) ||
    typeof execution.createdAt !== "number" ||
    !Number.isFinite(execution.createdAt)
  ) {
    return null;
  }

  return {
    id: execution.id,
    orderId: execution.orderId,
    symbol: execution.symbol.trim().toUpperCase(),
    side,
    source,
    price: execution.price,
    quantity: Math.max(execution.quantity, 0),
    notionalUsd: Math.max(execution.notionalUsd, 0),
    createdAt: execution.createdAt
  };
};

const normalizeWorkingPrices = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
    (accumulator, [symbol, price]) => {
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        accumulator[symbol.trim().toUpperCase()] = price;
      }

      return accumulator;
    },
    {}
  );
};

const normalizePositiveNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : fallback;

const normalizeInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(Math.round(value), 0) : fallback;

const normalizeOffsetMode = (value: unknown, fallback: TradingOffsetMode): TradingOffsetMode =>
  value === "percent" || value === "points" ? value : fallback;

const normalizeAlertRule = (
  value: unknown,
  fallback: OrderflowAlertRule
): OrderflowAlertRule => {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const rule = value as Partial<OrderflowAlertRule>;

  return {
    id: typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : fallback.id,
    label:
      typeof rule.label === "string" && rule.label.trim() ? rule.label.trim() : fallback.label,
    sound:
      typeof rule.sound === "string" && rule.sound.trim() ? rule.sound.trim() : fallback.sound,
    minValue: normalizePositiveNumber(rule.minValue, fallback.minValue),
    maxValue: normalizePositiveNumber(rule.maxValue, fallback.maxValue),
    unit: rule.unit === "qty" ? "qty" : "$",
    enabled: typeof rule.enabled === "boolean" ? rule.enabled : fallback.enabled
  };
};

const normalizeOrderflowSettings = (value: unknown): OrderflowSettings => {
  const defaults = createDefaultOrderflowSettings();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const parsed = value as Partial<OrderflowSettings>;

  return {
    general: {
      autoFill:
        typeof parsed.general?.autoFill === "boolean"
          ? parsed.general.autoFill
          : defaults.general.autoFill,
      fullScaleVolume: normalizePositiveNumber(
        parsed.general?.fullScaleVolume,
        defaults.general.fullScaleVolume
      ),
      bigVolume1: normalizePositiveNumber(parsed.general?.bigVolume1, defaults.general.bigVolume1),
      bigVolume2: normalizePositiveNumber(parsed.general?.bigVolume2, defaults.general.bigVolume2),
      bookInUsd:
        typeof parsed.general?.bookInUsd === "boolean"
          ? parsed.general.bookInUsd
          : defaults.general.bookInUsd,
      minimizeVolume:
        typeof parsed.general?.minimizeVolume === "boolean"
          ? parsed.general.minimizeVolume
          : defaults.general.minimizeVolume,
      priceDecimals: normalizeInteger(
        parsed.general?.priceDecimals,
        defaults.general.priceDecimals
      )
    },
    tape: {
      hideTradeQuantityBelow: normalizePositiveNumber(
        parsed.tape?.hideTradeQuantityBelow,
        defaults.tape.hideTradeQuantityBelow
      ),
      hideTradeValueBelowUsd: normalizePositiveNumber(
        parsed.tape?.hideTradeValueBelowUsd,
        defaults.tape.hideTradeValueBelowUsd
      ),
      deleteTradeQuantityBelow: normalizePositiveNumber(
        parsed.tape?.deleteTradeQuantityBelow,
        defaults.tape.deleteTradeQuantityBelow
      ),
      aggregationEnabled:
        typeof parsed.tape?.aggregationEnabled === "boolean"
          ? parsed.tape.aggregationEnabled
          : defaults.tape.aggregationEnabled,
      aggregationPeriodSeconds: normalizeInteger(
        parsed.tape?.aggregationPeriodSeconds,
        defaults.tape.aggregationPeriodSeconds
      ),
      displayMode: parsed.tape?.displayMode === "qty" ? "qty" : defaults.tape.displayMode
    },
    clusters: {
      fullScaleVolume: normalizePositiveNumber(
        parsed.clusters?.fullScaleVolume,
        defaults.clusters.fullScaleVolume
      ),
      colorByDelta:
        typeof parsed.clusters?.colorByDelta === "boolean"
          ? parsed.clusters.colorByDelta
          : defaults.clusters.colorByDelta
    },
    trading: {
      autoStopValue: normalizePositiveNumber(
        parsed.trading?.autoStopValue,
        defaults.trading.autoStopValue
      ),
      autoStopMode: normalizeOffsetMode(
        parsed.trading?.autoStopMode,
        defaults.trading.autoStopMode
      ),
      autoTakeValue: normalizePositiveNumber(
        parsed.trading?.autoTakeValue,
        defaults.trading.autoTakeValue
      ),
      autoTakeMode: normalizeOffsetMode(
        parsed.trading?.autoTakeMode,
        defaults.trading.autoTakeMode
      ),
      limitOffsetValue: normalizePositiveNumber(
        parsed.trading?.limitOffsetValue,
        defaults.trading.limitOffsetValue
      ),
      limitOffsetMode: normalizeOffsetMode(
        parsed.trading?.limitOffsetMode,
        defaults.trading.limitOffsetMode
      ),
      stopSlippageValue: normalizePositiveNumber(
        parsed.trading?.stopSlippageValue,
        defaults.trading.stopSlippageValue
      ),
      stopSlippageMode: normalizeOffsetMode(
        parsed.trading?.stopSlippageMode,
        defaults.trading.stopSlippageMode
      )
    },
    alerts: defaults.alerts.map((fallbackRule) => {
      const matchedRule = Array.isArray(parsed.alerts)
        ? parsed.alerts.find(
            (rule) =>
              rule &&
              typeof rule === "object" &&
              "id" in rule &&
              (rule as { id?: unknown }).id === fallbackRule.id
          )
        : null;

      return normalizeAlertRule(matchedRule, fallbackRule);
    })
  };
};

const normalizePaperTradingState = (value: unknown): PaperTradingState => {
  const defaults = createDefaultPaperTradingState();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const parsed = value as Partial<PaperTradingState>;

  return {
    ticketNotionalUsd:
      typeof parsed.ticketNotionalUsd === "string" && parsed.ticketNotionalUsd.trim()
        ? parsed.ticketNotionalUsd.trim()
        : defaults.ticketNotionalUsd,
    ticketSide: parsed.ticketSide === "SHORT" ? "SHORT" : defaults.ticketSide,
    ticketOrderType: parsed.ticketOrderType === "MARKET" ? "MARKET" : defaults.ticketOrderType,
    workingPrices: normalizeWorkingPrices(parsed.workingPrices),
    orders: Array.isArray(parsed.orders)
      ? parsed.orders.map(normalizeOrder).filter(Boolean).slice(0, maxStoredOrders) as LocalTradeOrder[]
      : defaults.orders,
    positions: Array.isArray(parsed.positions)
      ? parsed.positions.map(normalizePosition).filter(Boolean) as LocalTradePosition[]
      : defaults.positions,
    executions: Array.isArray(parsed.executions)
      ? parsed.executions
          .map(normalizeExecution)
          .filter(Boolean)
          .slice(0, maxStoredExecutions) as LocalTradeExecution[]
      : defaults.executions
  };
};

export const loadWorkspaceState = (): WorkspaceState => {
  if (typeof window === "undefined") {
    return createDefaultWorkspaceState();
  }

  try {
    const raw = window.localStorage.getItem(workspaceStorageKey);
    return normalizeWorkspaceState(raw ? JSON.parse(raw) : null);
  } catch {
    return createDefaultWorkspaceState();
  }
};

export const saveWorkspaceState = (workspace: WorkspaceState): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(workspaceStorageKey, JSON.stringify(workspace));
};

export const loadTerminalPrefs = (): TerminalPrefs | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(prefsStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<TerminalPrefs>;
    const defaults = createDefaultQuoteFilters();

    return {
      backendWsUrl:
        typeof parsed.backendWsUrl === "string" ? parsed.backendWsUrl.trim() : "",
      watchlist: normalizeSymbols(parsed.watchlist),
      activeTrades: normalizeSymbols(parsed.activeTrades),
      filters: {
        ...defaults,
        ...(parsed.filters ?? {}),
        bias:
          parsed.filters?.bias === "LONG" ||
          parsed.filters?.bias === "SHORT" ||
          parsed.filters?.bias === "NEUTRAL"
            ? parsed.filters.bias
            : defaults.bias,
        tag:
          typeof parsed.filters?.tag === "string" && parsed.filters.tag.trim()
            ? parsed.filters.tag.trim()
            : defaults.tag,
        sortBy:
          typeof parsed.filters?.sortBy === "string" ? parsed.filters.sortBy : defaults.sortBy,
        sortDirection:
          parsed.filters?.sortDirection === "asc" ? "asc" : defaults.sortDirection,
        minQuoteVolume:
          typeof parsed.filters?.minQuoteVolume === "number" &&
          Number.isFinite(parsed.filters.minQuoteVolume)
            ? Math.max(0, parsed.filters.minQuoteVolume)
            : defaults.minQuoteVolume
      },
      paperTrading: normalizePaperTradingState(parsed.paperTrading),
      orderflowSettings: normalizeOrderflowSettings(parsed.orderflowSettings)
    };
  } catch {
    return null;
  }
};

export const saveTerminalPrefs = (prefs: TerminalPrefs): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    prefsStorageKey,
    JSON.stringify({
      ...prefs,
      paperTrading: {
        ...prefs.paperTrading,
        orders: prefs.paperTrading.orders.slice(0, maxStoredOrders),
        executions: prefs.paperTrading.executions.slice(0, maxStoredExecutions)
      }
    })
  );
};
