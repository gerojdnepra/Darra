import type { ServerTimeResponse } from "../types/binance";

interface BinanceTimeSyncState {
  offsetMs: number | null;
  lastSyncedAt: number | null;
  syncInFlight: Promise<BinanceTimeSyncSnapshot> | null;
  refreshTimer: NodeJS.Timeout | null;
}

export interface BinanceTimeSyncSnapshot {
  serverTime: number;
  localTime: number;
  offsetMs: number;
}

const DEFAULT_BINANCE_RECV_WINDOW_MS = 5_000;
const DEFAULT_BINANCE_TIME_SYNC_REFRESH_MS = 5 * 60 * 1000;
const MAX_BINANCE_RECV_WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const stateByRestBase = new Map<string, BinanceTimeSyncState>();

const normalizeRestBase = (restBase: string): string => restBase.replace(/\/+$/, "");

const getState = (restBase: string): BinanceTimeSyncState => {
  const normalizedRestBase = normalizeRestBase(restBase);
  const existing = stateByRestBase.get(normalizedRestBase);
  if (existing) {
    return existing;
  }

  const created: BinanceTimeSyncState = {
    offsetMs: null,
    lastSyncedAt: null,
    syncInFlight: null,
    refreshTimer: null
  };
  stateByRestBase.set(normalizedRestBase, created);
  return created;
};

const toConfiguredPositiveInteger = (
  value: string | undefined,
  fallback: number,
  max: number
): number => {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
};

const buildLogContext = (
  restBase: string,
  input: {
    serverTime: number | null;
    localTime: number;
    offsetMs: number | null;
    reason?: string;
    error?: string;
  }
): Record<string, unknown> => ({
  environment: resolveBinanceTimeSyncEnvironment(restBase),
  restBase: normalizeRestBase(restBase),
  serverTime: input.serverTime,
  localTime: input.localTime,
  offsetMs: input.offsetMs,
  ...(input.reason ? { reason: input.reason } : {}),
  ...(input.error ? { error: input.error } : {})
});

export const resolveBinanceTimeSyncEnvironment = (restBase: string): string => {
  try {
    const hostname = new URL(normalizeRestBase(restBase)).hostname.toLowerCase();

    if (hostname.includes("testnet")) {
      return "testnet";
    }

    if (hostname.includes("binance")) {
      return "live";
    }

    return hostname || "custom";
  } catch {
    return "custom";
  }
};

export const getBinanceRecvWindowMs = (): number =>
  toConfiguredPositiveInteger(
    process.env.BINANCE_RECV_WINDOW_MS,
    DEFAULT_BINANCE_RECV_WINDOW_MS,
    MAX_BINANCE_RECV_WINDOW_MS
  );

const getBinanceTimeSyncRefreshMs = (): number =>
  toConfiguredPositiveInteger(
    process.env.BINANCE_TIME_SYNC_REFRESH_MS,
    DEFAULT_BINANCE_TIME_SYNC_REFRESH_MS,
    Number.MAX_SAFE_INTEGER
  );

const fetchServerTimeSnapshot = async (restBase: string): Promise<BinanceTimeSyncSnapshot> => {
  const response = await fetch(`${normalizeRestBase(restBase)}/fapi/v1/time`, {
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Binance time sync failed ${response.status} for /fapi/v1/time`);
  }

  const payload = (await response.json()) as ServerTimeResponse;
  const localTime = Date.now();
  const serverTime = Number(payload.serverTime);

  if (!Number.isFinite(serverTime)) {
    throw new Error("Binance time sync returned an invalid serverTime.");
  }

  return {
    serverTime,
    localTime,
    offsetMs: serverTime - localTime
  };
};

export const syncBinanceServerTime = async (
  restBase: string,
  reason = "manual"
): Promise<BinanceTimeSyncSnapshot> => {
  const normalizedRestBase = normalizeRestBase(restBase);
  const state = getState(normalizedRestBase);

  if (state.syncInFlight) {
    return state.syncInFlight;
  }

  state.syncInFlight = (async () => {
    try {
      const snapshot = await fetchServerTimeSnapshot(normalizedRestBase);
      state.offsetMs = snapshot.offsetMs;
      state.lastSyncedAt = snapshot.localTime;
      console.info(
        "BINANCE_TIME_SYNC_OK",
        buildLogContext(normalizedRestBase, { ...snapshot, reason })
      );
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        "BINANCE_TIME_SYNC_FAILED",
        buildLogContext(normalizedRestBase, {
          serverTime: null,
          localTime: Date.now(),
          offsetMs: state.offsetMs,
          reason,
          error: message
        })
      );
      throw error;
    } finally {
      state.syncInFlight = null;
    }
  })();

  return state.syncInFlight;
};

export const ensureBinanceTimeSyncStarted = (restBase: string): void => {
  const normalizedRestBase = normalizeRestBase(restBase);
  const state = getState(normalizedRestBase);

  if (!state.refreshTimer) {
    state.refreshTimer = setInterval(() => {
      void syncBinanceServerTime(normalizedRestBase, "interval").catch(() => {
        // Interval refresh is best-effort; failures are logged in syncBinanceServerTime.
      });
    }, getBinanceTimeSyncRefreshMs());
    state.refreshTimer.unref?.();
  }

  if (state.offsetMs === null && !state.syncInFlight) {
    void syncBinanceServerTime(normalizedRestBase, "startup").catch(() => {
      // Initial refresh is best-effort; signed requests still fall back to local time.
    });
  }
};

export const getBinanceSignedTimestamp = async (restBase: string): Promise<number> => {
  const normalizedRestBase = normalizeRestBase(restBase);
  ensureBinanceTimeSyncStarted(normalizedRestBase);
  const state = getState(normalizedRestBase);
  const refreshMs = getBinanceTimeSyncRefreshMs();

  if (
    state.offsetMs === null ||
    state.lastSyncedAt === null ||
    Date.now() - state.lastSyncedAt > refreshMs
  ) {
    try {
      await syncBinanceServerTime(normalizedRestBase, state.offsetMs === null ? "startup" : "stale");
    } catch {
      // Fall through to cached offset or local time fallback below.
    }
  }

  if (state.offsetMs !== null) {
    return Date.now() + state.offsetMs;
  }

  const localTime = Date.now();
  console.warn(
    "BINANCE_TIME_SYNC_UNAVAILABLE",
    buildLogContext(normalizedRestBase, {
      serverTime: null,
      localTime,
      offsetMs: null
    })
  );
  return localTime;
};

export const resyncBinanceServerTimeAfterRecvWindowError = async (
  restBase: string,
  errorMessage: string
): Promise<void> => {
  const normalizedRestBase = normalizeRestBase(restBase);
  const state = getState(normalizedRestBase);

  console.warn(
    "BINANCE_RECV_WINDOW_RESYNC",
    buildLogContext(normalizedRestBase, {
      serverTime: null,
      localTime: Date.now(),
      offsetMs: state.offsetMs,
      reason: errorMessage
    })
  );

  try {
    await syncBinanceServerTime(normalizedRestBase, "recvWindow-error");
  } catch {
    // Keep prior offset or local-time fallback behavior; failure is logged above.
  }
};

export const __resetBinanceTimeSyncForTests = (): void => {
  for (const state of stateByRestBase.values()) {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  stateByRestBase.clear();
};
