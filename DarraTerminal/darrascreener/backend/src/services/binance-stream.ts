import WebSocket from "ws";
import { safeNumber } from "../lib/math";
import type {
  AggTradeEvent,
  AllMarketTickerEvent,
  BookTickerEvent,
  ForceOrderEvent,
  MarkPriceEvent,
  WsCombinedMessage
} from "../types/binance";

export interface BinanceStreamCallbacks {
  onTickerBatch: (events: AllMarketTickerEvent[]) => void;
  onMarkPriceBatch: (events: MarkPriceEvent[]) => void;
  onAggTrade: (event: AggTradeEvent) => void;
  onBookTicker: (event: BookTickerEvent) => void;
  onLiquidation: (event: ForceOrderEvent) => void;
  onStatus: (message: string) => void;
}

export interface StreamHealth {
  connected: boolean;
  url: string;
  lastMessageAt: number | null;
  reconnectAttempts: number;
}

interface SocketState {
  route: "market" | "public";
  socket: WebSocket | null;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  connected: boolean;
  lastMessageAt: number | null;
  url: string;
}

export class BinanceStreamManager {
  private readonly normalizedBaseWsUrl: string;

  private readonly marketState: SocketState = {
    route: "market",
    socket: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    connected: false,
    lastMessageAt: null,
    url: ""
  };

  private readonly publicState: SocketState = {
    route: "public",
    socket: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    connected: false,
    lastMessageAt: null,
    url: ""
  };

  private focusSymbols: string[] = [];
  private disposed = false;

  constructor(
    private readonly baseWsUrl: string,
    private readonly callbacks: BinanceStreamCallbacks
  ) {
    this.normalizedBaseWsUrl = this.baseWsUrl.replace(/\/+$/, "");
  }

  start(initialFocusSymbols: string[]): void {
    this.focusSymbols = initialFocusSymbols;
    this.connectAll();
  }

  stop(): void {
    this.disposed = true;
    this.closeSocket(this.marketState);
    this.closeSocket(this.publicState);
  }

  updateFocusSymbols(nextFocusSymbols: string[]): void {
    const normalized = [...new Set(nextFocusSymbols.map((symbol) => symbol.toLowerCase()))].sort();
    const current = [...this.focusSymbols].map((symbol) => symbol.toLowerCase()).sort();

    if (normalized.join(",") === current.join(",")) {
      return;
    }

    this.focusSymbols = nextFocusSymbols;
    this.callbacks.onStatus(`rebalancing focus streams: ${nextFocusSymbols.join(", ")}`);
    this.reconnect(this.marketState);
    this.reconnect(this.publicState);
  }

  getHealth(): { market: StreamHealth; public: StreamHealth } {
    return {
      market: {
        connected: this.marketState.connected,
        url: this.marketState.url,
        lastMessageAt: this.marketState.lastMessageAt,
        reconnectAttempts: this.marketState.reconnectAttempts
      },
      public: {
        connected: this.publicState.connected,
        url: this.publicState.url,
        lastMessageAt: this.publicState.lastMessageAt,
        reconnectAttempts: this.publicState.reconnectAttempts
      }
    };
  }

  private connectAll(): void {
    this.connectSocket(this.marketState, this.buildMarketStreams());
    this.connectSocket(this.publicState, this.buildPublicStreams());
  }

  private reconnect(state: SocketState): void {
    this.closeSocket(state);
    this.connectSocket(
      state,
      state.route === "market" ? this.buildMarketStreams() : this.buildPublicStreams()
    );
  }

  private connectSocket(state: SocketState, streams: string[]): void {
    if (this.disposed) {
      return;
    }

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    if (streams.length === 0 && state.route === "public") {
      state.connected = false;
      state.url = "";
      return;
    }

    const url = `${this.normalizedBaseWsUrl}/${state.route}/stream?streams=${streams.join("/")}`;
    state.url = url;

    const socket = new WebSocket(url);
    state.socket = socket;

    socket.on("open", () => {
      if (state.socket !== socket) {
        return;
      }

      state.connected = true;
      state.reconnectAttempts = 0;
      this.callbacks.onStatus(`${state.route} stream connected`);
    });

    socket.on("message", (buffer) => {
      if (state.socket !== socket) {
        return;
      }

      state.lastMessageAt = Date.now();
      this.handleMessage(state.route, buffer.toString("utf8"));
    });

    socket.on("close", () => {
      const wasCurrentSocket = state.socket === socket;

      if (wasCurrentSocket) {
        state.connected = false;
        state.socket = null;
        this.callbacks.onStatus(`${state.route} stream disconnected`);
      }

      if (this.disposed || !wasCurrentSocket) {
        return;
      }

      state.reconnectAttempts += 1;
      const delay = Math.min(1_000 * 2 ** state.reconnectAttempts, 15_000);
      state.reconnectTimer = setTimeout(() => {
        this.connectSocket(
          state,
          state.route === "market" ? this.buildMarketStreams() : this.buildPublicStreams()
        );
      }, delay);
    });

    socket.on("error", (error) => {
      if (state.socket !== socket) {
        return;
      }

      this.callbacks.onStatus(`${state.route} stream error: ${error.message}`);
    });
  }

  private closeSocket(state: SocketState): void {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    const socket = state.socket;
    state.socket = null;
    state.connected = false;

    if (!socket) {
      return;
    }

    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      return;
    }

    socket.close();
  }

  private buildMarketStreams(): string[] {
    const focusAggTrades = this.focusSymbols.map((symbol) => `${symbol.toLowerCase()}@aggTrade`);

    return ["!ticker@arr", "!markPrice@arr@1s", "!forceOrder@arr", ...focusAggTrades];
  }

  private buildPublicStreams(): string[] {
    return this.focusSymbols.map((symbol) => `${symbol.toLowerCase()}@bookTicker`);
  }

  private handleMessage(route: "market" | "public", rawMessage: string): void {
    let payload: WsCombinedMessage<unknown>;

    try {
      payload = JSON.parse(rawMessage) as WsCombinedMessage<unknown>;
    } catch {
      this.callbacks.onStatus(`${route} stream message parse error`);
      return;
    }

    if (!("stream" in payload) || !("data" in payload)) {
      return;
    }

    if (payload.stream === "!ticker@arr") {
      this.callbacks.onTickerBatch(payload.data as AllMarketTickerEvent[]);
      return;
    }

    if (payload.stream === "!markPrice@arr@1s") {
      this.callbacks.onMarkPriceBatch(payload.data as MarkPriceEvent[]);
      return;
    }

    if (payload.stream === "!forceOrder@arr") {
      this.callbacks.onLiquidation(payload.data as ForceOrderEvent);
      return;
    }

    if (route === "market" && payload.stream.endsWith("@aggTrade")) {
      const event = payload.data as AggTradeEvent;
      if (event.s && safeNumber(event.p) > 0) {
        this.callbacks.onAggTrade(event);
      }
      return;
    }

    if (route === "public" && payload.stream.endsWith("@bookTicker")) {
      const event = payload.data as BookTickerEvent;
      if (event.s && safeNumber(event.b) > 0 && safeNumber(event.a) > 0) {
        this.callbacks.onBookTicker(event);
      }
    }
  }
}
