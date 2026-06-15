import { randomUUID } from "node:crypto";
import { buildDecisionReplay } from "../storage/decision-replay-service";
import { decisionReviewRepository } from "../storage/decision-review-repository";
import { getSqlite } from "../storage/sqlite";
import { orderRepository } from "../storage/order-repository";
import { positionLifecycleRepository } from "../storage/position-lifecycle-repository";
import { unifiedSignalRepository } from "../storage/unified-signal-repository";
import { decisionContextFixtureFactory } from "../decision/decision-context-fixture-factory";
import type {
  OrderIntentMessage,
  OrderSide,
  OrderValidationPayload,
  RequestOrderPreflightMessage,
  SafeToAddResult,
  ScreenerRow,
  UnifiedSignalEvent
} from "../types/messages";
import type { RestFuturesAccountV3, RestPositionRiskV3 } from "../types/binance";
import type {
  AccountStreamHealth,
  BinanceAccountRiskSnapshot
} from "../services/binance-account-stream";
import { BinanceOrderService } from "../services/binance-order-service";
import {
  cancelFuturesOrder,
  fetchFuturesAccountSnapshot,
  fetchPositionRiskSnapshot,
  getFuturesOrder,
  getOpenOrders,
  getPositionRisk,
  placeFuturesOrder
} from "../services/binance-rest";
import {
  getExchangeFilterMap,
  getSymbolFilters,
  normalizeQuantity
} from "../services/binance-exchange-filters";
import type { BinanceSymbolFilters } from "../services/binance-exchange-filters";
import { summarizeBinanceEnvironmentDiagnostics } from "./binance-environment";
import { evaluateLiveReadiness, type LiveReadinessInput } from "./live-readiness";
import { buildSafeToAddResult } from "./order-safety";

type SectionStatus = "PASS" | "FAIL";

interface SmokeSection {
  name: string;
  status: SectionStatus;
  detail: Record<string, unknown>;
  blocker: string | null;
}

interface MinimalOrderPlan {
  symbol: "BTCUSDT";
  side: OrderSide;
  closeSide: OrderSide;
  type: "MARKET";
  quantity: number;
  price: number;
  notional: number;
  filters: BinanceSymbolFilters;
}

interface PriceEvidence {
  price: number;
  source: "positionRisk markPrice" | "premiumIndex markPrice" | "ticker price";
  endpoint: string | null;
}

interface PremiumIndexPriceResponse {
  symbol?: string;
  markPrice?: string;
}

interface TickerPriceResponse {
  symbol?: string;
  price?: string;
}

type HarnessLiveRiskLimits = Record<string, { enabled: boolean; value: number | null }> & {
  maxOrderNotionalUsdt: { enabled: boolean; value: number | null };
  maxPositionNotionalUsdt: { enabled: boolean; value: number | null };
  maxOpenPositions: { enabled: boolean; value: number | null };
  maxDailyLossUsdt: { enabled: boolean; value: number | null };
  maxLeverage: { enabled: boolean; value: number | null };
};

const testnetRestBase = "https://testnet.binancefuture.com";
const testnetWsBase = "wss://stream.binancefuture.com";
const symbol = "BTCUSDT";
const stagePrefix = "sg008b";
const waitTimeoutMs = 30_000;
const waitIntervalMs = 1_000;

const readEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value?.trim() ? value.trim() : undefined;
};

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

const positiveNumber = (value: string | number | null | undefined): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const publicJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`public request failed ${response.status} for ${new URL(url).pathname}`);
  }

  return (await response.json()) as T;
};

const resolveMarkPrice = async (
  restBase: string,
  positions: RestPositionRiskV3[]
): Promise<PriceEvidence | null> => {
  const positionRiskPrice = positiveNumber(
    positions.find((position) => position.symbol === symbol)?.markPrice
  );

  if (positionRiskPrice !== null) {
    return {
      price: positionRiskPrice,
      source: "positionRisk markPrice",
      endpoint: "/fapi/v3/positionRisk"
    };
  }

  const premiumIndexEndpoint = `/fapi/v1/premiumIndex?symbol=${symbol}`;
  const premiumIndex = await publicJson<PremiumIndexPriceResponse>(
    `${restBase}${premiumIndexEndpoint}`
  );
  const premiumIndexPrice = positiveNumber(premiumIndex.markPrice);

  if (premiumIndexPrice !== null) {
    return {
      price: premiumIndexPrice,
      source: "premiumIndex markPrice",
      endpoint: premiumIndexEndpoint
    };
  }

  const tickerEndpoint = `/fapi/v1/ticker/price?symbol=${symbol}`;
  const ticker = await publicJson<TickerPriceResponse>(`${restBase}${tickerEndpoint}`);
  const tickerPrice = positiveNumber(ticker.price);

  return tickerPrice !== null
    ? {
        price: tickerPrice,
        source: "ticker price",
        endpoint: tickerEndpoint
      }
    : null;
};

const signedNumber = (value: string | number | null | undefined): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const decimalPlaces = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 8;
  }

  const text = value.toString();
  if (text.includes("e-")) {
    return Number(text.split("e-")[1]) || 8;
  }

  return text.split(".")[1]?.length ?? 0;
};

const ceilToStep = (value: number, step: number): number => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(step) || step <= 0) {
    return 0;
  }

  return Number((Math.ceil(value / step) * step).toFixed(decimalPlaces(step)));
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const addSection = (
  sections: SmokeSection[],
  name: string,
  status: SectionStatus,
  detail: Record<string, unknown>,
  blocker: string | null = null
): void => {
  sections.push({ name, status, detail, blocker });
};

const redact = (value: string, secrets: Array<string | null | undefined>): string => {
  let output = value;

  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    output = output.split(secret).join("<redacted>");
  }

  return output;
};

const errorDetail = (
  error: unknown,
  secrets: Array<string | null | undefined>
): Record<string, unknown> => ({
  message: redact(error instanceof Error ? error.message : String(error), secrets)
});

const buildLiveRiskLimits = (): HarnessLiveRiskLimits => ({
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

const accountSnapshotFromRest = (
  account: RestFuturesAccountV3,
  positions: RestPositionRiskV3[]
): BinanceAccountRiskSnapshot => {
  const now = Date.now();
  const activePositions = positions
    .map((position) => {
      const quantity = signedNumber(position.positionAmt);
      return {
        symbol: position.symbol,
        positionSide: position.positionSide,
        quantity,
        entryPrice: signedNumber(position.entryPrice),
        breakEvenPrice: signedNumber(position.breakEvenPrice),
        markPrice: signedNumber(position.markPrice),
        unrealizedPnl: signedNumber(position.unRealizedProfit),
        liquidationPrice: signedNumber(position.liquidationPrice),
        isolatedMargin: signedNumber(position.isolatedMargin),
        isolatedWallet: signedNumber(position.isolatedWallet),
        initialMargin: signedNumber(position.initialMargin),
        maintMargin: signedNumber(position.maintMargin),
        positionInitialMargin: signedNumber(position.positionInitialMargin),
        openOrderInitialMargin: signedNumber(position.openOrderInitialMargin),
        marginType: signedNumber(position.isolatedMargin) > 0 ? "isolated" as const : "cross" as const,
        updatedAt: position.updateTime || now
      };
    });

  return {
    enabled: true,
    connected: true,
    credentialSource: "env",
    balanceAsset: "USDT",
    lastSyncAt: now,
    balances: {
      walletBalanceUsd: signedNumber(account.totalWalletBalance),
      availableBalanceUsd: signedNumber(account.availableBalance),
      marginBalanceUsd: signedNumber(account.totalMarginBalance),
      totalInitialMarginUsd: signedNumber(account.totalInitialMargin),
      totalMaintMarginUsd: signedNumber(account.totalMaintMargin),
      totalOpenOrderInitialMarginUsd: signedNumber(account.totalOpenOrderInitialMargin),
      totalPositionInitialMarginUsd: signedNumber(account.totalPositionInitialMargin),
      totalCrossWalletBalanceUsd: signedNumber(account.totalCrossWalletBalance),
      totalUnrealizedPnlUsd: signedNumber(account.totalUnrealizedProfit),
      updatedAt: account.updateTime || now
    },
    positions: activePositions
  };
};

const accountStreamHealth = (): AccountStreamHealth => ({
  enabled: true,
  connected: true,
  credentialSource: "env",
  keyLabel: null,
  message: "SG-008B direct REST snapshot",
  error: null,
  activePositions: [],
  lastSyncAt: Date.now(),
  url: testnetWsBase,
  lastMessageAt: Date.now(),
  reconnectAttempts: 0
});

const buildRow = (price: number): ScreenerRow =>
  ({
    symbol,
    markPrice: price,
    lastPrice: price
  }) as ScreenerRow;

const buildMinimalOrderPlan = (
  filters: BinanceSymbolFilters,
  price: number
): MinimalOrderPlan | null => {
  const side = (readEnv("SG008B_ORDER_SIDE")?.toUpperCase() === "SELL" ? "SELL" : "BUY") as OrderSide;
  const closeSide = side === "BUY" ? "SELL" : "BUY";
  const stepSize = filters.stepSize ?? 0.001;
  const minQty = filters.minQty ?? stepSize;
  const minNotional = Math.max(filters.minNotional ?? 0, 5);
  const rawQty = Math.max(minQty, ceilToStep(minNotional / price, stepSize));
  const quantity = normalizeQuantity(symbol, rawQty, new Map([[symbol, filters]])).quantity;
  const notional = quantity * price;

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(notional) || notional <= 0) {
    return null;
  }

  return {
    symbol,
    side,
    closeSide,
    type: "MARKET",
    quantity,
    price,
    notional,
    filters
  };
};

const waitFor = async <T>(
  fn: () => Promise<T | null> | T | null,
  timeoutMs = waitTimeoutMs
): Promise<T | null> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const result = await fn();
    if (result !== null) {
      return result;
    }
    await sleep(waitIntervalMs);
  }

  return null;
};

const buildSafeToAdd = (
  plan: Pick<MinimalOrderPlan, "symbol" | "side">,
  validation: OrderValidationPayload
): SafeToAddResult =>
  buildSafeToAddResult({
    symbol: plan.symbol,
    direction: plan.side === "BUY" ? "long" : "short",
    side: plan.side,
    generatedAt: Date.now(),
    checks: validation.checks
  });

const countActivePositions = (positions: RestPositionRiskV3[]): number =>
  positions.filter((position) => Math.abs(signedNumber(position.positionAmt)) > 0).length;

const findSymbolPositionAmt = (positions: RestPositionRiskV3[]): number =>
  positions
    .filter((position) => position.symbol === symbol)
    .reduce((sum, position) => sum + signedNumber(position.positionAmt), 0);

const countDecisionReviewsForLifecycle = (lifecycleId: string): number => {
  const row = getSqlite()
    .prepare("SELECT COUNT(*) AS count FROM decision_reviews WHERE position_lifecycle_id = ?")
    .get(lifecycleId) as { count: number } | undefined;

  return row?.count ?? 0;
};

const cleanupTestnetExposure = async (input: {
  restBase: string;
  apiKey: string;
  apiSecret: string;
  filters: BinanceSymbolFilters | null;
  secrets: Array<string | null | undefined>;
  sections: SmokeSection[];
}): Promise<void> => {
  try {
    const [openOrders, positions] = await Promise.all([
      getOpenOrders(input.restBase, input.apiKey, input.apiSecret, symbol),
      getPositionRisk(input.restBase, input.apiKey, input.apiSecret)
    ]);

    for (const order of openOrders) {
      await cancelFuturesOrder(input.restBase, input.apiKey, input.apiSecret, {
        symbol,
        origClientOrderId: order.clientOrderId
      });
    }

    const positionAmt = findSymbolPositionAmt(positions);
    if (Math.abs(positionAmt) > 0 && input.filters) {
      const quantity = normalizeQuantity(
        symbol,
        Math.abs(positionAmt),
        new Map([[symbol, input.filters]])
      ).quantity;

      if (quantity > 0) {
        await placeFuturesOrder(input.restBase, input.apiKey, input.apiSecret, {
          symbol,
          side: positionAmt > 0 ? "SELL" : "BUY",
          type: "MARKET",
          quantity,
          reduceOnly: true,
          newClientOrderId: `${stagePrefix}-cleanup-${Date.now()}`
        });
      }
    }

    addSection(input.sections, "Emergency cleanup", "PASS", {
      canceledOpenOrders: openOrders.length,
      closedPositionAttempted: Math.abs(positionAmt) > 0
    });
  } catch (error) {
    addSection(
      input.sections,
      "Emergency cleanup",
      "FAIL",
      errorDetail(error, input.secrets),
      "Cleanup failed after SG-008B smoke encountered an error."
    );
  }
};

const printReport = (sections: SmokeSection[]): void => {
  const firstBlocker = sections.find((section) => section.status === "FAIL")?.blocker ?? null;
  const overall = sections.every((section) => section.status === "PASS") ? "PASS" : "FAIL";

  console.log("## SG-008B Full Testnet Lifecycle Smoke");
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

  if (overall === "FAIL") {
    process.exitCode = 1;
  }
};

const run = async (): Promise<void> => {
  const sections: SmokeSection[] = [];
  const restBase = readEnv("BINANCE_REST_BASE") ?? testnetRestBase;
  const wsBase = readEnv("BINANCE_WS_BASE") ?? testnetWsBase;
  const apiKey = readEnv("BINANCE_API_KEY");
  const apiSecret = readEnv("BINANCE_API_SECRET");
  const orderControlToken = readEnv("ORDER_CONTROL_TOKEN");
  const secrets = [apiKey, apiSecret, orderControlToken];
  let filters: BinanceSymbolFilters | null = null;
  let openedExposure = false;

  const readiness = evaluateLiveReadiness({
    liveTradingEnabled: true,
    orderLiveModeEnabled: true,
    paperModeDefault: true,
    liveTradingRequiresTestnet: true,
    liveTradingRequireTypedConfirm: true,
    binanceFuturesTestnet: true,
    restBase,
    wsBase,
    orderControlAuthRequired: true,
    orderControlToken: orderControlToken ?? "sg008b-local-harness-token",
    apiKey,
    apiSecret,
    liveTradingKillSwitchEnabled: false,
    runtimeKillSwitchActive: false,
    liveRiskLimits: buildLiveRiskLimits()
  });
  const environmentDiagnostics = summarizeBinanceEnvironmentDiagnostics(readiness.environment);

  addSection(
    sections,
    "Environment classification",
    readiness.environment.restEnvironment === "TESTNET" &&
      readiness.environment.wsEnvironment === "TESTNET"
      ? "PASS"
      : "FAIL",
    {
      ...environmentDiagnostics,
      liveTradingEnvMutated: false,
      liveEndpointTouched: false
    },
    readiness.environment.restEnvironment !== "TESTNET"
      ? "BINANCE_REST_BASE is not Binance Futures TESTNET."
      : readiness.environment.wsEnvironment !== "TESTNET"
        ? "BINANCE_WS_BASE is not Binance Futures TESTNET."
        : null
  );

  addSection(
    sections,
    "Credential presence",
    apiKey && apiSecret ? "PASS" : "FAIL",
    {
      apiKey: apiKey ? "<configured>" : "<missing>",
      apiSecret: apiSecret ? "<configured>" : "<missing>",
      printedSecrets: false
    },
    !apiKey || !apiSecret ? "BINANCE_API_KEY and BINANCE_API_SECRET are required." : null
  );

  const confirm = readEnv("SG008B_TESTNET_ORDER_CONFIRM");
  addSection(
    sections,
    "Mutating testnet confirmation",
    confirm === "TESTNET" ? "PASS" : "FAIL",
    {
      required: "SG008B_TESTNET_ORDER_CONFIRM=TESTNET",
      configured: confirm ? "<configured>" : "<missing>"
    },
    confirm === "TESTNET"
      ? null
      : "Set SG008B_TESTNET_ORDER_CONFIRM=TESTNET to allow a mutating TESTNET-only smoke."
  );

  if (sections.some((section) => section.status === "FAIL") || !apiKey || !apiSecret) {
    printReport(sections);
    return;
  }

  try {
    const [initialAccount, initialPositions, exchangeFilters, initialOpenOrders] =
      await Promise.all([
        fetchFuturesAccountSnapshot(restBase, apiKey, apiSecret),
        fetchPositionRiskSnapshot(restBase, apiKey, apiSecret),
        getExchangeFilterMap(restBase),
        getOpenOrders(restBase, apiKey, apiSecret, symbol)
      ]);
    filters = getSymbolFilters(symbol, exchangeFilters);
    const initialPositionAmt = findSymbolPositionAmt(initialPositions);
    const priceEvidence = await resolveMarkPrice(restBase, initialPositions);
    const price = priceEvidence?.price ?? null;

    addSection(
      sections,
      "Initial account cleanliness",
      initialOpenOrders.length === 0 && Math.abs(initialPositionAmt) === 0 ? "PASS" : "FAIL",
      {
        symbol,
        btcOpenOrders: initialOpenOrders.length,
        btcPositionAmt: initialPositionAmt,
        accountPositionCount: countActivePositions(initialPositions)
      },
      initialOpenOrders.length > 0
        ? "BTCUSDT has pre-existing open TESTNET orders."
        : Math.abs(initialPositionAmt) !== 0
          ? "BTCUSDT has a pre-existing TESTNET position."
          : null
    );

    addSection(
      sections,
      "Exchange filters and mark price",
      filters && price ? "PASS" : "FAIL",
      {
        symbol,
        markPrice: price,
        markPriceSource: priceEvidence?.source ?? null,
        markPriceEndpoint: priceEvidence?.endpoint ?? null,
        minQty: filters?.minQty ?? null,
        stepSize: filters?.stepSize ?? null,
        minNotional: filters?.minNotional ?? null
      },
      !filters ? "BTCUSDT filters were not found." : !price ? "BTCUSDT mark price was unavailable." : null
    );

    if (sections.some((section) => section.status === "FAIL") || !filters || !price) {
      printReport(sections);
      return;
    }

    const plan = buildMinimalOrderPlan(filters, price);
    addSection(
      sections,
      "Minimal order plan",
      plan ? "PASS" : "FAIL",
      plan
        ? {
            symbol: plan.symbol,
            side: plan.side,
            type: plan.type,
            quantity: plan.quantity,
            notional: plan.notional,
            closeSide: plan.closeSide
          }
        : { symbol },
      plan ? null : "Could not build a valid minimal BTCUSDT order plan."
    );

    if (!plan) {
      printReport(sections);
      return;
    }

    const serviceMessages: unknown[] = [];
    const orderService = new BinanceOrderService(restBase, {
      defaultPaperMode: true,
      liveModeEnabled: true,
      liveTradingEnabled: true,
      liveTradingRequiresTestnet: true,
      liveTradingRequireTypedConfirm: true,
      liveTradingKillSwitchEnabled: false,
      binanceFuturesTestnet: true,
      apiKey,
      apiSecret,
      restBase,
      wsBase,
      orderControlAuthRequired: true,
      orderControlToken: orderControlToken ?? "sg008b-local-harness-token",
      skipStartupRecovery: true,
      liveRiskLimits: buildLiveRiskLimits(),
      onMessage: (message) => {
        serviceMessages.push(message);
      }
    });

    const createdAt = Date.now();
    const signal: UnifiedSignalEvent = {
      id: `${stagePrefix}-signal-${createdAt}-${randomUUID()}`,
      source: "alert",
      sourceId: `${stagePrefix}-source-${createdAt}`,
      symbol,
      kind: "testnet_lifecycle_smoke",
      bias: plan.side === "BUY" ? "LONG" : "SHORT",
      direction: plan.side === "BUY" ? "long" : "short",
      title: "SG-008B BTCUSDT testnet lifecycle proof",
      description: "Synthetic persisted signal for SG-008B full testnet lifecycle smoke.",
      severity: "info",
      priority: "HIGH",
      rankScore: 100,
      suppress: false,
      ttlSec: 300,
      tags: ["sg008b", "testnet", "lifecycle"],
      liveVisibility: "REVIEW",
      noiseClass: "ACTIONABLE",
      createdAt,
      expiresAt: createdAt + 300_000,
      mergeKey: `${stagePrefix}:${createdAt}`,
      rawRef: {
        collection: "alerts",
        id: `${stagePrefix}-raw-${createdAt}`
      }
    };
    unifiedSignalRepository.upsertUnifiedSignal(signal);

    const decisionContext = decisionContextFixtureFactory.createFinalContext({
      id: `${stagePrefix}-decision-${createdAt}-${randomUUID()}`,
      unifiedSignalId: signal.id,
      symbol,
      decision: "ENTER",
      decisionReason: "SG-008B deterministic testnet lifecycle proof.",
      riskSnapshotRef: "sg008b-testnet-smoke",
      reviewCorrelationId: `${stagePrefix}-review-${createdAt}`,
      source: "system",
      status: "committed",
      createdAt,
      payload: {
        harness: "SG-008B",
        side: plan.side,
        quantity: plan.quantity,
        notional: plan.notional
      }
    });

    addSection(sections, "Stage 1-2 signal and decision context", "PASS", {
      unifiedSignalId: signal.id,
      decisionContextId: decisionContext.id,
      decision: decisionContext.decision,
      symbol: decisionContext.symbol,
      createdAt: decisionContext.createdAt
    });

    const account = accountSnapshotFromRest(initialAccount, initialPositions);
    const row = buildRow(plan.price);
    const preflightRequestId = `${stagePrefix}-preflight-${createdAt}`;
    const preflightPayload: RequestOrderPreflightMessage["payload"] = {
      requestId: preflightRequestId,
      ticketKey: `${stagePrefix}:${createdAt}:entry`,
      createdAt,
      symbol,
      side: plan.side,
      type: plan.type,
      quantity: plan.quantity,
      price: null,
      stopPrice: null,
      reduceOnly: false,
      paperMode: false,
      mode: "TESTNET_LIVE" as const
    };
    const validation = await orderService.validateOrderPreflight(preflightPayload, {
      account,
      accountStream: accountStreamHealth(),
      row
    });
    const safeToAdd = buildSafeToAdd(plan, validation);
    const preflightId = randomUUID();
    const preflightNonce = randomUUID();
    const preflightExpiresAt = Date.now() + safeToAdd.staleAfterMs;
    orderService.bindPreflight({
      preflightId,
      preflightNonce,
      requestId: preflightPayload.requestId,
      ticketKey: preflightPayload.ticketKey ?? `${stagePrefix}:${createdAt}:entry`,
      paperMode: false,
      generatedAt: Date.now(),
      expiresAt: preflightExpiresAt,
      safeToAddStatus: safeToAdd.status,
      payload: preflightPayload
    });

    addSection(
      sections,
      "Stage 3 fresh preflight",
      validation.accepted && safeToAdd.status === "ALLOW" ? "PASS" : "FAIL",
      {
        requestId: preflightRequestId,
        preflightId,
        safeToAdd: safeToAdd.status,
        accepted: validation.accepted,
        expiresAt: preflightExpiresAt,
        failedChecks: validation.checks
          .filter((check) => check.blocking && !check.passed)
          .map((check) => ({ code: check.code, message: check.message }))
      },
      validation.accepted && safeToAdd.status === "ALLOW"
        ? null
        : "Entry preflight was not accepted with Safe-To-Add ALLOW."
    );

    if (sections.some((section) => section.status === "FAIL")) {
      printReport(sections);
      return;
    }

    const entryIntentId = `${stagePrefix}-entry-${createdAt}-${randomUUID()}`;
    const entryClientOrderId = `${stagePrefix}-entry-${createdAt}`.slice(0, 36);
    const entryIntent: OrderIntentMessage["payload"] = {
      intentId: entryIntentId,
      createdAt: Date.now(),
      action: "PLACE_ORDER",
      symbol,
      side: plan.side,
      orderType: plan.type,
      quantity: plan.quantity,
      price: null,
      stopPrice: null,
      clientOrderId: entryClientOrderId,
      reduceOnly: false,
      paperMode: false,
      preflightId,
      preflightNonce,
      unifiedSignalId: signal.id,
      decisionContextId: decisionContext.id,
      reviewCorrelationId: decisionContext.reviewCorrelationId ?? null,
      confirmText: "LIVE",
      controlToken: orderControlToken ?? "sg008b-local-harness-token",
      sourceWindowId: "sg008b-testnet-lifecycle-smoke"
    };

    await orderService.handleIntent(entryIntent, {
      account,
      accountStream: accountStreamHealth(),
      row
    });
    openedExposure = true;

    const preSubmitAudit = orderRepository.findOrderAuditEventByIntentIdAndType<{
      preSubmitIntentPersisted?: boolean;
      preSubmitIntentPersistedAt?: number;
      canonicalIntentOrderId?: string;
      clientOrderId?: string;
    }>(
      entryIntentId,
      "LIVE_TESTNET_ORDER_INTENT_SUBMITTED"
    );
    const sendAudit = orderRepository.findOrderAuditEventByIntentIdAndType<{
      preSubmitIntentPersisted?: boolean;
      preSubmitIntentPersistedAt?: number;
      submitAttemptedAt?: number;
      persistedBeforeSubmit?: boolean;
    }>(entryIntentId, "LIVE_TESTNET_ORDER_SEND");
    const entryOrderAfterSubmit = orderRepository.getOrderByClientOrderId(entryClientOrderId);
    const preSubmitIntentPersisted = preSubmitAudit?.payload?.preSubmitIntentPersisted === true;
    const preSubmitIntentPersistedAt =
      typeof preSubmitAudit?.payload?.preSubmitIntentPersistedAt === "number"
        ? preSubmitAudit.payload.preSubmitIntentPersistedAt
        : preSubmitAudit?.timestamp ?? null;
    const submitAttemptedAt =
      typeof sendAudit?.payload?.submitAttemptedAt === "number"
        ? sendAudit.payload.submitAttemptedAt
        : sendAudit?.timestamp ?? null;
    const persistedBeforeSubmit =
      preSubmitIntentPersistedAt !== null &&
      submitAttemptedAt !== null &&
      preSubmitIntentPersistedAt <= submitAttemptedAt &&
      sendAudit?.payload?.persistedBeforeSubmit === true;

    addSection(
      sections,
      "Stage 4 durable pre-submit persistence",
      preSubmitAudit &&
        sendAudit &&
        entryOrderAfterSubmit &&
        preSubmitIntentPersisted &&
        persistedBeforeSubmit
        ? "PASS"
        : "FAIL",
      {
        orderIntentId: entryIntentId,
        orderId: entryOrderAfterSubmit?.orderId ?? null,
        clientOrderId: entryClientOrderId,
        auditType: preSubmitAudit?.eventType ?? null,
        auditTimestamp: preSubmitAudit?.timestamp ?? null,
        preSubmitIntentPersisted,
        preSubmitIntentPersistedAt,
        submitAttemptedAt,
        persistedBeforeSubmit,
        submitBeforeDurableIntent: !persistedBeforeSubmit
      },
      preSubmitAudit &&
        sendAudit &&
        entryOrderAfterSubmit &&
        preSubmitIntentPersisted &&
        persistedBeforeSubmit
        ? null
        : "Strict pre-submit OrderIntent durability evidence was missing or after submit."
    );

    const entryOrder = await waitFor(async () => {
      await orderService.reconcileLiveTestnetOrderByClientOrderId(entryClientOrderId);
      return orderRepository.getOrderByClientOrderId(entryClientOrderId);
    });

    addSection(
      sections,
      "Stage 5 exchange ack",
      entryOrder?.exchangeOrderId ? "PASS" : "FAIL",
      {
        endpointClassification: environmentDiagnostics.restBaseClassification,
        orderId: entryOrder?.exchangeOrderId ?? null,
        clientOrderId: entryOrder?.clientOrderId ?? entryClientOrderId,
        status: entryOrder?.status ?? null,
        liveEndpointTouched: false
      },
      entryOrder?.exchangeOrderId ? null : "No authoritative exchange order id was captured."
    );

    const exchangeEntryOrder = entryOrder
      ? await getFuturesOrder(restBase, apiKey, apiSecret, {
          symbol,
          origClientOrderId: entryClientOrderId
        })
      : null;
    const localEntryOrder = orderRepository.getOrderByClientOrderId(entryClientOrderId);

    addSection(
      sections,
      "Stage 6 exchange reconciliation",
      localEntryOrder &&
        exchangeEntryOrder &&
        localEntryOrder.exchangeOrderId === String(exchangeEntryOrder.orderId) &&
        localEntryOrder.status === exchangeEntryOrder.status
        ? "PASS"
        : "FAIL",
      {
        localStatus: localEntryOrder?.status ?? null,
        exchangeStatus: exchangeEntryOrder?.status ?? null,
        localExchangeOrderId: localEntryOrder?.exchangeOrderId ?? null,
        exchangeOrderId: exchangeEntryOrder?.orderId ?? null
      },
      localEntryOrder &&
        exchangeEntryOrder &&
        localEntryOrder.exchangeOrderId === String(exchangeEntryOrder.orderId) &&
        localEntryOrder.status === exchangeEntryOrder.status
        ? null
        : "Local order state does not match exchange order state."
    );

    const lifecycle = await waitFor(() =>
      positionLifecycleRepository.getPositionLifecycleByOrderIntentId(entryIntentId)
    );

    addSection(
      sections,
      "Stage 7 lifecycle open",
      lifecycle?.status === "OPEN" ? "PASS" : "FAIL",
      {
        lifecycleId: lifecycle?.id ?? null,
        status: lifecycle?.status ?? null,
        decisionContextId: lifecycle?.decisionContextId ?? null,
        orderIntentId: lifecycle?.orderIntentId ?? null,
        unifiedSignalId: lifecycle?.unifiedSignalId ?? null
      },
      lifecycle?.status === "OPEN" ? null : "PositionLifecycle OPEN was not created."
    );

    if (sections.some((section) => section.status === "FAIL") || !lifecycle) {
      await cleanupTestnetExposure({ restBase, apiKey, apiSecret, filters, secrets, sections });
      printReport(sections);
      return;
    }

    const openPosition = await waitFor(async () => {
      const positions = await getPositionRisk(restBase, apiKey, apiSecret);
      const amount = findSymbolPositionAmt(positions);
      return Math.abs(amount) > 0 ? { positions, amount } : null;
    });
    const closeQuantity = normalizeQuantity(
      symbol,
      Math.abs(openPosition?.amount ?? plan.quantity),
      new Map([[symbol, filters]])
    ).quantity;
    const closeSide: OrderSide =
      (openPosition?.amount ?? (plan.side === "BUY" ? 1 : -1)) > 0 ? "SELL" : "BUY";
    const closeAccountRest = await fetchFuturesAccountSnapshot(restBase, apiKey, apiSecret);
    const closePositionsRest = await fetchPositionRiskSnapshot(restBase, apiKey, apiSecret);
    const closeAccount = accountSnapshotFromRest(closeAccountRest, closePositionsRest);
    const closeCreatedAt = Date.now();
    const closePreflightPayload: RequestOrderPreflightMessage["payload"] = {
      requestId: `${stagePrefix}-close-preflight-${closeCreatedAt}`,
      ticketKey: `${stagePrefix}:${createdAt}:close`,
      createdAt: closeCreatedAt,
      symbol,
      side: closeSide,
      type: "MARKET" as const,
      quantity: closeQuantity,
      price: null,
      stopPrice: null,
      reduceOnly: true,
      paperMode: false,
      mode: "TESTNET_LIVE" as const
    };
    const closeValidation = await orderService.validateOrderPreflight(closePreflightPayload, {
      account: closeAccount,
      accountStream: accountStreamHealth(),
      row
    });
    const closeSafeToAdd = buildSafeToAdd(
      {
        symbol,
        side: closeSide
      },
      closeValidation
    );
    const closePreflightId = randomUUID();
    const closePreflightNonce = randomUUID();
    orderService.bindPreflight({
      preflightId: closePreflightId,
      preflightNonce: closePreflightNonce,
      requestId: closePreflightPayload.requestId,
      ticketKey: closePreflightPayload.ticketKey ?? `${stagePrefix}:${createdAt}:close`,
      paperMode: false,
      generatedAt: Date.now(),
      expiresAt: Date.now() + closeSafeToAdd.staleAfterMs,
      safeToAddStatus: closeSafeToAdd.status,
      payload: closePreflightPayload
    });

    const closeIntentId = `${stagePrefix}-close-${closeCreatedAt}-${randomUUID()}`;
    const closeClientOrderId = `${stagePrefix}-close-${closeCreatedAt}`.slice(0, 36);
    const closeIntent: OrderIntentMessage["payload"] = {
      intentId: closeIntentId,
      createdAt: Date.now(),
      action: "PLACE_ORDER",
      symbol,
      side: closeSide,
      orderType: "MARKET",
      quantity: closeQuantity,
      price: null,
      stopPrice: null,
      clientOrderId: closeClientOrderId,
      reduceOnly: true,
      paperMode: false,
      preflightId: closePreflightId,
      preflightNonce: closePreflightNonce,
      unifiedSignalId: signal.id,
      decisionContextId: decisionContext.id,
      reviewCorrelationId: decisionContext.reviewCorrelationId ?? null,
      confirmText: "LIVE",
      controlToken: orderControlToken ?? "sg008b-local-harness-token",
      sourceWindowId: "sg008b-testnet-lifecycle-smoke"
    };

    await orderService.handleIntent(closeIntent, {
      account: closeAccount,
      accountStream: accountStreamHealth(),
      row
    });
    const closeOrder = await waitFor(async () => {
      await orderService.reconcileLiveTestnetOrderByClientOrderId(closeClientOrderId);
      return orderRepository.getOrderByClientOrderId(closeClientOrderId);
    });
    const reduceOnlyEvents = positionLifecycleRepository
      .listLifecycleEvents(lifecycle.id)
      .filter((event) => {
        const payload = event.payload;
        return (
          typeof payload === "object" &&
          payload !== null &&
          !Array.isArray(payload) &&
          (payload as Record<string, unknown>).closeClientOrderId === closeClientOrderId
        );
      });

    addSection(
      sections,
      "Stage 8 reduce-only close",
      closeOrder?.exchangeOrderId && closeOrder.reduceOnly && reduceOnlyEvents.length > 0
        ? "PASS"
        : "FAIL",
      {
        closeIntentId,
        closeOrderId: closeOrder?.exchangeOrderId ?? null,
        closeClientOrderId,
        reduceOnly: closeOrder?.reduceOnly ?? null,
        closeStatus: closeOrder?.status ?? null,
        lifecycleEventLinked: reduceOnlyEvents.length > 0
      },
      closeOrder?.exchangeOrderId && closeOrder.reduceOnly && reduceOnlyEvents.length > 0
        ? null
        : "Reduce-only close order was not linked to lifecycle evidence."
    );

    await waitFor(async () => {
      const positions = await getPositionRisk(restBase, apiKey, apiSecret);
      return Math.abs(findSymbolPositionAmt(positions)) === 0 ? true : null;
    });
    await orderService.runLivePositionLifecycleRecoveryAudit();
    const closedLifecycle = await waitFor(() =>
      positionLifecycleRepository.getPositionLifecycleById(lifecycle.id)
    );

    addSection(
      sections,
      "Stage 9 lifecycle closed",
      closedLifecycle?.status === "CLOSED" && closedLifecycle.closedAt !== null ? "PASS" : "FAIL",
      {
        lifecycleId: closedLifecycle?.id ?? lifecycle.id,
        status: closedLifecycle?.status ?? null,
        closedAt: closedLifecycle?.closedAt ?? null
      },
      closedLifecycle?.status === "CLOSED" && closedLifecycle.closedAt !== null
        ? null
        : "PositionLifecycle was not CLOSED after reduce-only close."
    );

    const review = decisionReviewRepository.getDecisionReviewByLifecycleId(lifecycle.id);
    const reviewCount = countDecisionReviewsForLifecycle(lifecycle.id);

    addSection(
      sections,
      "Stage 10 decision review",
      review && reviewCount === 1 ? "PASS" : "FAIL",
      {
        reviewId: review?.id ?? null,
        lifecycleId: lifecycle.id,
        reviewCount
      },
      review
        ? reviewCount === 1
          ? null
          : "Duplicate DecisionReviewObject rows exist for the lifecycle."
        : "DecisionReviewObject was not created."
    );

    const replay = review
      ? buildDecisionReplay({ reviewId: review.id })
      : buildDecisionReplay({ positionLifecycleId: lifecycle.id });

    addSection(
      sections,
      "Stage 11 replay reconstruction",
      replay.summary.missingLinks.length === 0 ? "PASS" : "FAIL",
      {
        reviewId: replay.reviewId ?? null,
        positionLifecycleId: replay.positionLifecycleId ?? null,
        signalPresent: replay.summary.signalPresent,
        decisionPresent: replay.summary.decisionPresent,
        orderPresent: replay.summary.orderPresent,
        lifecyclePresent: replay.summary.lifecyclePresent,
        reviewPresent: replay.summary.reviewPresent,
        missingLinks: replay.summary.missingLinks,
        missingLinksCount: replay.summary.missingLinks.length
      },
      replay.summary.missingLinks.length === 0 ? null : "Replay reconstruction has missing links."
    );

    const [finalPositions, finalOpenOrders] = await Promise.all([
      getPositionRisk(restBase, apiKey, apiSecret),
      getOpenOrders(restBase, apiKey, apiSecret, symbol)
    ]);
    const finalPositionCount = countActivePositions(finalPositions);
    const finalBtcPositionAmt = findSymbolPositionAmt(finalPositions);
    const finalLifecycle = positionLifecycleRepository.getPositionLifecycleById(lifecycle.id);
    const finalReviewCount = countDecisionReviewsForLifecycle(lifecycle.id);

    addSection(
      sections,
      "Stage 12 cleanup",
      finalOpenOrders.length === 0 &&
        finalPositionCount === 0 &&
        Math.abs(finalBtcPositionAmt) === 0 &&
        finalLifecycle?.status === "CLOSED" &&
        finalReviewCount === 1
        ? "PASS"
        : "FAIL",
      {
        positionCount: finalPositionCount,
        btcPositionAmt: finalBtcPositionAmt,
        openOrders: finalOpenOrders.length,
        lifecycleStatus: finalLifecycle?.status ?? null,
        reviewCount: finalReviewCount,
        duplicateReview: finalReviewCount > 1,
        serviceMessages: serviceMessages.length
      },
      finalOpenOrders.length > 0
        ? "Open BTCUSDT order remains after SG-008B smoke."
        : finalPositionCount > 0 || Math.abs(finalBtcPositionAmt) > 0
          ? "Open TESTNET position remains after SG-008B smoke."
          : finalLifecycle?.status !== "CLOSED"
            ? "Lifecycle is not closed after cleanup."
            : finalReviewCount !== 1
              ? "Review cleanup/idempotency proof failed."
              : null
    );

    openedExposure = false;
    orderService.dispose();
    printReport(sections);
  } catch (error) {
    if (openedExposure && apiKey && apiSecret) {
      await cleanupTestnetExposure({ restBase, apiKey, apiSecret, filters, secrets, sections });
    }
    addSection(
      sections,
      "Unhandled SG-008B error",
      "FAIL",
      errorDetail(error, secrets),
      "SG-008B testnet lifecycle smoke failed unexpectedly."
    );
    printReport(sections);
  }
};

void run();
