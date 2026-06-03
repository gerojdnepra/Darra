import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

loadEnvFiles();

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
  apiKey: string | undefined;
  apiSecret: string | undefined;
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
  const candidateEnvPaths = Array.from(
    new Set(
      [
        process.env.SCALPSTATION_ENV_FILE,
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "..", ".env"),
        path.resolve(path.dirname(process.execPath), ".env"),
        resourcesPath ? path.resolve(resourcesPath, ".env") : null
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => !!value)
    )
  );

  for (const envPath of candidateEnvPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    dotenv.config({ path: envPath, override: false });
  }
}

const authPublicBaseUrl = (process.env.AUTH_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
const authRedirectUri = (process.env.ANDROID_AUTH_REDIRECT_URI ?? "").trim();
const defaultDataDir = path.resolve(__dirname, "..", ".data");
const dataDir =
  (process.env.SCALPSTATION_DATA_DIR ?? "").trim() || defaultDataDir;

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
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
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
