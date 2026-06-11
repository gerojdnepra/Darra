import { evaluateLiveReadiness, type LiveReadinessInput } from "./live-readiness";

type ExpectedReasonLocation = "disabledReasons" | "warnings";

interface CheckCase {
  name: string;
  input: LiveReadinessInput;
  expected: {
    ready: boolean;
    mode?: "DISABLED" | "TESTNET_ONLY";
    reason?: {
      code: string;
      location: ExpectedReasonLocation;
    };
    environment?: {
      intendedMode?: "LIVE" | "TESTNET" | "DISABLED";
      restEnvironment?: "LIVE" | "TESTNET" | "UNKNOWN";
      wsEnvironment?: "LIVE" | "TESTNET" | "UNKNOWN";
    };
    noDisabledReasons?: boolean;
  };
}

const validRiskLimits: NonNullable<LiveReadinessInput["liveRiskLimits"]> = {
  maxOrderNotionalUsdt: { enabled: true, value: 100 },
  maxPositionNotionalUsdt: { enabled: true, value: 500 },
  maxDailyLossUsdt: { enabled: true, value: 50 },
  maxLeverage: { enabled: true, value: 5 }
};

const baseReadyInput: LiveReadinessInput = {
  liveTradingEnabled: true,
  orderLiveModeEnabled: true,
  paperModeDefault: true,
  liveTradingRequiresTestnet: true,
  liveTradingRequireTypedConfirm: true,
  binanceFuturesTestnet: true,
  restBase: "https://testnet.binancefuture.com",
  wsBase: "wss://stream.binancefuture.com",
  orderControlAuthRequired: true,
  orderControlToken: "configured-token",
  apiKey: "configured-api-key",
  apiSecret: "configured-api-secret",
  liveTradingKillSwitchEnabled: false,
  runtimeKillSwitchActive: false,
  liveRiskLimits: validRiskLimits
};

const cases: CheckCase[] = [
  {
    name: "safe ready case",
    input: baseReadyInput,
    expected: {
      ready: true,
      mode: "TESTNET_ONLY",
      noDisabledReasons: true,
      environment: {
        intendedMode: "TESTNET",
        restEnvironment: "TESTNET",
        wsEnvironment: "TESTNET"
      }
    }
  },
  {
    name: "LIVE_TRADING_ENABLED=false",
    input: { ...baseReadyInput, liveTradingEnabled: false },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "LIVE_TRADING_DISABLED", location: "disabledReasons" }
    }
  },
  {
    name: "BINANCE_ORDER_LIVE_MODE_ENABLED=false",
    input: { ...baseReadyInput, orderLiveModeEnabled: false },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "ORDER_LIVE_MODE_DISABLED", location: "disabledReasons" }
    }
  },
  {
    name: "runtime kill switch active",
    input: { ...baseReadyInput, runtimeKillSwitchActive: true },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "RUNTIME_KILL_SWITCH_ACTIVE", location: "disabledReasons" }
    }
  },
  {
    name: "config kill switch active",
    input: { ...baseReadyInput, liveTradingKillSwitchEnabled: true },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "CONFIG_KILL_SWITCH_ACTIVE", location: "disabledReasons" }
    }
  },
  {
    name: "testnet required but disabled",
    input: { ...baseReadyInput, binanceFuturesTestnet: false },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "TESTNET_REQUIRED", location: "disabledReasons" }
    }
  },
  {
    name: "REST base not testnet",
    input: { ...baseReadyInput, restBase: "https://fapi.binance.com" },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "REST_BASE_NOT_TESTNET", location: "disabledReasons" }
    }
  },
  {
    name: "missing ORDER_CONTROL_TOKEN when auth required",
    input: { ...baseReadyInput, orderControlToken: "" },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "ORDER_CONTROL_TOKEN_MISSING", location: "disabledReasons" }
    }
  },
  {
    name: "missing API credentials",
    input: { ...baseReadyInput, apiKey: undefined, apiSecret: undefined },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "API_CREDENTIALS_MISSING", location: "disabledReasons" }
    }
  },
  {
    name: "invalid risk limits",
    input: {
      ...baseReadyInput,
      liveRiskLimits: {
        ...validRiskLimits,
        maxDailyLossUsdt: { enabled: true, value: 0 }
      }
    },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "RISK_LIMIT_INVALID", location: "disabledReasons" }
    }
  },
  {
    name: "WS base not testnet blocks testnet live readiness",
    input: { ...baseReadyInput, wsBase: "wss://fstream.binance.com" },
    expected: {
      ready: false,
      mode: "DISABLED",
      reason: { code: "WS_BASE_NOT_TESTNET", location: "disabledReasons" },
      environment: {
        intendedMode: "TESTNET",
        restEnvironment: "TESTNET",
        wsEnvironment: "LIVE"
      }
    }
  },
  {
    name: "paper mode disabled is warning only",
    input: { ...baseReadyInput, paperModeDefault: false },
    expected: {
      ready: true,
      mode: "TESTNET_ONLY",
      reason: { code: "PAPER_MODE_NOT_DEFAULT", location: "warnings" },
      noDisabledReasons: true
    }
  }
];

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

for (const item of cases) {
  const decision = evaluateLiveReadiness(item.input);

  assert(
    decision.ready === item.expected.ready,
    `${item.name}: expected ready=${item.expected.ready}, got ${decision.ready}`
  );

  if (item.expected.mode) {
    assert(
      decision.mode === item.expected.mode,
      `${item.name}: expected mode=${item.expected.mode}, got ${decision.mode}`
    );
  }

  if (item.expected.noDisabledReasons) {
    assert(
      decision.disabledReasons.length === 0,
      `${item.name}: expected no disabled reasons, got ${decision.disabledReasons
        .map((reason) => reason.code)
        .join(", ")}`
    );
  }

  if (item.expected.environment?.intendedMode) {
    assert(
      decision.environment.intendedMode === item.expected.environment.intendedMode,
      `${item.name}: expected intendedMode=${item.expected.environment.intendedMode}, got ${decision.environment.intendedMode}`
    );
  }

  if (item.expected.environment?.restEnvironment) {
    assert(
      decision.environment.restEnvironment === item.expected.environment.restEnvironment,
      `${item.name}: expected restEnvironment=${item.expected.environment.restEnvironment}, got ${decision.environment.restEnvironment}`
    );
  }

  if (item.expected.environment?.wsEnvironment) {
    assert(
      decision.environment.wsEnvironment === item.expected.environment.wsEnvironment,
      `${item.name}: expected wsEnvironment=${item.expected.environment.wsEnvironment}, got ${decision.environment.wsEnvironment}`
    );
  }

  if (item.expected.reason) {
    const reasons = decision[item.expected.reason.location];
    assert(
      reasons.some((reason) => reason.code === item.expected.reason?.code),
      `${item.name}: expected ${item.expected.reason.location} to include ${
        item.expected.reason.code
      }, got ${reasons.map((reason) => reason.code).join(", ")}`
    );
  }
}

console.log(`live-readiness checks passed (${cases.length} scenarios)`);
