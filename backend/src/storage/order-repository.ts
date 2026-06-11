import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  OrderAckMessage,
  OrderAuditEventPayload,
  OrderErrorMessage,
  PaperPositionCloseReason,
  PaperPositionPayload,
  PaperPositionSide,
  OrderRejectedMessage,
  OrderStatePayload
} from "../types/messages";
import { getSqlite } from "./sqlite";

type OrderIntentResponseMessage = OrderAckMessage | OrderRejectedMessage | OrderErrorMessage;

export interface StoredOrderIntentResponse {
  intentId: string;
  createdAt: number;
  sourceWindowId: string | null;
  orderId: string | null;
  responseType: OrderIntentResponseMessage["type"];
  dryRun: boolean;
  response: OrderIntentResponseMessage;
}

interface OrderRow {
  id: string;
  intent_id: string | null;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price: number | null;
  stop_price: number | null;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  status: string;
  client_order_id: string;
  exchange_order_id: string | null;
  source_window_id: string | null;
  parent_order_id: string | null;
  protective_kind: string | null;
  dry_run: number;
  reduce_only: number;
  executed_qty: number;
  avg_price: number | null;
  last_filled_qty: number | null;
  realized_pnl: number | null;
  commission: number | null;
  commission_asset: string | null;
  last_execution_type: string | null;
  last_trade_time: number | null;
  reject_reason: string | null;
  created_at: number;
  updated_at: number;
  last_event_source: string;
}

interface OrderAuditRow {
  id: string;
  order_id: string;
  intent_id: string | null;
  timestamp: number;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price: number | null;
  client_order_id: string;
  status: string;
  source_window_id: string | null;
  dry_run: number;
  event_type: string;
  message: string | null;
}

interface OrderIntentRow {
  intent_id: string;
  created_at: number;
  source_window_id: string | null;
  order_id: string | null;
  response_type: OrderIntentResponseMessage["type"];
  dry_run: number;
  response_json: string;
}

interface PaperPositionRow {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  entry_order_id: string;
  stop_loss_order_id: string | null;
  take_profit_order_id: string | null;
  status: string;
  opened_at: number;
  closed_at: number | null;
  close_price: number | null;
  close_reason: string | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  paper_mode: number;
  updated_at: number;
}

interface RealizedPnlLedgerRow {
  trading_day: string;
  gross_realized_pnl: number;
  total_commission: number;
  net_realized_pnl: number;
  events_count: number;
  last_event_time: number | null;
}

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const toNullableNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toBooleanInt = (value: boolean): number => (value ? 1 : 0);

const toBoolean = (value: number): boolean => value !== 0;

const DAY_BOUNDARY_TIME_ZONE = "UTC";

const toTradingDay = (timestamp: number): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: DAY_BOUNDARY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));

const parseJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const toOrderState = (row: OrderRow): OrderStatePayload => ({
  orderId: row.id,
  intentId: row.intent_id,
  symbol: row.symbol,
  side: row.side as OrderStatePayload["side"],
  orderType: row.type as OrderStatePayload["orderType"],
  quantity: row.quantity,
  price: row.price,
  stopPrice: row.stop_price,
  stopLossPrice: row.stop_loss_price,
  takeProfitPrice: row.take_profit_price,
  status: row.status as OrderStatePayload["status"],
  clientOrderId: row.client_order_id,
  exchangeOrderId: row.exchange_order_id,
  sourceWindowId: row.source_window_id,
  parentOrderId: row.parent_order_id,
  protectiveKind: row.protective_kind as OrderStatePayload["protectiveKind"],
  dryRun: toBoolean(row.dry_run),
  reduceOnly: toBoolean(row.reduce_only),
  executedQty: row.executed_qty,
  avgPrice: row.avg_price,
  lastFilledQty: row.last_filled_qty,
  realizedPnl: row.realized_pnl,
  commission: row.commission,
  commissionAsset: row.commission_asset,
  lastExecutionType: row.last_execution_type,
  lastTradeTime: row.last_trade_time,
  rejectReason: row.reject_reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastEventSource: row.last_event_source as OrderStatePayload["lastEventSource"]
});

const toOrderAuditEvent = (row: OrderAuditRow): OrderAuditEventPayload => ({
  auditId: row.id,
  orderId: row.order_id,
  intentId: row.intent_id,
  timestamp: row.timestamp,
  symbol: row.symbol,
  side: row.side as OrderAuditEventPayload["side"],
  orderType: row.type as OrderAuditEventPayload["orderType"],
  quantity: row.quantity,
  price: row.price,
  clientOrderId: row.client_order_id,
  status: row.status as OrderAuditEventPayload["status"],
  sourceWindowId: row.source_window_id,
  dryRun: toBoolean(row.dry_run),
  eventType: row.event_type,
  message: row.message
});

const toPaperPosition = (row: PaperPositionRow): PaperPositionPayload => ({
  paperPositionId: row.id,
  symbol: row.symbol,
  side: row.side as PaperPositionPayload["side"],
  quantity: row.quantity,
  entryPrice: row.entry_price,
  entryOrderId: row.entry_order_id,
  stopLossOrderId: row.stop_loss_order_id,
  takeProfitOrderId: row.take_profit_order_id,
  status: row.status as PaperPositionPayload["status"],
  openedAt: row.opened_at,
  closedAt: row.closed_at,
  closePrice: row.close_price,
  closeReason: row.close_reason as PaperPositionPayload["closeReason"],
  realizedPnl: row.realized_pnl,
  unrealizedPnl: row.unrealized_pnl,
  paperMode: true
});

export class OrderRepository {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  upsertOrderState(order: OrderStatePayload): OrderStatePayload {
    this.db
      .prepare(
        `
          INSERT INTO orders (
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(client_order_id) DO UPDATE SET
            intent_id = excluded.intent_id,
            symbol = excluded.symbol,
            side = excluded.side,
            type = excluded.type,
            quantity = excluded.quantity,
            price = excluded.price,
            stop_price = excluded.stop_price,
            stop_loss_price = excluded.stop_loss_price,
            take_profit_price = excluded.take_profit_price,
            status = excluded.status,
            exchange_order_id = excluded.exchange_order_id,
            source_window_id = excluded.source_window_id,
            parent_order_id = excluded.parent_order_id,
            protective_kind = excluded.protective_kind,
            dry_run = excluded.dry_run,
            reduce_only = excluded.reduce_only,
            executed_qty = excluded.executed_qty,
            avg_price = excluded.avg_price,
            last_filled_qty = excluded.last_filled_qty,
            realized_pnl = excluded.realized_pnl,
            commission = excluded.commission,
            commission_asset = excluded.commission_asset,
            last_execution_type = excluded.last_execution_type,
            last_trade_time = excluded.last_trade_time,
            reject_reason = excluded.reject_reason,
            updated_at = excluded.updated_at,
            last_event_source = excluded.last_event_source
        `
      )
      .run(
        order.orderId,
        normalizeText(order.intentId),
        normalizeSymbol(order.symbol),
        order.side,
        order.orderType,
        order.quantity,
        toNullableNumber(order.price),
        toNullableNumber(order.stopPrice),
        toNullableNumber(order.stopLossPrice),
        toNullableNumber(order.takeProfitPrice),
        order.status,
        order.clientOrderId,
        normalizeText(order.exchangeOrderId),
        normalizeText(order.sourceWindowId),
        normalizeText(order.parentOrderId),
        normalizeText(order.protectiveKind),
        toBooleanInt(order.dryRun),
        toBooleanInt(order.reduceOnly),
        order.executedQty,
        toNullableNumber(order.avgPrice),
        toNullableNumber(order.lastFilledQty),
        toNullableNumber(order.realizedPnl),
        toNullableNumber(order.commission),
        normalizeText(order.commissionAsset),
        normalizeText(order.lastExecutionType),
        toNullableNumber(order.lastTradeTime),
        normalizeText(order.rejectReason),
        order.createdAt,
        order.updatedAt,
        order.lastEventSource
      );

    return order;
  }

  getOrderByClientOrderId(clientOrderId: string): OrderStatePayload | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE client_order_id = ?
          LIMIT 1
        `
      )
      .get(clientOrderId.trim()) as OrderRow | undefined;

    return row ? toOrderState(row) : null;
  }

  getOrderByOrderId(orderId: string): OrderStatePayload | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(orderId.trim()) as OrderRow | undefined;

    return row ? toOrderState(row) : null;
  }

  getOrderByIntentId(intentId: string): OrderStatePayload | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE intent_id = ?
          LIMIT 1
        `
      )
      .get(intentId.trim()) as OrderRow | undefined;

    return row ? toOrderState(row) : null;
  }

  listOrdersForIntentChain(intentId: string): OrderStatePayload[] {
    const normalizedIntentId = normalizeText(intentId);
    if (!normalizedIntentId) {
      return [];
    }

    const rootRows = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE intent_id = ?
          ORDER BY created_at ASC, updated_at ASC
        `
      )
      .all(normalizedIntentId) as OrderRow[];
    const rootIds = rootRows.map((row) => row.id);

    if (rootIds.length === 0) {
      return [];
    }

    const placeholders = rootIds.map(() => "?").join(", ");
    const childRows = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE parent_order_id IN (${placeholders})
          ORDER BY created_at ASC, updated_at ASC
        `
      )
      .all(...rootIds) as OrderRow[];
    const rowsById = new Map<string, OrderRow>();

    for (const row of [...rootRows, ...childRows]) {
      rowsById.set(row.id, row);
    }

    return Array.from(rowsById.values())
      .sort((left, right) => left.created_at - right.created_at || left.updated_at - right.updated_at)
      .map(toOrderState);
  }

  listRecentOrders(limit = 50): OrderStatePayload[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE dry_run = 1
          ORDER BY updated_at DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as OrderRow[];

    return rows.map(toOrderState);
  }

  listActivePaperLimitOrdersForSymbols(symbols: string[]): OrderStatePayload[] {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))
    );

    if (normalizedSymbols.length === 0) {
      return [];
    }

    const placeholders = normalizedSymbols.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE dry_run = 1
            AND type = 'LIMIT'
            AND status = 'NEW'
            AND reduce_only = 0
            AND protective_kind IS NULL
            AND symbol IN (${placeholders})
          ORDER BY updated_at ASC
        `
      )
      .all(...normalizedSymbols) as OrderRow[];

    return rows.map(toOrderState);
  }

  listRecoverablePaperMarketOrders(limit = 100): OrderStatePayload[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE dry_run = 1
            AND type = 'MARKET'
            AND status IN ('NEW', 'PARTIALLY_FILLED')
            AND reduce_only = 0
            AND protective_kind IS NULL
          ORDER BY updated_at ASC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as OrderRow[];

    return rows.map(toOrderState);
  }

  listActivePaperProtectiveLegsForSymbols(symbols: string[]): OrderStatePayload[] {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))
    );

    if (normalizedSymbols.length === 0) {
      return [];
    }

    const placeholders = normalizedSymbols.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE dry_run = 1
            AND protective_kind IS NOT NULL
            AND status IN ('NEW', 'PARTIALLY_FILLED')
            AND symbol IN (${placeholders})
          ORDER BY updated_at ASC
        `
      )
      .all(...normalizedSymbols) as OrderRow[];

    return rows.map(toOrderState);
  }

  listActivePaperProtectiveSiblings(parentOrderId: string, excludeOrderId: string): OrderStatePayload[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            intent_id,
            symbol,
            side,
            type,
            quantity,
            price,
            stop_price,
            stop_loss_price,
            take_profit_price,
            status,
            client_order_id,
            exchange_order_id,
            source_window_id,
            parent_order_id,
            protective_kind,
            dry_run,
            reduce_only,
            executed_qty,
            avg_price,
            last_filled_qty,
            realized_pnl,
            commission,
            commission_asset,
            last_execution_type,
            last_trade_time,
            reject_reason,
            created_at,
            updated_at,
            last_event_source
          FROM orders
          WHERE dry_run = 1
            AND parent_order_id = ?
            AND id <> ?
            AND protective_kind IS NOT NULL
            AND status IN ('NEW', 'PARTIALLY_FILLED')
        `
      )
      .all(parentOrderId.trim(), excludeOrderId.trim()) as OrderRow[];

    return rows.map(toOrderState);
  }

  createPaperPosition(input: {
    paperPositionId: string;
    symbol: string;
    side: PaperPositionSide;
    quantity: number;
    entryPrice: number;
    entryOrderId: string;
    stopLossOrderId?: string | null;
    takeProfitOrderId?: string | null;
    openedAt?: number;
  }): PaperPositionPayload {
    const openedAt = input.openedAt ?? Date.now();

    this.db
      .prepare(
        `
          INSERT INTO paper_positions (
            id,
            symbol,
            side,
            quantity,
            entry_price,
            entry_order_id,
            stop_loss_order_id,
            take_profit_order_id,
            status,
            opened_at,
            closed_at,
            close_price,
            close_reason,
            realized_pnl,
            unrealized_pnl,
            paper_mode,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, NULL, NULL, NULL, NULL, 0, 1, ?)
          ON CONFLICT(entry_order_id) DO UPDATE SET
            stop_loss_order_id = excluded.stop_loss_order_id,
            take_profit_order_id = excluded.take_profit_order_id,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.paperPositionId,
        normalizeSymbol(input.symbol),
        input.side,
        input.quantity,
        input.entryPrice,
        input.entryOrderId,
        normalizeText(input.stopLossOrderId),
        normalizeText(input.takeProfitOrderId),
        openedAt,
        openedAt
      );

    const position = this.getPaperPositionByEntryOrderId(input.entryOrderId);
    if (!position) {
      throw new Error("Paper position was not persisted.");
    }

    return position;
  }

  closePaperPosition(input: {
    paperPositionId: string;
    closePrice: number;
    closeReason: PaperPositionCloseReason;
    closedAt?: number;
  }): PaperPositionPayload | null {
    const existing = this.getPaperPositionById(input.paperPositionId);

    if (!existing || existing.status !== "OPEN") {
      return existing;
    }

    const closedAt = input.closedAt ?? Date.now();
    const realizedPnl =
      existing.side === "LONG"
        ? (input.closePrice - existing.entryPrice) * existing.quantity
        : (existing.entryPrice - input.closePrice) * existing.quantity;

    this.db
      .prepare(
        `
          UPDATE paper_positions
          SET
            status = 'CLOSED',
            closed_at = ?,
            close_price = ?,
            close_reason = ?,
            realized_pnl = ?,
            unrealized_pnl = 0,
            updated_at = ?
          WHERE id = ?
            AND status = 'OPEN'
        `
      )
      .run(closedAt, input.closePrice, input.closeReason, realizedPnl, closedAt, input.paperPositionId);

    return this.getPaperPositionById(input.paperPositionId);
  }

  updateUnrealizedPnl(input: {
    paperPositionId: string;
    marketPrice: number;
    updatedAt?: number;
  }): PaperPositionPayload | null {
    const existing = this.getPaperPositionById(input.paperPositionId);

    if (!existing || existing.status !== "OPEN") {
      return existing;
    }

    const updatedAt = input.updatedAt ?? Date.now();
    const unrealizedPnl =
      existing.side === "LONG"
        ? (input.marketPrice - existing.entryPrice) * existing.quantity
        : (existing.entryPrice - input.marketPrice) * existing.quantity;

    this.db
      .prepare(
        `
          UPDATE paper_positions
          SET
            unrealized_pnl = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'OPEN'
        `
      )
      .run(unrealizedPnl, updatedAt, input.paperPositionId);

    return this.getPaperPositionById(input.paperPositionId);
  }

  appendRealizedPnlLedgerEntry(input: {
    id: string;
    idempotencyKey: string;
    source: "binance_order_trade_update" | "paper_position_close";
    eventTime: number;
    symbol: string;
    orderId?: string | null;
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
    tradeId?: string | null;
    realizedPnl: number;
    commission?: number | null;
    commissionAsset?: string | null;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO realized_pnl_ledger (
            id,
            idempotency_key,
            source,
            trading_day,
            event_time,
            symbol,
            order_id,
            client_order_id,
            exchange_order_id,
            trade_id,
            realized_pnl,
            commission,
            commission_asset,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING
        `
      )
      .run(
        input.id,
        input.idempotencyKey,
        input.source,
        toTradingDay(input.eventTime),
        input.eventTime,
        normalizeSymbol(input.symbol),
        normalizeText(input.orderId),
        normalizeText(input.clientOrderId),
        normalizeText(input.exchangeOrderId),
        normalizeText(input.tradeId),
        input.realizedPnl,
        toNullableNumber(input.commission),
        normalizeText(input.commissionAsset),
        Date.now()
      );
  }

  getCurrentTradingDayRealizedPnlSummary(now = Date.now()): {
    tradingDay: string;
    grossRealizedPnl: number;
    totalCommission: number;
    netRealizedPnl: number;
    eventsCount: number;
    lastEventTime: number | null;
    sourceStatus: "AUTHORITATIVE";
    timeZone: "UTC";
  } {
    const tradingDay = toTradingDay(now);
    const row = this.db
      .prepare(
        `
          SELECT
            trading_day,
            COALESCE(SUM(realized_pnl), 0) AS gross_realized_pnl,
            COALESCE(SUM(commission), 0) AS total_commission,
            COALESCE(SUM(realized_pnl) - SUM(COALESCE(commission, 0)), 0) AS net_realized_pnl,
            COUNT(*) AS events_count,
            MAX(event_time) AS last_event_time
          FROM realized_pnl_ledger
          WHERE trading_day = ?
          GROUP BY trading_day
          LIMIT 1
        `
      )
      .get(tradingDay) as RealizedPnlLedgerRow | undefined;

    return {
      tradingDay,
      grossRealizedPnl: row?.gross_realized_pnl ?? 0,
      totalCommission: row?.total_commission ?? 0,
      netRealizedPnl: row?.net_realized_pnl ?? 0,
      eventsCount: row?.events_count ?? 0,
      lastEventTime: row?.last_event_time ?? null,
      sourceStatus: "AUTHORITATIVE",
      timeZone: "UTC"
    };
  }

  clearPaperPositionProtectiveLeg(input: {
    paperPositionId: string;
    orderId: string;
    updatedAt?: number;
  }): PaperPositionPayload | null {
    const updatedAt = input.updatedAt ?? Date.now();

    this.db
      .prepare(
        `
          UPDATE paper_positions
          SET
            stop_loss_order_id = CASE
              WHEN stop_loss_order_id = ? THEN NULL
              ELSE stop_loss_order_id
            END,
            take_profit_order_id = CASE
              WHEN take_profit_order_id = ? THEN NULL
              ELSE take_profit_order_id
            END,
            updated_at = ?
          WHERE id = ?
            AND status = 'OPEN'
            AND (stop_loss_order_id = ? OR take_profit_order_id = ?)
        `
      )
      .run(
        input.orderId,
        input.orderId,
        updatedAt,
        input.paperPositionId.trim(),
        input.orderId,
        input.orderId
      );

    return this.getPaperPositionById(input.paperPositionId);
  }

  listOpenPaperPositions(symbols?: string[]): PaperPositionPayload[] {
    const normalizedSymbols = symbols
      ? Array.from(new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)))
      : [];

    const symbolClause = normalizedSymbols.length > 0
      ? `AND symbol IN (${normalizedSymbols.map(() => "?").join(", ")})`
      : "";
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            symbol,
            side,
            quantity,
            entry_price,
            entry_order_id,
            stop_loss_order_id,
            take_profit_order_id,
            status,
            opened_at,
            closed_at,
            close_price,
            close_reason,
            realized_pnl,
            unrealized_pnl,
            paper_mode,
            updated_at
          FROM paper_positions
          WHERE paper_mode = 1
            AND status = 'OPEN'
            ${symbolClause}
          ORDER BY opened_at ASC
        `
      )
      .all(...normalizedSymbols) as PaperPositionRow[];

    return rows.map(toPaperPosition);
  }

  listRecentPaperPositions(limit = 100): PaperPositionPayload[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            symbol,
            side,
            quantity,
            entry_price,
            entry_order_id,
            stop_loss_order_id,
            take_profit_order_id,
            status,
            opened_at,
            closed_at,
            close_price,
            close_reason,
            realized_pnl,
            unrealized_pnl,
            paper_mode,
            updated_at
          FROM paper_positions
          WHERE paper_mode = 1
            AND status = 'CLOSED'
          ORDER BY updated_at DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as PaperPositionRow[];

    return rows.map(toPaperPosition);
  }

  getPaperPositionById(paperPositionId: string): PaperPositionPayload | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            symbol,
            side,
            quantity,
            entry_price,
            entry_order_id,
            stop_loss_order_id,
            take_profit_order_id,
            status,
            opened_at,
            closed_at,
            close_price,
            close_reason,
            realized_pnl,
            unrealized_pnl,
            paper_mode,
            updated_at
          FROM paper_positions
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(paperPositionId.trim()) as PaperPositionRow | undefined;

    return row ? toPaperPosition(row) : null;
  }

  getPaperPositionByEntryOrderId(entryOrderId: string): PaperPositionPayload | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            symbol,
            side,
            quantity,
            entry_price,
            entry_order_id,
            stop_loss_order_id,
            take_profit_order_id,
            status,
            opened_at,
            closed_at,
            close_price,
            close_reason,
            realized_pnl,
            unrealized_pnl,
            paper_mode,
            updated_at
          FROM paper_positions
          WHERE entry_order_id = ?
          LIMIT 1
        `
      )
      .get(entryOrderId.trim()) as PaperPositionRow | undefined;

    return row ? toPaperPosition(row) : null;
  }

  saveIntentResponse(record: StoredOrderIntentResponse): void {
    this.db
      .prepare(
        `
          INSERT INTO order_intents (
            intent_id,
            created_at,
            source_window_id,
            order_id,
            response_type,
            dry_run,
            response_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(intent_id) DO UPDATE SET
            created_at = excluded.created_at,
            source_window_id = excluded.source_window_id,
            order_id = excluded.order_id,
            response_type = excluded.response_type,
            dry_run = excluded.dry_run,
            response_json = excluded.response_json
        `
      )
      .run(
        record.intentId.trim(),
        record.createdAt,
        normalizeText(record.sourceWindowId),
        normalizeText(record.orderId),
        record.responseType,
        toBooleanInt(record.dryRun),
        JSON.stringify(record.response)
      );
  }

  getIntentResponse(intentId: string): StoredOrderIntentResponse | null {
    const row = this.db
      .prepare(
        `
          SELECT
            intent_id,
            created_at,
            source_window_id,
            order_id,
            response_type,
            dry_run,
            response_json
          FROM order_intents
          WHERE intent_id = ?
          LIMIT 1
        `
      )
      .get(intentId.trim()) as OrderIntentRow | undefined;

    if (!row) {
      return null;
    }

    const response = parseJson<OrderIntentResponseMessage>(row.response_json);
    if (!response) {
      return null;
    }

    return {
      intentId: row.intent_id,
      createdAt: row.created_at,
      sourceWindowId: row.source_window_id,
      orderId: row.order_id,
      responseType: row.response_type,
      dryRun: toBoolean(row.dry_run),
      response
    };
  }

  appendAuditEvent(input: {
    order: OrderStatePayload;
    eventType: string;
    message?: string | null;
    payload?: unknown;
    timestamp?: number;
  }): OrderAuditEventPayload {
    const auditId = randomUUID();
    const timestamp = input.timestamp ?? Date.now();
    const message = normalizeText(input.message);

    this.db
      .prepare(
        `
          INSERT INTO order_audit_events (
            id,
            order_id,
            intent_id,
            timestamp,
            symbol,
            side,
            type,
            quantity,
            price,
            client_order_id,
            status,
            source_window_id,
            dry_run,
            event_type,
            message,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        auditId,
        input.order.orderId,
        normalizeText(input.order.intentId),
        timestamp,
        normalizeSymbol(input.order.symbol),
        input.order.side,
        input.order.orderType,
        input.order.quantity,
        toNullableNumber(input.order.price),
        input.order.clientOrderId,
        input.order.status,
        normalizeText(input.order.sourceWindowId),
        toBooleanInt(input.order.dryRun),
        input.eventType.trim(),
        message,
        JSON.stringify(input.payload ?? null)
      );

    const row = this.db
      .prepare(
        `
          SELECT
            id,
            order_id,
            intent_id,
            timestamp,
            symbol,
            side,
            type,
            quantity,
            price,
            client_order_id,
            status,
            source_window_id,
            dry_run,
            event_type,
            message
          FROM order_audit_events
          WHERE id = ?
        `
      )
      .get(auditId) as OrderAuditRow | undefined;

    return row
      ? toOrderAuditEvent(row)
      : {
          auditId,
          orderId: input.order.orderId,
          intentId: input.order.intentId,
          timestamp,
          symbol: input.order.symbol,
          side: input.order.side,
          orderType: input.order.orderType,
          quantity: input.order.quantity,
          price: input.order.price,
          clientOrderId: input.order.clientOrderId,
          status: input.order.status,
          sourceWindowId: input.order.sourceWindowId,
          dryRun: input.order.dryRun,
          eventType: input.eventType.trim(),
          message
        };
  }

  listRecentAuditEvents(limit = 50): OrderAuditEventPayload[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            order_id,
            intent_id,
            timestamp,
            symbol,
            side,
            type,
            quantity,
            price,
            client_order_id,
            status,
            source_window_id,
            dry_run,
            event_type,
            message
          FROM order_audit_events
          WHERE dry_run = 1
          ORDER BY timestamp DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as OrderAuditRow[];

    return rows.map(toOrderAuditEvent);
  }
}

export const orderRepository = new OrderRepository();
