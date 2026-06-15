import WebSocket from "ws";
import {
  BinanceApiError,
  fetchFuturesAccountSnapshot,
  fetchPositionRiskSnapshot,
  getCachedLeverageBrackets,
  startUserDataStream
} from "../services/binance-rest";
import { evaluateLiveReadiness, type LiveReadinessInput } from "./live-readiness";

type HarnessStatus = "PASS" | "FAIL";

interface HarnessSection {
  name: string;
  status: HarnessStatus;
  detail: Record<string, unknown>;
  blocker: string | null;
}

const testnetRestBase = "https://testnet.binancefuture.com";
const testnetWsBase = "wss://stream.binancefuture.com";
const privateWsTimeoutMs = 10_000;

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
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

const toNumberOrNull = (value: string | undefined): number | null => {
  if (!value?.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value?.trim() ? value.trim() : undefined;
};

const redact = (
  value: string,
  secrets: Array<string | undefined | null>
): string => {
  let redacted = value;

  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    redacted = redacted.split(secret).join("<redacted>");
  }

  return redacted;
};

const errorDetail = (
  error: unknown,
  secrets: Array<string | undefined | null>
): Record<string, unknown> => {
  const message = error instanceof Error ? error.message : String(error);
  const detail: Record<string, unknown> = {
    message: redact(message, secrets)
  };

  if (error instanceof BinanceApiError) {
    detail.httpStatus = error.status;
    if (error.code !== undefined) {
      detail.binanceCode = error.code;
    }
  }

  return detail;
};

const addSection = (
  sections: HarnessSection[],
  name: string,
  status: HarnessStatus,
  detail: Record<string, unknown>,
  blocker: string | null = null
): void => {
  sections.push({
    name,
    status,
    detail,
    blocker
  });
};

const buildLiveRiskLimits = (): LiveReadinessInput["liveRiskLimits"] => ({
  maxOrderNotionalUsdt: {
    enabled: toBoolean(readEnv("LIVE_MAX_ORDER_NOTIONAL_USDT_ENABLED"), false),
    value: toNumberOrNull(readEnv("LIVE_MAX_ORDER_NOTIONAL_USDT"))
  },
  maxPositionNotionalUsdt: {
    enabled: toBoolean(readEnv("LIVE_MAX_POSITION_NOTIONAL_USDT_ENABLED"), false),
    value: toNumberOrNull(readEnv("LIVE_MAX_POSITION_NOTIONAL_USDT"))
  },
  maxOpenPositions: {
    enabled: toBoolean(readEnv("LIVE_MAX_OPEN_POSITIONS_ENABLED"), false),
    value: toNumberOrNull(readEnv("LIVE_MAX_OPEN_POSITIONS"))
  },
  maxDailyLossUsdt: {
    enabled: toBoolean(readEnv("LIVE_MAX_DAILY_LOSS_USDT_ENABLED"), false),
    value: toNumberOrNull(readEnv("LIVE_MAX_DAILY_LOSS_USDT"))
  },
  maxLeverage: {
    enabled: toBoolean(readEnv("LIVE_MAX_LEVERAGE_ENABLED"), false),
    value: toNumberOrNull(readEnv("LIVE_MAX_LEVERAGE"))
  }
});

const waitForPrivateWsOpen = async (
  wsBase: string,
  listenKey: string,
  secrets: Array<string | undefined | null>
): Promise<Record<string, unknown>> => {
  const startedAt = Date.now();
  const socketUrl = `${wsBase.replace(/\/+$/, "")}/private/ws/${listenKey}`;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
      callback();
    };

    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error(`private WS open timed out after ${privateWsTimeoutMs}ms`));
      });
    }, privateWsTimeoutMs);

    socket.on("open", () => {
      finish(() => {
        resolve({
          connected: true,
          elapsedMs: Date.now() - startedAt,
          listenKey: "<redacted>"
        });
      });
    });

    socket.on("error", (error) => {
      finish(() => {
        reject(new Error(redact(error.message, secrets)));
      });
    });
  });
};

const printReport = (sections: HarnessSection[]): void => {
  const overall = sections.every((section) => section.status === "PASS") ? "PASS" : "FAIL";
  const firstBlocker = sections.find((section) => section.status === "FAIL")?.blocker ?? null;

  console.log("## SG-007G Credential-Safe Testnet Runtime Harness");
  console.log(`Overall: ${overall}`);
  if (firstBlocker) {
    console.log(`First blocker: ${firstBlocker}`);
  }
  console.log("");

  for (const section of sections) {
    console.log(`### ${section.name}: ${section.status}`);
    if (section.blocker) {
      console.log(`Blocker: ${section.blocker}`);
    }
    console.log(JSON.stringify(section.detail, null, 2));
    console.log("");
  }
};

const run = async (): Promise<void> => {
  const sections: HarnessSection[] = [];
  const restBase = readEnv("BINANCE_REST_BASE") ?? testnetRestBase;
  const wsBase = readEnv("BINANCE_WS_BASE") ?? testnetWsBase;
  const apiKey = readEnv("BINANCE_API_KEY");
  const apiSecret = readEnv("BINANCE_API_SECRET");
  const orderControlToken = readEnv("ORDER_CONTROL_TOKEN");
  const symbol = (readEnv("SG007_SYMBOL") ?? readEnv("BINANCE_TEST_SYMBOL") ?? "BTCUSDT").toUpperCase();
  const secrets = [apiKey, apiSecret, orderControlToken];

  const readinessInput: LiveReadinessInput = {
    liveTradingEnabled: toBoolean(readEnv("LIVE_TRADING_ENABLED"), false),
    orderLiveModeEnabled: toBoolean(readEnv("BINANCE_ORDER_LIVE_MODE_ENABLED"), false),
    paperModeDefault: toBoolean(readEnv("BINANCE_ORDER_PAPER_MODE"), true),
    liveTradingRequiresTestnet: toBoolean(readEnv("LIVE_TRADING_REQUIRES_TESTNET"), true),
    liveTradingRequireTypedConfirm: toBoolean(readEnv("LIVE_TRADING_REQUIRE_TYPED_CONFIRM"), true),
    binanceFuturesTestnet: toBoolean(readEnv("BINANCE_FUTURES_TESTNET"), false),
    restBase,
    wsBase,
    orderControlAuthRequired: toBoolean(readEnv("ORDER_CONTROL_AUTH_REQUIRED"), true),
    orderControlToken,
    apiKey,
    apiSecret,
    liveTradingKillSwitchEnabled: toBoolean(readEnv("LIVE_TRADING_KILL_SWITCH_ENABLED"), false),
    runtimeKillSwitchActive: false,
    liveRiskLimits: buildLiveRiskLimits()
  };
  const readiness = evaluateLiveReadiness(readinessInput);

  addSection(
    sections,
    "Environment classification",
    readiness.environment.intendedMode === "TESTNET" &&
      readiness.environment.restEnvironment === "TESTNET" &&
      readiness.environment.wsEnvironment === "TESTNET"
      ? "PASS"
      : "FAIL",
    {
      intendedMode: readiness.environment.intendedMode,
      restEnvironment: readiness.environment.restEnvironment,
      wsEnvironment: readiness.environment.wsEnvironment,
      restBase: readiness.environment.restBase,
      wsBase: readiness.environment.wsBase,
      blockers: readiness.environment.blockers.map((blocker) => blocker.code),
      warnings: readiness.environment.warnings.map((warning) => warning.code)
    },
    readiness.environment.intendedMode !== "TESTNET"
      ? "Configured runtime is not in TESTNET mode."
      : readiness.environment.restEnvironment !== "TESTNET"
        ? "BINANCE_REST_BASE is not classified as Binance Futures testnet."
        : readiness.environment.wsEnvironment !== "TESTNET"
          ? "BINANCE_WS_BASE is not classified as Binance Futures testnet."
          : null
  );

  addSection(
    sections,
    "Credential presence",
    apiKey && apiSecret ? "PASS" : "FAIL",
    {
      apiKey: apiKey ? "<configured>" : "<missing>",
      apiSecret: apiSecret ? "<configured>" : "<missing>",
      orderControlToken: orderControlToken ? "<configured>" : "<missing>",
      printedSecrets: false
    },
    !apiKey || !apiSecret ? "BINANCE_API_KEY and BINANCE_API_SECRET must be supplied in the process environment." : null
  );

  let accountSnapshotOk = false;
  let positionSnapshotOk = false;
  let leverageOk = false;
  let listenKey: string | null = null;

  if (apiKey && apiSecret) {
    try {
      const account = await fetchFuturesAccountSnapshot(restBase, apiKey, apiSecret);
      accountSnapshotOk = true;
      addSection(sections, "REST authenticated account access", "PASS", {
        canTrade: account.canTrade,
        canDeposit: account.canDeposit,
        canWithdraw: account.canWithdraw,
        assetCount: account.assets.length,
        hasAvailableBalance: account.availableBalance.trim().length > 0,
        updateTimeType: typeof account.updateTime
      });
    } catch (error) {
      addSection(
        sections,
        "REST authenticated account access",
        "FAIL",
        errorDetail(error, secrets),
        "Signed account snapshot request failed."
      );
    }

    try {
      const response = await startUserDataStream(restBase, apiKey);
      listenKey = response.listenKey;
      addSection(sections, "listenKey creation", "PASS", {
        listenKey: response.listenKey ? "<redacted>" : "<missing>",
        created: Boolean(response.listenKey)
      });
    } catch (error) {
      addSection(
        sections,
        "listenKey creation",
        "FAIL",
        errorDetail(error, secrets),
        "User data stream listenKey creation failed."
      );
    }

    if (listenKey) {
      try {
        const detail = await waitForPrivateWsOpen(wsBase, listenKey, [...secrets, listenKey]);
        addSection(sections, "Private WS connection", "PASS", detail);
      } catch (error) {
        addSection(
          sections,
          "Private WS connection",
          "FAIL",
          errorDetail(error, [...secrets, listenKey]),
          "Private account WebSocket did not open with the created listenKey."
        );
      }
    } else {
      addSection(sections, "Private WS connection", "FAIL", {
        listenKey: "<missing>"
      }, "Private WS requires a successfully created listenKey.");
    }

    try {
      const positions = await fetchPositionRiskSnapshot(restBase, apiKey, apiSecret);
      positionSnapshotOk = true;
      addSection(sections, "Account snapshot access", "PASS", {
        positionCount: positions.length,
        activePositionCount: positions.filter((position) => Number(position.positionAmt) !== 0).length,
        symbolPresent: positions.some((position) => position.symbol === symbol)
      });
    } catch (error) {
      addSection(
        sections,
        "Account snapshot access",
        "FAIL",
        errorDetail(error, secrets),
        "Signed position risk snapshot request failed."
      );
    }

    try {
      const leverage = await getCachedLeverageBrackets(restBase, apiKey, apiSecret, symbol, 0);
      leverageOk = leverage.status === "AUTHORITATIVE" && leverage.brackets.length > 0;
      addSection(
        sections,
        "Leverage bracket retrieval",
        leverageOk ? "PASS" : "FAIL",
        {
          symbol,
          status: leverage.status,
          bracketCount: leverage.brackets.length,
          fetchedAt: leverage.fetchedAt,
          error: leverage.error ? redact(leverage.error, secrets) : null
        },
        leverageOk ? null : "Leverage bracket source did not return authoritative bracket data."
      );
    } catch (error) {
      addSection(
        sections,
        "Leverage bracket retrieval",
        "FAIL",
        errorDetail(error, secrets),
        "Leverage bracket retrieval failed."
      );
    }
  } else {
    addSection(sections, "REST authenticated account access", "FAIL", {}, "Missing credentials.");
    addSection(sections, "listenKey creation", "FAIL", {}, "Missing credentials.");
    addSection(sections, "Private WS connection", "FAIL", {}, "Missing credentials.");
    addSection(sections, "Account snapshot access", "FAIL", {}, "Missing credentials.");
    addSection(sections, "Leverage bracket retrieval", "FAIL", { symbol }, "Missing credentials.");
  }

  const preflightInputsReady =
    readiness.ready &&
    accountSnapshotOk &&
    positionSnapshotOk &&
    leverageOk;
  addSection(
    sections,
    "Preflight readiness inputs",
    preflightInputsReady ? "PASS" : "FAIL",
    {
      liveReadinessReady: readiness.ready,
      liveReadinessMode: readiness.mode,
      disabledReasons: readiness.disabledReasons.map((reason) => reason.code),
      warnings: readiness.warnings.map((warning) => warning.code),
      accountSnapshotOk,
      positionSnapshotOk,
      leverageOk,
      symbol
    },
    preflightInputsReady
      ? null
      : "One or more read-only runtime inputs required by non-paper preflight are unavailable."
  );

  printReport(sections);

  if (
    sections.some((section) => section.status === "FAIL") &&
    toBoolean(readEnv("SG007_STRICT"), false)
  ) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error("SG-007G harness failed unexpectedly.");
  console.error("Unexpected diagnostic errors are intentionally not printed to avoid leaking credentials.");
  process.exitCode = 1;
});
