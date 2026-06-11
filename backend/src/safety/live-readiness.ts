import {
  resolveBinanceEnvironment,
  type BinanceEnvironmentPolicy
} from "./binance-environment";

export type LiveReadinessMode = "DISABLED" | "TESTNET_ONLY";

export interface LiveRiskLimitConfig {
  enabled: boolean;
  value: number | null;
}

export interface LiveReadinessInput {
  liveTradingEnabled?: boolean | undefined;
  orderLiveModeEnabled: boolean;
  paperModeDefault: boolean;
  liveTradingRequiresTestnet?: boolean | undefined;
  liveTradingRequireTypedConfirm?: boolean | undefined;
  binanceFuturesTestnet?: boolean | undefined;
  restBase?: string | undefined;
  wsBase?: string | undefined;
  orderControlAuthRequired?: boolean | undefined;
  orderControlToken?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  liveTradingKillSwitchEnabled?: boolean | undefined;
  runtimeKillSwitchActive?: boolean | undefined;
  liveRiskLimits?: Record<string, LiveRiskLimitConfig> | undefined;
}

export interface LiveReadinessReason {
  code: string;
  message: string;
}

export interface LiveReadinessDecision {
  mode: LiveReadinessMode;
  ready: boolean;
  environment: BinanceEnvironmentPolicy;
  gates: {
    liveTradingEnabled: boolean;
    orderLiveModeEnabled: boolean;
    paperModeDefault: boolean;
    requiresTestnet: boolean;
    requireTypedConfirm: boolean;
    orderControlAuthRequired: boolean;
    orderControlTokenConfigured: boolean;
    apiCredentialsConfigured: boolean;
    restBaseTestnetReady: boolean;
    wsBaseTestnetReady: boolean;
    riskLimitsReady: boolean;
    configKillSwitchActive: boolean;
    runtimeKillSwitchActive: boolean;
    killSwitchActive: boolean;
  };
  disabledReasons: LiveReadinessReason[];
  warnings: LiveReadinessReason[];
}

export const evaluateLiveReadiness = (input: LiveReadinessInput): LiveReadinessDecision => {
  const disabledReasons: LiveReadinessReason[] = [];
  const warnings: LiveReadinessReason[] = [];
  const liveTradingEnabled = input.liveTradingEnabled === true;
  const liveTradingRequiresTestnet = input.liveTradingRequiresTestnet !== false;
  const liveTradingRequireTypedConfirm = input.liveTradingRequireTypedConfirm !== false;
  const binanceFuturesTestnet = input.binanceFuturesTestnet === true;
  const orderControlAuthRequired = input.orderControlAuthRequired !== false;
  const orderControlTokenConfigured = (input.orderControlToken ?? "").trim().length > 0;
  const apiCredentialsConfigured = Boolean(input.apiKey && input.apiSecret);
  const environment = resolveBinanceEnvironment({
    binanceFuturesTestnet,
    restBase: input.restBase,
    wsBase: input.wsBase,
    liveTradingEnabled,
    orderLiveModeEnabled: input.orderLiveModeEnabled
  });
  const restBaseTestnetReady = environment.restEnvironment === "TESTNET";
  const wsBaseTestnetReady = environment.wsEnvironment === "TESTNET";
  const configKillSwitchActive = input.liveTradingKillSwitchEnabled === true;
  const runtimeKillSwitchActive = input.runtimeKillSwitchActive === true;
  const killSwitchActive = configKillSwitchActive || runtimeKillSwitchActive;
  const invalidRiskLimit = Object.entries(input.liveRiskLimits ?? {}).find(([, limit]) => {
    const value = limit?.value;
    return limit?.enabled && (typeof value !== "number" || !Number.isFinite(value) || value <= 0);
  });
  const riskLimitsReady = !invalidRiskLimit;

  const addDisabledReason = (code: string, message: string): void => {
    disabledReasons.push({ code, message });
  };
  const addWarning = (code: string, message: string): void => {
    warnings.push({ code, message });
  };

  if (configKillSwitchActive) {
    addDisabledReason("CONFIG_KILL_SWITCH_ACTIVE", "Live trading is disabled by config kill switch.");
  }

  if (runtimeKillSwitchActive) {
    addDisabledReason("RUNTIME_KILL_SWITCH_ACTIVE", "Live trading is disabled by runtime kill switch.");
  }

  if (!liveTradingEnabled) {
    addDisabledReason("LIVE_TRADING_DISABLED", "LIVE_TRADING_ENABLED is not enabled.");
  }

  if (!input.orderLiveModeEnabled) {
    addDisabledReason("ORDER_LIVE_MODE_DISABLED", "BINANCE_ORDER_LIVE_MODE_ENABLED is not enabled.");
  }

  if (liveTradingRequiresTestnet && !binanceFuturesTestnet) {
    addDisabledReason("TESTNET_REQUIRED", "BINANCE_FUTURES_TESTNET=true is required for live order readiness.");
  }

  for (const blocker of environment.blockers) {
    addDisabledReason(blocker.code, blocker.message);
  }

  if (orderControlAuthRequired && !orderControlTokenConfigured) {
    addDisabledReason("ORDER_CONTROL_TOKEN_MISSING", "ORDER_CONTROL_TOKEN is required when order control auth is enabled.");
  }

  if (!apiCredentialsConfigured) {
    addDisabledReason("API_CREDENTIALS_MISSING", "Binance API key and secret are required for testnet live execution.");
  }

  if (invalidRiskLimit) {
    addDisabledReason("RISK_LIMIT_INVALID", `${invalidRiskLimit[0]} is enabled without a positive value.`);
  }

  if (!input.paperModeDefault) {
    addWarning("PAPER_MODE_NOT_DEFAULT", "BINANCE_ORDER_PAPER_MODE is not the default order mode.");
  }

  if (!liveTradingRequireTypedConfirm) {
    addWarning("TYPED_CONFIRM_DISABLED", "LIVE_TRADING_REQUIRE_TYPED_CONFIRM is disabled.");
  }

  if (!orderControlAuthRequired) {
    addWarning("ORDER_CONTROL_AUTH_DISABLED", "ORDER_CONTROL_AUTH_REQUIRED is disabled; use only in local/dev workflows.");
  }

  for (const warning of environment.warnings) {
    addWarning(warning.code, warning.message);
  }

  const ready = disabledReasons.length === 0;

  return {
    mode: ready ? "TESTNET_ONLY" : "DISABLED",
    ready,
    environment,
    gates: {
      liveTradingEnabled,
      orderLiveModeEnabled: input.orderLiveModeEnabled,
      paperModeDefault: input.paperModeDefault,
      requiresTestnet: liveTradingRequiresTestnet,
      requireTypedConfirm: liveTradingRequireTypedConfirm,
      orderControlAuthRequired,
      orderControlTokenConfigured,
      apiCredentialsConfigured,
      restBaseTestnetReady,
      wsBaseTestnetReady,
      riskLimitsReady,
      configKillSwitchActive,
      runtimeKillSwitchActive,
      killSwitchActive
    },
    disabledReasons,
    warnings
  };
};
