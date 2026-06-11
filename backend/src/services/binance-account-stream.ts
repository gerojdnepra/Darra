import WebSocket from "ws";
import { safeNumber } from "../lib/math";
import type {
  AccountUpdateEvent,
  ListenKeyExpiredEvent,
  OrderTradeUpdateEvent,
  RestFuturesAccountV3,
  RestPositionRiskV3,
  UserDataEvent
} from "../types/binance";
import type { AccountCredentialSource } from "../types/messages";
import {
  BinanceApiError,
  closeUserDataStream,
  fetchFuturesAccountSnapshot,
  fetchPositionRiskSnapshot,
  keepaliveUserDataStream,
  startUserDataStream
} from "./binance-rest";
import type { StreamHealth } from "./binance-stream";

export interface AccountStreamHealth extends StreamHealth {
  enabled: boolean;
  credentialSource: AccountCredentialSource;
  keyLabel: string | null;
  message: string;
  error: string | null;
  activePositions: string[];
  lastSyncAt: number | null;
}

export interface BinanceAccountStreamCallbacks {
  onPositionsChanged: (symbols: string[]) => void;
  onRiskStateChanged: () => void;
  onStatus: (message: string) => void;
  onOrderTradeUpdate: (event: OrderTradeUpdateEvent) => void;
}

interface TrackedPosition {
  symbol: string;
  positionSide: "BOTH" | "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  breakEvenPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  isolatedMargin: number;
  isolatedWallet: number;
  initialMargin: number;
  maintMargin: number;
  positionInitialMargin: number;
  openOrderInitialMargin: number;
  marginType: "cross" | "isolated";
  updatedAt: number;
}

interface TrackedAssetBalance {
  asset: string;
  walletBalance: number;
  crossWalletBalance: number;
  availableBalance: number | null;
  updatedAt: number;
}

export interface BinanceAccountRiskBalanceSnapshot {
  walletBalanceUsd: number | null;
  availableBalanceUsd: number | null;
  marginBalanceUsd: number | null;
  totalInitialMarginUsd: number | null;
  totalMaintMarginUsd: number | null;
  totalOpenOrderInitialMarginUsd: number | null;
  totalPositionInitialMarginUsd: number | null;
  totalCrossWalletBalanceUsd: number | null;
  totalUnrealizedPnlUsd: number | null;
  updatedAt: number | null;
}

export interface BinanceAccountRiskPositionSnapshot {
  symbol: string;
  positionSide: "BOTH" | "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  breakEvenPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  isolatedMargin: number;
  isolatedWallet: number;
  initialMargin: number;
  maintMargin: number;
  positionInitialMargin: number;
  openOrderInitialMargin: number;
  marginType: "cross" | "isolated";
  updatedAt: number;
}

export interface BinanceAccountRiskSnapshot {
  enabled: boolean;
  connected: boolean;
  credentialSource: AccountCredentialSource;
  balanceAsset: string;
  lastSyncAt: number | null;
  balances: BinanceAccountRiskBalanceSnapshot;
  positions: BinanceAccountRiskPositionSnapshot[];
}

interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
  source: Exclude<AccountCredentialSource, "none">;
}

const KEEPALIVE_INTERVAL_MS = 50 * 60 * 1000;
const POSITION_RISK_POLL_INTERVAL_MS = 15_000;

const positionKey = (symbol: string, positionSide: TrackedPosition["positionSide"]): string =>
  `${symbol}:${positionSide}`;

const normalizeCredential = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const toCredentials = (
  apiKey: string | undefined,
  apiSecret: string | undefined,
  source: Exclude<AccountCredentialSource, "none">
): BinanceCredentials | null => {
  const normalizedKey = normalizeCredential(apiKey);
  const normalizedSecret = normalizeCredential(apiSecret);

  if (!normalizedKey || !normalizedSecret) {
    return null;
  }

  return {
    apiKey: normalizedKey,
    apiSecret: normalizedSecret,
    source
  };
};

const maskApiKey = (apiKey: string): string => {
  if (apiKey.length <= 8) {
    return apiKey;
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
};

const isNonRetryableAccountError = (error: unknown): boolean =>
  error instanceof BinanceApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 429;

export class BinanceAccountStreamManager {
  private readonly normalizedBaseWsUrl: string;
  private readonly envCredentials: BinanceCredentials | null;

  private disposed = false;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private positionRiskPollTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private connected = false;
  private lastMessageAt: number | null = null;
  private lastSyncAt: number | null = null;
  private socketUrl = "";
  private listenKey: string | null = null;
  private positions = new Map<string, TrackedPosition>();
  private assetBalances = new Map<string, TrackedAssetBalance>();
  private balances: BinanceAccountRiskBalanceSnapshot = {
    walletBalanceUsd: null,
    availableBalanceUsd: null,
    marginBalanceUsd: null,
    totalInitialMarginUsd: null,
    totalMaintMarginUsd: null,
    totalOpenOrderInitialMarginUsd: null,
    totalPositionInitialMarginUsd: null,
    totalCrossWalletBalanceUsd: null,
    totalUnrealizedPnlUsd: null,
    updatedAt: null
  };
  private lastEmittedSymbols = "";
  private lastRiskSignature = "";
  private sessionCredentials: BinanceCredentials | null = null;
  private statusMessage = "account stream disabled: connect Binance API keys";
  private lastError: string | null = null;

  constructor(
    private readonly restBase: string,
    private readonly baseWsUrl: string,
    apiKey: string | undefined,
    apiSecret: string | undefined,
    private readonly callbacks: BinanceAccountStreamCallbacks
  ) {
    this.normalizedBaseWsUrl = this.baseWsUrl.replace(/\/+$/, "");
    this.envCredentials = toCredentials(apiKey, apiSecret, "env");

    if (this.envCredentials) {
      this.statusMessage = "account stream ready: using environment credentials";
    }
  }

  isEnabled(): boolean {
    return Boolean(this.activeCredentials);
  }

  async start(): Promise<string[]> {
    this.disposed = false;
    return this.startCurrentCredentials();
  }

  async connectSession(apiKey: string, apiSecret: string): Promise<string[]> {
    const nextCredentials = toCredentials(apiKey, apiSecret, "session");

    if (!nextCredentials) {
      throw new Error("Binance API key and secret are required");
    }

    this.disposed = false;
    await this.stopActiveConnection();
    this.sessionCredentials = nextCredentials;
    this.resetPositionState();

    return this.startCurrentCredentials();
  }

  async disconnectSession(): Promise<string[]> {
    this.disposed = false;
    await this.stopActiveConnection();
    this.sessionCredentials = null;
    this.resetPositionState();

    if (this.envCredentials) {
      this.updateStatus("account stream ready: using environment credentials");
      return this.startCurrentCredentials();
    }

    this.updateStatus("account stream disabled: connect Binance API keys");
    return [];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stopActiveConnection();
    this.resetPositionState();
  }

  getHealth(): AccountStreamHealth {
    const activeCredentials = this.activeCredentials;

    return {
      enabled: Boolean(activeCredentials),
      credentialSource: activeCredentials?.source ?? "none",
      keyLabel: activeCredentials ? maskApiKey(activeCredentials.apiKey) : null,
      message: this.statusMessage,
      error: this.lastError,
      connected: this.connected,
      url: this.socketUrl,
      lastMessageAt: this.lastMessageAt,
      reconnectAttempts: this.reconnectAttempts,
      activePositions: this.getActivePositionSymbols(),
      lastSyncAt: this.lastSyncAt
    };
  }

  getRiskSnapshot(): BinanceAccountRiskSnapshot {
    const activeCredentials = this.activeCredentials;

    return {
      enabled: Boolean(activeCredentials),
      connected: this.connected,
      credentialSource: activeCredentials?.source ?? "none",
      balanceAsset: "USDT",
      lastSyncAt: this.lastSyncAt,
      balances: this.balances,
      positions: Array.from(this.positions.values())
        .map((position) => ({ ...position }))
        .sort((left, right) => Math.abs(right.quantity) - Math.abs(left.quantity))
    };
  }

  private get activeCredentials(): BinanceCredentials | null {
    return this.sessionCredentials ?? this.envCredentials;
  }

  private get activeApiKey(): string | undefined {
    return this.activeCredentials?.apiKey;
  }

  private get activeApiSecret(): string | undefined {
    return this.activeCredentials?.apiSecret;
  }

  private async startCurrentCredentials(): Promise<string[]> {
    if (!this.activeCredentials) {
      this.updateStatus("account stream disabled: connect Binance API keys");
      return [];
    }

    this.lastError = null;
    this.updateStatus(
      this.activeCredentials.source === "session"
        ? "account stream connecting: using session credentials"
        : "account stream connecting: using environment credentials"
    );

    try {
      await this.refreshAccountSnapshot();
    } catch (error) {
      if (isNonRetryableAccountError(error)) {
        return this.getActivePositionSymbols();
      }
    }

    this.startKeepaliveLoop();
    this.startPositionRiskPollLoop();
    void this.openSocket();
    return this.getActivePositionSymbols();
  }

  private async stopActiveConnection(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    if (this.positionRiskPollTimer) {
      clearInterval(this.positionRiskPollTimer);
      this.positionRiskPollTimer = null;
    }

    this.closeSocket();

    const apiKey = this.activeApiKey;

    if (this.listenKey && apiKey) {
      try {
        await closeUserDataStream(this.restBase, apiKey);
      } catch {
        // Best-effort cleanup only.
      }
    }

    this.listenKey = null;
    this.reconnectAttempts = 0;
  }

  private resetPositionState(): void {
    this.positions = new Map<string, TrackedPosition>();
    this.assetBalances = new Map<string, TrackedAssetBalance>();
    this.balances = {
      walletBalanceUsd: null,
      availableBalanceUsd: null,
      marginBalanceUsd: null,
      totalInitialMarginUsd: null,
      totalMaintMarginUsd: null,
      totalOpenOrderInitialMarginUsd: null,
      totalPositionInitialMarginUsd: null,
      totalCrossWalletBalanceUsd: null,
      totalUnrealizedPnlUsd: null,
      updatedAt: null
    };
    this.lastSyncAt = null;
    this.lastMessageAt = null;
    this.socketUrl = "";
    this.lastEmittedSymbols = "__reset__";
    this.lastRiskSignature = "__reset__";
    this.emitPositionsChanged();
    this.emitRiskStateChanged();
  }

  private updateStatus(message: string, error: string | null = null): void {
    this.statusMessage = message;
    this.lastError = error;

    if (this.disposed) {
      return;
    }

    this.callbacks.onStatus(message);
  }

  private startKeepaliveLoop(): void {
    if (this.disposed || !this.activeApiKey) {
      return;
    }

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    this.keepaliveTimer = setInterval(() => {
      void this.keepaliveListenKey();
    }, KEEPALIVE_INTERVAL_MS);
  }

  private startPositionRiskPollLoop(): void {
    if (this.disposed || !this.activeApiKey || !this.activeApiSecret) {
      return;
    }

    if (this.positionRiskPollTimer) {
      clearInterval(this.positionRiskPollTimer);
      this.positionRiskPollTimer = null;
    }

    this.positionRiskPollTimer = setInterval(() => {
      void this.refreshPositionRiskSnapshot();
    }, POSITION_RISK_POLL_INTERVAL_MS);
  }

  private async openSocket(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const apiKey = this.activeApiKey;
    const apiSecret = this.activeApiSecret;

    if (!apiKey || !apiSecret) {
      return;
    }

    let listenKey: string;

    try {
      listenKey = await this.ensureListenKey(apiKey);
    } catch (error) {
      const message =
        error instanceof Error
          ? `account stream listenKey failed: ${error.message}`
          : "account stream listenKey failed";

      this.updateStatus(message, error instanceof Error ? error.message : message);

      if (!isNonRetryableAccountError(error)) {
        this.scheduleReconnect();
      }
      return;
    }

    const socketUrl = `${this.normalizedBaseWsUrl}/private/ws/${listenKey}`;
    this.socketUrl = socketUrl;

    const socket = new WebSocket(socketUrl);
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) {
        return;
      }

      this.connected = true;
      this.reconnectAttempts = 0;
      this.updateStatus("account stream connected");
      void this.refreshAccountSnapshot();
    });

    socket.on("message", (buffer) => {
      if (this.socket !== socket) {
        return;
      }

      this.lastMessageAt = Date.now();

      try {
        const event = JSON.parse(buffer.toString("utf8")) as UserDataEvent;
        this.handleUserDataEvent(event);
      } catch {
        this.updateStatus("account stream message parse error", "account stream message parse error");
      }
    });

    socket.on("close", () => {
      const wasCurrentSocket = this.socket === socket;

      if (wasCurrentSocket) {
        this.connected = false;
        this.socket = null;
        this.updateStatus("account stream disconnected");
      }

      if (!this.activeCredentials || !wasCurrentSocket) {
        return;
      }

      this.scheduleReconnect();
    });

    socket.on("error", (error) => {
      if (this.socket !== socket) {
        return;
      }

      this.updateStatus(`account stream error: ${error.message}`, error.message);
    });
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;

    if (!socket) {
      return;
    }

    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      return;
    }

    socket.close();
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.activeCredentials) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempts, 15_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.refreshAccountSnapshot().catch(() => undefined);
      void this.openSocket();
    }, delay);
  }

  private async ensureListenKey(apiKey: string): Promise<string> {
    if (this.listenKey) {
      return this.listenKey;
    }

    const response = await startUserDataStream(this.restBase, apiKey);
    this.listenKey = response.listenKey;
    return response.listenKey;
  }

  private async keepaliveListenKey(): Promise<void> {
    const apiKey = this.activeApiKey;

    if (!apiKey) {
      return;
    }

    try {
      const response = await keepaliveUserDataStream(this.restBase, apiKey);
      this.listenKey = response.listenKey;
    } catch (error) {
      if (error instanceof BinanceApiError && error.code === -1125) {
        this.updateStatus("account stream listenKey expired, recreating");
        this.listenKey = null;
        this.closeSocket();
        void this.openSocket();
        return;
      }

      const message =
        error instanceof Error
          ? `account stream keepalive failed: ${error.message}`
          : "account stream keepalive failed";

      this.updateStatus(message, error instanceof Error ? error.message : message);
    }
  }

  private async refreshAccountSnapshot(): Promise<void> {
    const apiKey = this.activeApiKey;
    const apiSecret = this.activeApiSecret;

    if (!apiKey || !apiSecret) {
      return;
    }

    try {
      const [accountSnapshot, positionSnapshot] = await Promise.all([
        fetchFuturesAccountSnapshot(this.restBase, apiKey, apiSecret),
        fetchPositionRiskSnapshot(this.restBase, apiKey, apiSecret)
      ]);
      this.applyAccountSnapshot(accountSnapshot, false);
      this.replacePositionsFromSnapshot(positionSnapshot, false);
      this.recomputeDerivedBalances(accountSnapshot.updateTime || Date.now());
      this.emitRiskStateChanged();
    } catch (error) {
      const message =
        error instanceof Error
          ? `account snapshot failed: ${error.message}`
          : "account snapshot failed";

      this.updateStatus(message, error instanceof Error ? error.message : message);
      throw error;
    }
  }

  private async refreshPositionRiskSnapshot(): Promise<void> {
    const apiKey = this.activeApiKey;
    const apiSecret = this.activeApiSecret;

    if (!apiKey || !apiSecret) {
      return;
    }

    try {
      const positionSnapshot = await fetchPositionRiskSnapshot(this.restBase, apiKey, apiSecret);
      this.replacePositionsFromSnapshot(positionSnapshot, false);
      this.emitRiskStateChanged();
    } catch (error) {
      const message =
        error instanceof Error
          ? `position risk snapshot failed: ${error.message}`
          : "position risk snapshot failed";

      this.updateStatus(message, error instanceof Error ? error.message : message);
    }
  }

  private applyAccountSnapshot(snapshot: RestFuturesAccountV3, emit = true): void {
    this.assetBalances = new Map(
      snapshot.assets.map((asset) => [
        asset.asset,
        {
          asset: asset.asset,
          walletBalance: safeNumber(asset.walletBalance),
          crossWalletBalance: safeNumber(asset.crossWalletBalance),
          availableBalance: safeNumber(asset.availableBalance),
          updatedAt: snapshot.updateTime || Date.now()
        }
      ])
    );

    this.balances = {
      walletBalanceUsd: safeNumber(snapshot.totalWalletBalance),
      availableBalanceUsd: safeNumber(snapshot.availableBalance),
      marginBalanceUsd: safeNumber(snapshot.totalMarginBalance),
      totalInitialMarginUsd: safeNumber(snapshot.totalInitialMargin),
      totalMaintMarginUsd: safeNumber(snapshot.totalMaintMargin),
      totalOpenOrderInitialMarginUsd: safeNumber(snapshot.totalOpenOrderInitialMargin),
      totalPositionInitialMarginUsd: safeNumber(snapshot.totalPositionInitialMargin),
      totalCrossWalletBalanceUsd: safeNumber(snapshot.totalCrossWalletBalance),
      totalUnrealizedPnlUsd: safeNumber(snapshot.totalUnrealizedProfit),
      updatedAt: snapshot.updateTime || Date.now()
    };

    if (emit) {
      this.emitRiskStateChanged();
    }
  }

  private replacePositionsFromSnapshot(snapshot: RestPositionRiskV3[], emit = true): void {
    const next = new Map<string, TrackedPosition>();

    for (const position of snapshot) {
      const amount = safeNumber(position.positionAmt);
      if (Math.abs(amount) <= 0) {
        continue;
      }

      next.set(positionKey(position.symbol, position.positionSide), {
        symbol: position.symbol,
        positionSide: position.positionSide,
        quantity: amount,
        entryPrice: safeNumber(position.entryPrice),
        breakEvenPrice: safeNumber(position.breakEvenPrice),
        markPrice: safeNumber(position.markPrice),
        unrealizedPnl: safeNumber(position.unRealizedProfit),
        liquidationPrice: safeNumber(position.liquidationPrice),
        isolatedMargin: safeNumber(position.isolatedMargin),
        isolatedWallet: safeNumber(position.isolatedWallet),
        initialMargin: safeNumber(position.initialMargin),
        maintMargin: safeNumber(position.maintMargin),
        positionInitialMargin: safeNumber(position.positionInitialMargin),
        openOrderInitialMargin: safeNumber(position.openOrderInitialMargin),
        marginType: safeNumber(position.isolatedWallet) > 0 ? "isolated" : "cross",
        updatedAt: position.updateTime || Date.now()
      });
    }

    this.positions = next;
    this.lastSyncAt = Date.now();
    this.lastError = null;
    this.emitPositionsChanged();
    this.recomputeDerivedBalances(this.lastSyncAt);
    if (emit) {
      this.emitRiskStateChanged();
    }

    if (!this.connected) {
      this.updateStatus("account snapshot synced");
    }
  }

  private recomputeDerivedBalances(updatedAt: number): void {
    const positions = Array.from(this.positions.values());
    const walletBalanceFromAssets = Array.from(this.assetBalances.values()).reduce(
      (sum, asset) => sum + asset.walletBalance,
      0
    );
    const crossWalletBalanceFromAssets = Array.from(this.assetBalances.values()).reduce(
      (sum, asset) => sum + asset.crossWalletBalance,
      0
    );
    const availableBalanceFromAssets = Array.from(this.assetBalances.values()).reduce(
      (sum, asset) => sum + (asset.availableBalance ?? 0),
      0
    );
    const totalInitialMarginFromPositions = positions.reduce(
      (sum, position) => sum + position.initialMargin,
      0
    );
    const totalMaintMarginFromPositions = positions.reduce(
      (sum, position) => sum + position.maintMargin,
      0
    );
    const totalOpenOrderInitialMarginFromPositions = positions.reduce(
      (sum, position) => sum + position.openOrderInitialMargin,
      0
    );
    const totalPositionInitialMarginFromPositions = positions.reduce(
      (sum, position) => sum + position.positionInitialMargin,
      0
    );
    const totalUnrealizedPnlFromPositions = positions.reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0
    );
    const hasAssetBalances = this.assetBalances.size > 0;
    const resolvedWalletBalance =
      hasAssetBalances ? walletBalanceFromAssets : this.balances.walletBalanceUsd;
    const resolvedAvailableBalance =
      hasAssetBalances
        ? availableBalanceFromAssets
        : this.balances.availableBalanceUsd;
    const resolvedMarginBalance =
      resolvedWalletBalance !== null ? resolvedWalletBalance + totalUnrealizedPnlFromPositions : null;

    this.balances = {
      walletBalanceUsd: resolvedWalletBalance,
      availableBalanceUsd: resolvedAvailableBalance,
      marginBalanceUsd: resolvedMarginBalance ?? this.balances.marginBalanceUsd,
      totalInitialMarginUsd:
        totalInitialMarginFromPositions > 0
          ? totalInitialMarginFromPositions
          : this.balances.totalInitialMarginUsd,
      totalMaintMarginUsd:
        totalMaintMarginFromPositions > 0
          ? totalMaintMarginFromPositions
          : this.balances.totalMaintMarginUsd,
      totalOpenOrderInitialMarginUsd:
        totalOpenOrderInitialMarginFromPositions > 0
          ? totalOpenOrderInitialMarginFromPositions
          : this.balances.totalOpenOrderInitialMarginUsd,
      totalPositionInitialMarginUsd:
        totalPositionInitialMarginFromPositions > 0
          ? totalPositionInitialMarginFromPositions
          : this.balances.totalPositionInitialMarginUsd,
      totalCrossWalletBalanceUsd:
        hasAssetBalances
          ? crossWalletBalanceFromAssets
          : this.balances.totalCrossWalletBalanceUsd,
      totalUnrealizedPnlUsd: totalUnrealizedPnlFromPositions,
      updatedAt
    };
  }

  private handleUserDataEvent(event: UserDataEvent): void {
    if (event.e === "ACCOUNT_UPDATE" && "a" in event) {
      this.applyAccountUpdate(event);
      return;
    }

    if (event.e === "ORDER_TRADE_UPDATE" && "o" in event) {
      this.callbacks.onOrderTradeUpdate(event);
      return;
    }

    if (event.e === "listenKeyExpired" && "listenKey" in event) {
      this.handleListenKeyExpired(event);
    }
  }

  private applyAccountUpdate(event: AccountUpdateEvent): void {
    const positions = event.a.P ?? [];

    for (const position of positions) {
      const amount = safeNumber(position.pa);
      const key = positionKey(position.s, position.ps);
      const existing = this.positions.get(key);

      if (Math.abs(amount) <= 0) {
        this.positions.delete(key);
        continue;
      }

      this.positions.set(key, {
        symbol: position.s,
        positionSide: position.ps,
        quantity: amount,
        entryPrice: safeNumber(position.ep),
        breakEvenPrice: safeNumber(position.bep),
        markPrice: existing?.markPrice ?? 0,
        unrealizedPnl: safeNumber(position.up),
        liquidationPrice: existing?.liquidationPrice ?? 0,
        isolatedMargin: existing?.isolatedMargin ?? 0,
        isolatedWallet: safeNumber(position.iw),
        initialMargin: existing?.initialMargin ?? 0,
        maintMargin: existing?.maintMargin ?? 0,
        positionInitialMargin: existing?.positionInitialMargin ?? 0,
        openOrderInitialMargin: existing?.openOrderInitialMargin ?? 0,
        marginType: position.mt,
        updatedAt: event.E
      });
    }

    for (const balance of event.a.B ?? []) {
      this.assetBalances.set(balance.a, {
        asset: balance.a,
        walletBalance: safeNumber(balance.wb),
        crossWalletBalance: safeNumber(balance.cw),
        availableBalance: this.assetBalances.get(balance.a)?.availableBalance ?? null,
        updatedAt: event.E
      });
    }

    this.lastSyncAt = event.E;
    this.lastError = null;
    this.emitPositionsChanged();
    this.recomputeDerivedBalances(event.E);
    this.emitRiskStateChanged();
  }

  private handleListenKeyExpired(event: ListenKeyExpiredEvent): void {
    if (this.listenKey !== event.listenKey) {
      return;
    }

    this.updateStatus("account stream listenKeyExpired event received");
    this.listenKey = null;
    this.closeSocket();
    void this.openSocket();
  }

  private getActivePositionSymbols(): string[] {
    return Array.from(new Set(Array.from(this.positions.values()).map((position) => position.symbol))).sort();
  }

  private emitPositionsChanged(): void {
    const symbols = this.getActivePositionSymbols();
    const signature = symbols.join(",");

    if (signature === this.lastEmittedSymbols) {
      return;
    }

    this.lastEmittedSymbols = signature;
    this.callbacks.onPositionsChanged(symbols);
  }

  private emitRiskStateChanged(): void {
    const signature = JSON.stringify(this.getRiskSnapshot());

    if (signature === this.lastRiskSignature) {
      return;
    }

    this.lastRiskSignature = signature;
    this.callbacks.onRiskStateChanged();
  }
}
