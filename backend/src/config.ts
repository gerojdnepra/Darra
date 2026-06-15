import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { resolveBinanceEnvironment } from "./safety/binance-environment";

loadEnvFiles();

export interface ConfigEnvDiagnostics {
  envFilePath: string | null;
  envFileSource: string | null;
  envFileCandidates: string[];
  envFilesLoaded: string[];
}

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

export interface AppConfig {
  binanceRestBase: string;
  binanceWsBase: string;
  dataDir: string;
  marketEventStorePath: string;
  sqlitePath: string;
  host: string;
  port: number;
  wsPath: string;
  defaultFocusUniverseSize: number;
  frameIntervalMs: number;
  focusRebalanceIntervalMs: number;
  openInterestPollIntervalMs: number;
  openInterestPollTimeoutMs: number;
  openInterestStaleAfterMs: number;
  openInterestPollMaxConcurrency: number;
  openInterestPollBackoffBaseMs: number;
  openInterestPollBackoffMaxMs: number;
  openInterestPollLogThrottleMs: number;
  apiKey: string | undefined;
  apiSecret: string | undefined;
  binanceFuturesTestnet: boolean;
  orderPaperModeDefault: boolean;
  orderLiveModeEnabled: boolean;
  liveTradingEnabled: boolean;
  liveTradingRequiresTestnet: boolean;
  liveTradingRequireTypedConfirm: boolean;
  liveTradingKillSwitchEnabled: boolean;
  orderControlToken: string;
  orderControlAuthRequired: boolean;
  orderControlAllowLoopbackPaper: boolean;
  liveRiskLimits: {
    maxOrderNotionalUsdt: { enabled: boolean; value: number | null };
    maxPositionNotionalUsdt: { enabled: boolean; value: number | null };
    maxOpenPositions: { enabled: boolean; value: number | null };
    maxDailyLossUsdt: { enabled: boolean; value: number | null };
    maxLeverage: { enabled: boolean; value: number | null };
  };
  autoJournalFromBinance: boolean;
  positionSizingDefaultEquityUsdt: number;
  allowRemoteEnvBinanceAccountAccess: boolean;
  allowRemoteTtsAccess: boolean;
  allowRemoteDiagnosticHealth: boolean;
  firebaseProjectId: string;
  firebaseServiceAccountJson: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  firebaseAuthEmulatorHost: string;
  authBrokerMode: "live" | "emulator";
  authPublicBaseUrl: string;
  authAllowedRedirectUris: string[];
  androidAppPackage: string;
  androidAppSha256Fingerprints: string[];
  appleClientId: string;
  appleTeamId: string;
  appleKeyId: string;
  applePrivateKey: string;
  appleRedirectUri: string;
  telegramClientId: string;
  telegramClientSecret: string;
  telegramRedirectUri: string;
}

const toList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const normalizePrivateKey = (value: string | undefined): string =>
  (value ?? "").replace(/\\n/g, "\n").trim();

function loadEnvFiles(): void {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const bundleDir = path.resolve(__dirname, "..");
  const projectRoot = path.resolve(bundleDir, "..", "..");
  const projectBackendDir = path.resolve(projectRoot, "backend");
  const projectDesktopDir = path.resolve(projectRoot, "desktop");
  const candidateEnvPaths = Array.from(
    new Set(
      [
        process.env.SCALPSTATION_ENV_FILE,
        path.resolve(process.cwd(), "..", ".env.testnet"),
        path.resolve(process.cwd(), "backend", ".env.testnet"),
        path.resolve(process.cwd(), "desktop", ".env.testnet"),
        path.resolve(projectBackendDir, ".env.testnet"),
        path.resolve(projectDesktopDir, ".env.testnet"),
        path.resolve(projectRoot, ".env.testnet"),
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "..", ".env"),
        path.resolve(process.cwd(), "backend", ".env"),
        path.resolve(process.cwd(), "desktop", ".env"),
        path.resolve(projectBackendDir, ".env"),
        path.resolve(projectDesktopDir, ".env"),
        path.resolve(projectRoot, ".env"),
        path.resolve(path.dirname(process.execPath), ".env"),
        resourcesPath ? path.resolve(resourcesPath, ".env") : null
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => !!value)
    )
  );
  const loadedEnvFiles: string[] = [];

  for (const envPath of candidateEnvPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    dotenv.config({ path: envPath, override: false });
    loadedEnvFiles.push(envPath);
  }

  (process as NodeJS.Process & { scalpstationEnvDiagnostics?: ConfigEnvDiagnostics }).scalpstationEnvDiagnostics =
    {
      envFilePath: loadedEnvFiles[0] ?? null,
      envFileSource:
        process.env.SCALPSTATION_ENV_FILE?.trim() ||
        (loadedEnvFiles[0] ? path.basename(loadedEnvFiles[0]) : null),
      envFileCandidates: candidateEnvPaths,
      envFilesLoaded: loadedEnvFiles
    };
}

const authPublicBaseUrl = (process.env.AUTH_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
const authRedirectUri = (process.env.ANDROID_AUTH_REDIRECT_URI ?? "").trim();
const defaultDataDir = path.resolve(__dirname, "..", ".data");
const dataDir =
  (process.env.SCALPSTATION_DATA_DIR ?? "").trim() || defaultDataDir;

const requireTestnetSafeStartup = (value: AppConfig): void => {
  const liveEnabled = value.liveTradingEnabled || value.orderLiveModeEnabled;
  const environment = resolveBinanceEnvironment({
    binanceFuturesTestnet: value.binanceFuturesTestnet,
    restBase: value.binanceRestBase,
    wsBase: value.binanceWsBase,
    liveTradingEnabled: value.liveTradingEnabled,
    orderLiveModeEnabled: value.orderLiveModeEnabled
  });

  if (value.binanceFuturesTestnet && environment.restEnvironment !== "TESTNET") {
    throw new Error(
      "Unsafe Binance config: BINANCE_FUTURES_TESTNET=true requires BINANCE_REST_BASE=https://testnet.binancefuture.com."
    );
  }

  if (liveEnabled && value.binanceFuturesTestnet && environment.wsEnvironment !== "TESTNET") {
    throw new Error(
      "Unsafe Binance config: testnet live trading requires BINANCE_WS_BASE=wss://stream.binancefuture.com."
    );
  }

  if (liveEnabled && !value.binanceFuturesTestnet) {
    throw new Error(
      "Unsafe Binance config: live trading requires BINANCE_FUTURES_TESTNET=true."
    );
  }

  if (liveEnabled && !value.orderControlToken) {
    throw new Error(
      "Unsafe Binance config: live trading requires ORDER_CONTROL_TOKEN."
    );
  }

  if (liveEnabled && (!value.apiKey || !value.apiSecret)) {
    throw new Error(
      "Unsafe Binance config: live trading requires BINANCE_API_KEY and BINANCE_API_SECRET."
    );
  }
};

export const config: AppConfig = {
  binanceRestBase: process.env.BINANCE_REST_BASE ?? "https://fapi.binance.com",
  binanceWsBase: process.env.BINANCE_WS_BASE ?? "wss://fstream.binance.com",
  dataDir,
  marketEventStorePath:
    (process.env.SCALPSTATION_MARKET_EVENT_STORE_PATH ?? "").trim() ||
    path.join(dataDir, "market-events.jsonl"),
  sqlitePath:
    (process.env.SCALPSTATION_SQLITE_PATH ?? "").trim() ||
    path.join(dataDir, "darra-terminal.sqlite"),
  host: (process.env.BACKEND_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
  port: toNumber(process.env.BACKEND_PORT, 3001),
  wsPath: process.env.BACKEND_WS_PATH ?? "/ws",
  defaultFocusUniverseSize: toNumber(process.env.DEFAULT_FOCUS_UNIVERSE_SIZE, 40),
  frameIntervalMs: toNumber(process.env.FRAME_INTERVAL_MS, 1000),
  focusRebalanceIntervalMs: toNumber(process.env.FOCUS_REBALANCE_INTERVAL_MS, 15000),
  openInterestPollIntervalMs: toNumber(process.env.OPEN_INTEREST_POLL_INTERVAL_MS, 30000),
  openInterestPollTimeoutMs: toNumber(process.env.OPEN_INTEREST_POLL_TIMEOUT_MS, 4_000),
  openInterestStaleAfterMs: toNumber(process.env.OPEN_INTEREST_STALE_AFTER_MS, 90_000),
  openInterestPollMaxConcurrency: toNumber(process.env.OPEN_INTEREST_POLL_MAX_CONCURRENCY, 4),
  openInterestPollBackoffBaseMs: toNumber(
    process.env.OPEN_INTEREST_POLL_BACKOFF_BASE_MS,
    30_000
  ),
  openInterestPollBackoffMaxMs: toNumber(
    process.env.OPEN_INTEREST_POLL_BACKOFF_MAX_MS,
    300_000
  ),
  openInterestPollLogThrottleMs: toNumber(
    process.env.OPEN_INTEREST_POLL_LOG_THROTTLE_MS,
    60_000
  ),
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  binanceFuturesTestnet: toBoolean(process.env.BINANCE_FUTURES_TESTNET, false),
  orderPaperModeDefault: toBoolean(process.env.BINANCE_ORDER_PAPER_MODE, true),
  orderLiveModeEnabled: toBoolean(process.env.BINANCE_ORDER_LIVE_MODE_ENABLED, false),
  liveTradingEnabled: toBoolean(process.env.LIVE_TRADING_ENABLED, false),
  liveTradingRequiresTestnet: toBoolean(process.env.LIVE_TRADING_REQUIRES_TESTNET, true),
  liveTradingRequireTypedConfirm: toBoolean(process.env.LIVE_TRADING_REQUIRE_TYPED_CONFIRM, true),
  liveTradingKillSwitchEnabled: toBoolean(process.env.LIVE_TRADING_KILL_SWITCH_ENABLED, false),
  orderControlToken: (process.env.ORDER_CONTROL_TOKEN ?? "").trim(),
  orderControlAuthRequired: toBoolean(process.env.ORDER_CONTROL_AUTH_REQUIRED, true),
  orderControlAllowLoopbackPaper: toBoolean(process.env.ORDER_CONTROL_ALLOW_LOOPBACK_PAPER, true),
  liveRiskLimits: {
    maxOrderNotionalUsdt: {
      enabled: toBoolean(process.env.LIVE_MAX_ORDER_NOTIONAL_USDT_ENABLED, false),
      value: process.env.LIVE_MAX_ORDER_NOTIONAL_USDT
        ? toNumber(process.env.LIVE_MAX_ORDER_NOTIONAL_USDT, 0)
        : null
    },
    maxPositionNotionalUsdt: {
      enabled: toBoolean(process.env.LIVE_MAX_POSITION_NOTIONAL_USDT_ENABLED, false),
      value: process.env.LIVE_MAX_POSITION_NOTIONAL_USDT
        ? toNumber(process.env.LIVE_MAX_POSITION_NOTIONAL_USDT, 0)
        : null
    },
    maxOpenPositions: {
      enabled: toBoolean(process.env.LIVE_MAX_OPEN_POSITIONS_ENABLED, false),
      value: process.env.LIVE_MAX_OPEN_POSITIONS
        ? toNumber(process.env.LIVE_MAX_OPEN_POSITIONS, 0)
        : null
    },
    maxDailyLossUsdt: {
      enabled: toBoolean(process.env.LIVE_MAX_DAILY_LOSS_USDT_ENABLED, false),
      value: process.env.LIVE_MAX_DAILY_LOSS_USDT
        ? toNumber(process.env.LIVE_MAX_DAILY_LOSS_USDT, 0)
        : null
    },
    maxLeverage: {
      enabled: toBoolean(process.env.LIVE_MAX_LEVERAGE_ENABLED, false),
      value: process.env.LIVE_MAX_LEVERAGE ? toNumber(process.env.LIVE_MAX_LEVERAGE, 0) : null
    }
  },
  autoJournalFromBinance: toBoolean(process.env.AUTO_JOURNAL_FROM_BINANCE, true),
  positionSizingDefaultEquityUsdt: toNumber(process.env.POSITION_SIZING_DEFAULT_EQUITY_USDT, 1000),
  allowRemoteEnvBinanceAccountAccess: toBoolean(
    process.env.ALLOW_REMOTE_ENV_BINANCE_ACCOUNT_ACCESS,
    false
  ),
  allowRemoteTtsAccess: toBoolean(process.env.ALLOW_REMOTE_TTS_ACCESS, false),
  allowRemoteDiagnosticHealth: toBoolean(process.env.ALLOW_REMOTE_DIAGNOSTIC_HEALTH, false),
  firebaseProjectId:
    (process.env.FIREBASE_PROJECT_ID ?? "").trim() ||
    (process.env.ANDROID_FIREBASE_PROJECT_ID ?? "").trim(),
  firebaseServiceAccountJson: (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "").trim(),
  firebaseClientEmail: (process.env.FIREBASE_CLIENT_EMAIL ?? "").trim(),
  firebasePrivateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  firebaseAuthEmulatorHost: (process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "").trim(),
  authBrokerMode:
    (process.env.SOCIAL_AUTH_BROKER_MODE ?? "").trim().toLowerCase() === "emulator" ||
    !!process.env.FIREBASE_AUTH_EMULATOR_HOST
      ? "emulator"
      : "live",
  authPublicBaseUrl: authPublicBaseUrl,
  authAllowedRedirectUris: Array.from(
    new Set([
      ...toList(process.env.AUTH_APP_ALLOWED_REDIRECT_URIS),
      ...(authRedirectUri ? [authRedirectUri] : [])
    ])
  ),
  androidAppPackage: (process.env.ANDROID_APP_PACKAGE ?? "com.troesh.scalpstation").trim(),
  androidAppSha256Fingerprints: toList(process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS),
  appleClientId: (process.env.APPLE_CLIENT_ID ?? "").trim(),
  appleTeamId: (process.env.APPLE_TEAM_ID ?? "").trim(),
  appleKeyId: (process.env.APPLE_KEY_ID ?? "").trim(),
  applePrivateKey: normalizePrivateKey(process.env.APPLE_PRIVATE_KEY),
  appleRedirectUri:
    (process.env.APPLE_REDIRECT_URI ?? "").trim() ||
    (authPublicBaseUrl ? `${authPublicBaseUrl}/oauth/apple/callback` : ""),
  telegramClientId: (process.env.TELEGRAM_CLIENT_ID ?? "").trim(),
  telegramClientSecret: (process.env.TELEGRAM_CLIENT_SECRET ?? "").trim(),
  telegramRedirectUri:
    (process.env.TELEGRAM_REDIRECT_URI ?? "").trim() ||
    (authPublicBaseUrl ? `${authPublicBaseUrl}/oauth/telegram/callback` : "")
};

requireTestnetSafeStartup(config);
