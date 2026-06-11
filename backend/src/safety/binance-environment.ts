export type BinanceEnvironmentMode = "LIVE" | "TESTNET" | "DISABLED";
export type BinanceEndpointEnvironment = "LIVE" | "TESTNET" | "UNKNOWN";

export interface BinanceEnvironmentReason {
  code: string;
  message: string;
}

export interface BinanceEnvironmentInput {
  binanceFuturesTestnet?: boolean | undefined;
  restBase?: string | undefined;
  wsBase?: string | undefined;
  liveTradingEnabled?: boolean | undefined;
  orderLiveModeEnabled?: boolean | undefined;
}

export interface BinanceEnvironmentPolicy {
  intendedMode: BinanceEnvironmentMode;
  restBase: string;
  wsBase: string;
  restEnvironment: BinanceEndpointEnvironment;
  wsEnvironment: BinanceEndpointEnvironment;
  restOk: boolean;
  wsOk: boolean;
  blockers: BinanceEnvironmentReason[];
  warnings: BinanceEnvironmentReason[];
}

export interface BinanceEnvironmentDiagnostics {
  mode: BinanceEnvironmentMode;
  restBaseClassification: BinanceEndpointEnvironment;
  wsBaseClassification: BinanceEndpointEnvironment;
  restBaseIsTestnet: boolean;
  wsBaseIsTestnet: boolean;
}

const LIVE_REST_HOST = "fapi.binance.com";
const LIVE_WS_HOST = "fstream.binance.com";
const TESTNET_REST_HOST = "testnet.binancefuture.com";
const TESTNET_WS_HOST = "stream.binancefuture.com";

const classifyEndpoint = (
  rawUrl: string | undefined,
  expectedProtocol: "https:" | "wss:",
  liveHost: string,
  testnetHost: string
): BinanceEndpointEnvironment => {
  if (!rawUrl?.trim()) {
    return "UNKNOWN";
  }

  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();

    if (url.protocol === expectedProtocol && host === liveHost) {
      return "LIVE";
    }

    if (url.protocol === expectedProtocol && host === testnetHost) {
      return "TESTNET";
    }
  } catch {
    return "UNKNOWN";
  }

  return "UNKNOWN";
};

export const resolveBinanceEnvironment = (
  input: BinanceEnvironmentInput
): BinanceEnvironmentPolicy => {
  const restBase = input.restBase ?? "";
  const wsBase = input.wsBase ?? "";
  const liveModeCanBeEnabled =
    input.liveTradingEnabled === true || input.orderLiveModeEnabled === true;
  const intendedMode: BinanceEnvironmentMode = !liveModeCanBeEnabled
    ? "DISABLED"
    : input.binanceFuturesTestnet === true
      ? "TESTNET"
      : "LIVE";
  const restEnvironment = classifyEndpoint(
    restBase,
    "https:",
    LIVE_REST_HOST,
    TESTNET_REST_HOST
  );
  const wsEnvironment = classifyEndpoint(
    wsBase,
    "wss:",
    LIVE_WS_HOST,
    TESTNET_WS_HOST
  );
  const blockers: BinanceEnvironmentReason[] = [];
  const warnings: BinanceEnvironmentReason[] = [];
  const restOk = intendedMode === "DISABLED" || restEnvironment === intendedMode;
  const wsOk = intendedMode === "DISABLED" || wsEnvironment === intendedMode;

  if (intendedMode === "TESTNET" && restEnvironment !== "TESTNET") {
    blockers.push({
      code: "REST_BASE_NOT_TESTNET",
      message: "BINANCE_REST_BASE must point to Binance Futures testnet."
    });
  }

  if (intendedMode === "TESTNET" && wsEnvironment !== "TESTNET") {
    blockers.push({
      code: "WS_BASE_NOT_TESTNET",
      message: "BINANCE_WS_BASE must point to Binance Futures testnet."
    });
  }

  if (intendedMode === "LIVE" && restEnvironment !== "LIVE") {
    blockers.push({
      code: "REST_BASE_NOT_LIVE",
      message: "BINANCE_REST_BASE must point to Binance Futures live."
    });
  }

  if (intendedMode === "LIVE" && wsEnvironment !== "LIVE") {
    blockers.push({
      code: "WS_BASE_NOT_LIVE",
      message: "BINANCE_WS_BASE must point to Binance Futures live."
    });
  }

  if (restEnvironment === "UNKNOWN") {
    warnings.push({
      code: "REST_BASE_UNKNOWN",
      message: "BINANCE_REST_BASE is not a recognized Binance USDT-M Futures endpoint."
    });
  }

  if (wsEnvironment === "UNKNOWN") {
    warnings.push({
      code: "WS_BASE_UNKNOWN",
      message: "BINANCE_WS_BASE is not a recognized Binance USDT-M Futures endpoint."
    });
  }

  return {
    intendedMode,
    restBase,
    wsBase,
    restEnvironment,
    wsEnvironment,
    restOk,
    wsOk,
    blockers,
    warnings
  };
};

export const summarizeBinanceEnvironmentDiagnostics = (
  policy: BinanceEnvironmentPolicy
): BinanceEnvironmentDiagnostics => ({
  mode: policy.intendedMode,
  restBaseClassification: policy.restEnvironment,
  wsBaseClassification: policy.wsEnvironment,
  restBaseIsTestnet: policy.restEnvironment === "TESTNET",
  wsBaseIsTestnet: policy.wsEnvironment === "TESTNET"
});
