import {
  getExchangeFilterMap,
  getSymbolFilters,
  normalizePrice,
  normalizeQuantity,
  validateNotional,
  type BinanceSymbolFilters
} from "../services/binance-exchange-filters";
import {
  BinanceApiError,
  fetchFuturesAccountSnapshot,
  fetchPositionRiskSnapshot,
  getCachedLeverageBrackets
} from "../services/binance-rest";
import { evaluateLiveReadiness, type LiveReadinessInput } from "./live-readiness";
import { buildSafeToAddResult, evaluateOrderRiskSafety } from "./order-safety";
import type {
  OrderSide,
  OrderType,
  OrderValidationCheck,
  SafeToAddResult
} from "../types/messages";
import type {
  RestFuturesAccountV3,
  RestPositionRiskV3
} from "../types/binance";

type SmokeSectionStatus = "PASS" | "FAIL";
type FinalPreflightStatus = "ACCEPTED" | "BLOCKED" | "WAIT";
type LiveRiskLimits = NonNullable<LiveReadinessInput["liveRiskLimits"]>;
type PriceSource = "positionRisk markPrice" | "premiumIndex markPrice" | "ticker price";

interface SmokeSection {
  name: string;
  status: SmokeSectionStatus;
  detail: Record<string, unknown>;
  blocker: string | null;
}

interface MinimalOrderPlan {
  symbol: "BTCUSDT";
  side: OrderSide;
  type: Extract<OrderType, "MARKET">;
  quantity: number;
  quantitySource: string;
  marketPrice: number;
  marketPriceSource: PriceSource;
  marketPriceEndpoint: string | null;
  normalizedQuantity: number;
  normalizedPrice: number | null;
  notional: number;
  filters: BinanceSymbolFilters;
}

interface PriceEvidence {
  source: PriceSource;
  price: number;
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

const testnetRestBase = "https://testnet.binancefuture.com";
const testnetWsBase = "wss://stream.binancefuture.com";
const symbol = "BTCUSDT";

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

const addSection = (
  sections: SmokeSection[],
  name: string,
  status: SmokeSectionStatus,
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

const buildLiveRiskLimits = (): LiveRiskLimits => ({
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

const positiveNumber = (value: string | number | null | undefined): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const signedNumber = (value: string | number | null | undefined): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const selectOrderSide = (): { side: OrderSide; source: string; error: string | null } => {
  const raw = readEnv("SG008_ORDER_SIDE");
  if (!raw) {
    return { side: "BUY", source: "default BUY", error: null };
  }

  const normalized = raw.toUpperCase();
  if (normalized === "BUY" || normalized === "SELL") {
    return { side: normalized, source: "SG008_ORDER_SIDE", error: null };
  }

  return {
    side: "BUY",
    source: "invalid SG008_ORDER_SIDE",
    error: "SG008_ORDER_SIDE must be BUY or SELL."
  };
};

const findSymbolMarkPrice = (positions: RestPositionRiskV3[]): number | null => {
  for (const position of positions) {
    if (position.symbol !== symbol) {
      continue;
    }

    const markPrice = positiveNumber(position.markPrice);
    if (markPrice !== null) {
      return markPrice;
    }
  }

  return null;
};

const resolveMarkPrice = async (
  restBase: string,
  positions: RestPositionRiskV3[],
  sections: SmokeSection[]
): Promise<PriceEvidence | null> => {
  const positionRiskMarkPrice = findSymbolMarkPrice(positions);
  if (positionRiskMarkPrice !== null) {
    addSection(sections, "Mark price source", "PASS", {
      symbol,
      selectedSource: "positionRisk markPrice",
      selectedPrice: positionRiskMarkPrice,
      selectedEndpoint: null,
      positionRiskRowPresent: true
    });

    return {
      source: "positionRisk markPrice",
      price: positionRiskMarkPrice,
      endpoint: null
    };
  }

  const premiumIndexEndpoint = "/fapi/v1/premiumIndex";
  const premiumIndexUrl = `${restBase}${premiumIndexEndpoint}?symbol=${encodeURIComponent(symbol)}`;
  let premiumIndexDetail: Record<string, unknown>;

  try {
    const premiumIndex = await publicJson<PremiumIndexPriceResponse>(premiumIndexUrl);
    const price = positiveNumber(premiumIndex.markPrice);
    premiumIndexDetail = {
      endpoint: premiumIndexEndpoint,
      symbol: premiumIndex.symbol ?? null,
      markPricePresent: price !== null
    };

    if (price !== null) {
      addSection(sections, "Mark price source", "PASS", {
        symbol,
        selectedSource: "premiumIndex markPrice",
        selectedPrice: price,
        selectedEndpoint: premiumIndexEndpoint,
        positionRiskRowPresent: positions.some((position) => position.symbol === symbol),
        premiumIndex: premiumIndexDetail
      });

      return {
        source: "premiumIndex markPrice",
        price,
        endpoint: premiumIndexEndpoint
      };
    }
  } catch (error) {
    premiumIndexDetail = {
      endpoint: premiumIndexEndpoint,
      error: errorDetail(error, [])
    };
  }

  const tickerEndpoint = "/fapi/v1/ticker/price";
  const tickerUrl = `${restBase}${tickerEndpoint}?symbol=${encodeURIComponent(symbol)}`;

  try {
    const ticker = await publicJson<TickerPriceResponse>(tickerUrl);
    const price = positiveNumber(ticker.price);
    const tickerDetail = {
      endpoint: tickerEndpoint,
      symbol: ticker.symbol ?? null,
      pricePresent: price !== null
    };

    if (price !== null) {
      addSection(sections, "Mark price source", "PASS", {
        symbol,
        selectedSource: "ticker price",
        selectedPrice: price,
        selectedEndpoint: tickerEndpoint,
        positionRiskRowPresent: positions.some((position) => position.symbol === symbol),
        premiumIndex: premiumIndexDetail,
        ticker: tickerDetail
      });

      return {
        source: "ticker price",
        price,
        endpoint: tickerEndpoint
      };
    }

    addSection(
      sections,
      "Mark price source",
      "FAIL",
      {
        symbol,
        selectedSource: null,
        positionRiskRowPresent: positions.some((position) => position.symbol === symbol),
        premiumIndex: premiumIndexDetail,
        ticker: tickerDetail
      },
      "BTCUSDT price was unavailable from positionRisk, premiumIndex, and ticker price."
    );
  } catch (error) {
    addSection(
      sections,
      "Mark price source",
      "FAIL",
      {
        symbol,
        selectedSource: null,
        positionRiskRowPresent: positions.some((position) => position.symbol === symbol),
        premiumIndex: premiumIndexDetail,
        ticker: {
          endpoint: tickerEndpoint,
          error: errorDetail(error, [])
        }
      },
      "BTCUSDT price was unavailable from positionRisk, premiumIndex, and ticker price."
    );
  }

  return null;
};

const deriveMinimalQuantity = (
  filters: BinanceSymbolFilters,
  marketPrice: number
): { quantity: number | null; source: string } => {
  const configuredQuantity = toNumberOrNull(readEnv("SG008_ORDER_QUANTITY"));
  if (configuredQuantity !== null) {
    return {
      quantity: configuredQuantity > 0 ? configuredQuantity : null,
      source: "SG008_ORDER_QUANTITY"
    };
  }

  const minQty = filters.minQty ?? filters.stepSize ?? 0;
  const minNotionalQty =
    filters.minNotional !== null && marketPrice > 0
      ? (filters.minNotional * 1.01) / marketPrice
      : 0;
  const rawQuantity = Math.max(minQty, minNotionalQty);
  const quantity = filters.stepSize ? ceilToStep(rawQuantity, filters.stepSize) : rawQuantity;

  return {
    quantity: quantity > 0 ? quantity : null,
    source: "derived from BTCUSDT minQty/minNotional/selected price"
  };
};

const buildMinimalOrderPlan = (
  filters: BinanceSymbolFilters | null,
  priceEvidence: PriceEvidence | null,
  sections: SmokeSection[]
): MinimalOrderPlan | null => {
  if (!filters) {
    addSection(
      sections,
      "Preflight request evaluation",
      "FAIL",
      { symbol },
      "BTCUSDT exchange filters are required before building the minimal order."
    );
    return null;
  }

  const sideSelection = selectOrderSide();
  if (sideSelection.error) {
    addSection(
      sections,
      "Preflight request evaluation",
      "FAIL",
      { symbol, sideSource: sideSelection.source },
      sideSelection.error
    );
    return null;
  }

  if (!priceEvidence) {
    addSection(
      sections,
      "Preflight request evaluation",
      "FAIL",
      { symbol },
      "BTCUSDT price evidence is required before building the minimal order."
    );
    return null;
  }

  const quantityPlan = deriveMinimalQuantity(filters, priceEvidence.price);
  if (quantityPlan.quantity === null) {
    addSection(
      sections,
      "Preflight request evaluation",
      "FAIL",
      { symbol, quantitySource: quantityPlan.source },
      "A positive BTCUSDT quantity could not be derived."
    );
    return null;
  }

  const normalizedQuantity = normalizeQuantity(symbol, quantityPlan.quantity, new Map([[symbol, filters]]));
  const normalizedPrice = normalizePrice(symbol, priceEvidence.price, new Map([[symbol, filters]]));
  const notional = validateNotional(
    symbol,
    normalizedQuantity.quantity,
    priceEvidence.price,
    new Map([[symbol, filters]])
  );

  return {
    symbol,
    side: sideSelection.side,
    type: "MARKET",
    quantity: quantityPlan.quantity,
    quantitySource: quantityPlan.source,
    marketPrice: priceEvidence.price,
    marketPriceSource: priceEvidence.source,
    marketPriceEndpoint: priceEvidence.endpoint,
    normalizedQuantity: normalizedQuantity.quantity,
    normalizedPrice: normalizedPrice.price,
    notional: notional.notional,
    filters
  };
};

const buildPreflightChecks = (input: {
  liveReadinessMode: string;
  account: RestFuturesAccountV3;
  positions: RestPositionRiskV3[];
  plan: MinimalOrderPlan;
  leverage: Awaited<ReturnType<typeof getCachedLeverageBrackets>>;
  liveRiskLimits: LiveRiskLimits;
}): OrderValidationCheck[] => {
  const filterMap = new Map([[symbol, input.plan.filters]]);
  const normalizedQuantity = normalizeQuantity(symbol, input.plan.quantity, filterMap);
  const notional = validateNotional(
    symbol,
    normalizedQuantity.quantity,
    input.plan.marketPrice,
    filterMap
  );
  const currentSymbolPositions = input.positions.filter(
    (position) => position.symbol === symbol && Math.abs(signedNumber(position.positionAmt)) > 0
  );
  const currentSymbolNotional = currentSymbolPositions.reduce((sum, position) => {
    const absoluteNotional = Math.abs(signedNumber(position.notional));
    if (absoluteNotional > 0) {
      return sum + absoluteNotional;
    }

    return sum + Math.abs(signedNumber(position.positionAmt)) * input.plan.marketPrice;
  }, 0);
  const openPositionSymbols = new Set(
    input.positions
      .filter((position) => Math.abs(signedNumber(position.positionAmt)) > 0)
      .map((position) => position.symbol)
  );
  const availableBalanceUsd = positiveNumber(input.account.availableBalance);
  const accountEquityUsd =
    positiveNumber(input.account.totalMarginBalance) ??
    positiveNumber(input.account.totalWalletBalance) ??
    availableBalanceUsd;

  return [
    {
      code: "account_connection",
      passed: true,
      blocking: true,
      message: "Signed testnet account snapshot is accessible."
    },
    {
      code: "execution_mode",
      passed: input.liveReadinessMode === "TESTNET_ONLY",
      blocking: true,
      message:
        input.liveReadinessMode === "TESTNET_ONLY"
          ? "Live readiness mode is TESTNET_ONLY."
          : `Live readiness mode is ${input.liveReadinessMode}.`
    },
    {
      code: "exchange_filters",
      passed: true,
      blocking: true,
      message: "BTCUSDT exchange filters loaded."
    },
    {
      code: "market_price",
      passed: input.plan.marketPrice > 0,
      blocking: true,
      message: `BTCUSDT price is available from ${input.plan.marketPriceSource}.`
    },
    {
      code: "protective_price",
      passed: true,
      blocking: false,
      message: "No protective prices were requested."
    },
    {
      code: "protective_price_relation",
      passed: true,
      blocking: false,
      message: "No protective price relation is required."
    },
    {
      code: "min_qty",
      passed:
        input.plan.filters.minQty === null ||
        normalizedQuantity.quantity >= input.plan.filters.minQty,
      blocking: true,
      message:
        input.plan.filters.minQty === null ||
        normalizedQuantity.quantity >= input.plan.filters.minQty
          ? "Quantity meets BTCUSDT minQty."
          : `Quantity must be at least ${input.plan.filters.minQty}.`
    },
    {
      code: "step_size",
      passed: Math.abs(normalizedQuantity.quantity - input.plan.quantity) < 1e-12,
      blocking: true,
      message:
        Math.abs(normalizedQuantity.quantity - input.plan.quantity) < 1e-12
          ? "Quantity matches BTCUSDT stepSize."
          : `Quantity must align to stepSize; suggested normalized quantity is ${normalizedQuantity.quantity}.`
    },
    {
      code: "tick_size",
      passed: true,
      blocking: false,
      message: "tickSize does not apply to market orders."
    },
    {
      code: "notional",
      passed: notional.valid,
      blocking: true,
      message: notional.valid
        ? `Notional ${notional.notional.toFixed(4)} passes BTCUSDT minimums.`
        : notional.warnings[0] ?? "Notional validation failed."
    },
    ...evaluateOrderRiskSafety({
      paperMode: false,
      reduceOnly: false,
      orderNotional: notional.notional,
      currentSymbolNotional,
      hasCurrentSymbolPosition: currentSymbolPositions.length > 0,
      openPositionsCount: openPositionSymbols.size,
      availableBalanceUsd,
      accountEquityUsd,
      leverageBracket: input.leverage,
      liveRiskLimits: input.liveRiskLimits
    })
  ];
};

const buildFinalStatus = (
  sections: SmokeSection[],
  preflightAccepted: boolean,
  safeToAdd: SafeToAddResult | null
): { status: FinalPreflightStatus; reasons: string[] } => {
  const sectionBlockers = sections
    .filter((section) => section.status === "FAIL")
    .map((section) => section.blocker)
    .filter((blocker): blocker is string => Boolean(blocker));
  const validationBlockers =
    safeToAdd?.checks
      .filter((check) => check.blocking && !check.passed)
      .map((check) => check.message) ?? [];
  const safeToAddBlockers = safeToAdd?.blockers ?? [];
  const safeToAddWarnings = safeToAdd?.warnings ?? [];
  const reasons = Array.from(
    new Set([
      ...sectionBlockers,
      ...validationBlockers,
      ...safeToAddBlockers,
      ...safeToAddWarnings
    ])
  );

  if (sectionBlockers.length > 0 || !preflightAccepted || safeToAdd?.status === "BLOCK") {
    return {
      status: "BLOCKED",
      reasons: reasons.length > 0 ? reasons : ["Preflight smoke is blocked by unknown evidence."]
    };
  }

  if (!safeToAdd || safeToAdd.status === "WAIT" || safeToAdd.status === "STALE") {
    return {
      status: "WAIT",
      reasons: reasons.length > 0 ? reasons : ["Preflight smoke is waiting for fresher or clearer evidence."]
    };
  }

  return {
    status: "ACCEPTED",
    reasons: ["Preflight validation accepted and Safe-To-Add allowed the minimal testnet order."]
  };
};

const printReport = (
  sections: SmokeSection[],
  finalStatus: FinalPreflightStatus,
  finalReasons: string[]
): void => {
  console.log("## SG-008A Testnet Non-Mutating Preflight Smoke");
  console.log(`Final preflight status: ${finalStatus}`);
  console.log(`Reasons: ${finalReasons.join(" | ")}`);
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
  const sections: SmokeSection[] = [];
  const restBase = readEnv("BINANCE_REST_BASE") ?? testnetRestBase;
  const wsBase = readEnv("BINANCE_WS_BASE") ?? testnetWsBase;
  const apiKey = readEnv("BINANCE_API_KEY");
  const apiSecret = readEnv("BINANCE_API_SECRET");
  const orderControlToken = readEnv("ORDER_CONTROL_TOKEN");
  const secrets = [apiKey, apiSecret, orderControlToken];
  const liveRiskLimits = buildLiveRiskLimits();
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
    liveRiskLimits
  };
  const readiness = evaluateLiveReadiness(readinessInput);

  addSection(
    sections,
    "Environment classification",
    readiness.environment.restEnvironment === "TESTNET" &&
      readiness.environment.wsEnvironment === "TESTNET" &&
      readiness.environment.intendedMode === "TESTNET"
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

  addSection(
    sections,
    "Live readiness mode",
    readiness.mode === "TESTNET_ONLY" && readiness.ready ? "PASS" : "FAIL",
    {
      mode: readiness.mode,
      ready: readiness.ready,
      disabledReasons: readiness.disabledReasons.map((reason) => reason.code),
      warnings: readiness.warnings.map((warning) => warning.code)
    },
    readiness.mode !== "TESTNET_ONLY" || !readiness.ready
      ? "Live readiness did not resolve to TESTNET_ONLY."
      : null
  );

  let account: RestFuturesAccountV3 | null = null;
  let positions: RestPositionRiskV3[] | null = null;
  let filters: BinanceSymbolFilters | null = null;
  let leverage: Awaited<ReturnType<typeof getCachedLeverageBrackets>> | null = null;
  let priceEvidence: PriceEvidence | null = null;
  let preflightAccepted = false;
  let safeToAdd: SafeToAddResult | null = null;

  if (apiKey && apiSecret) {
    try {
      account = await fetchFuturesAccountSnapshot(restBase, apiKey, apiSecret);
      addSection(sections, "Account snapshot access", "PASS", {
        canTrade: account.canTrade,
        assetCount: account.assets.length,
        availableBalancePresent: account.availableBalance.trim().length > 0,
        updateTimeType: typeof account.updateTime
      });
    } catch (error) {
      addSection(
        sections,
        "Account snapshot access",
        "FAIL",
        errorDetail(error, secrets),
        "Signed account snapshot request failed."
      );
    }

    try {
      positions = await fetchPositionRiskSnapshot(restBase, apiKey, apiSecret);
      addSection(sections, "Position snapshot access", "PASS", {
        positionCount: positions.length,
        btcusdtPresent: positions.some((position) => position.symbol === symbol),
        btcusdtMarkPricePresent: findSymbolMarkPrice(positions) !== null
      });
    } catch (error) {
      addSection(
        sections,
        "Position snapshot access",
        "FAIL",
        errorDetail(error, secrets),
        "Signed position risk snapshot request failed."
      );
    }

    try {
      leverage = await getCachedLeverageBrackets(restBase, apiKey, apiSecret, symbol, 0);
      addSection(
        sections,
        "Leverage bracket retrieval",
        leverage.status === "AUTHORITATIVE" && leverage.brackets.length > 0 ? "PASS" : "FAIL",
        {
          symbol,
          status: leverage.status,
          bracketCount: leverage.brackets.length,
          fetchedAt: leverage.fetchedAt,
          error: leverage.error ? redact(leverage.error, secrets) : null
        },
        leverage.status === "AUTHORITATIVE" && leverage.brackets.length > 0
          ? null
          : "BTCUSDT leverage bracket source did not return authoritative data."
      );
    } catch (error) {
      addSection(
        sections,
        "Leverage bracket retrieval",
        "FAIL",
        errorDetail(error, secrets),
        "BTCUSDT leverage bracket retrieval failed."
      );
    }
  } else {
    addSection(sections, "Account snapshot access", "FAIL", {}, "Missing credentials.");
    addSection(sections, "Position snapshot access", "FAIL", {}, "Missing credentials.");
    addSection(sections, "Leverage bracket retrieval", "FAIL", { symbol }, "Missing credentials.");
  }

  if (positions && readiness.environment.restEnvironment === "TESTNET") {
    priceEvidence = await resolveMarkPrice(restBase, positions, sections);
  } else if (positions) {
    addSection(
      sections,
      "Mark price source",
      "FAIL",
      {
        symbol,
        restEnvironment: readiness.environment.restEnvironment
      },
      "Public price fallback requires a configured Binance Futures testnet REST environment."
    );
  } else {
    addSection(
      sections,
      "Mark price source",
      "FAIL",
      { symbol },
      "Signed position snapshot is required before resolving BTCUSDT price evidence."
    );
  }

  try {
    const filterMap = await getExchangeFilterMap(restBase);
    filters = getSymbolFilters(symbol, filterMap);
    addSection(
      sections,
      "Exchange filters",
      filters ? "PASS" : "FAIL",
      {
        symbol,
        filterCount: filterMap.size,
        pricePrecision: filters?.pricePrecision ?? null,
        quantityPrecision: filters?.quantityPrecision ?? null,
        tickSize: filters?.tickSize ?? null,
        stepSize: filters?.stepSize ?? null,
        minQty: filters?.minQty ?? null,
        minNotional: filters?.minNotional ?? null
      },
      filters ? null : "BTCUSDT exchange filters were not found."
    );
  } catch (error) {
    addSection(
      sections,
      "Exchange filters",
      "FAIL",
      errorDetail(error, secrets),
      "BTCUSDT exchange filter load failed."
    );
  }

  if (account && positions && filters && leverage && priceEvidence) {
    const plan = buildMinimalOrderPlan(filters, priceEvidence, sections);

    if (plan) {
      const checks = buildPreflightChecks({
        liveReadinessMode: readiness.mode,
        account,
        positions,
        plan,
        leverage,
        liveRiskLimits
      });
      preflightAccepted = checks.every((check) => check.passed || !check.blocking);
      safeToAdd = buildSafeToAddResult({
        symbol,
        direction: plan.side === "BUY" ? "long" : "short",
        side: plan.side,
        generatedAt: Date.now(),
        checks
      });

      addSection(
        sections,
        "Preflight request evaluation",
        preflightAccepted ? "PASS" : "FAIL",
        {
          symbol,
          side: plan.side,
          type: plan.type,
          sideSource: readEnv("SG008_ORDER_SIDE") ? "SG008_ORDER_SIDE" : "default BUY",
          typeSource: "fixed non-mutating MARKET smoke",
          quantity: plan.quantity,
          quantitySource: plan.quantitySource,
          normalizedQuantity: plan.normalizedQuantity,
          marketPrice: plan.marketPrice,
          marketPriceSource: plan.marketPriceSource,
          marketPriceEndpoint: plan.marketPriceEndpoint,
          normalizedPrice: plan.normalizedPrice,
          notional: plan.notional,
          accepted: preflightAccepted,
          failedChecks: checks
            .filter((check) => check.blocking && !check.passed)
            .map((check) => ({ code: check.code, message: check.message }))
        },
        preflightAccepted ? null : "Minimal BTCUSDT preflight has blocking validation checks."
      );

      addSection(
        sections,
        "Safe-To-Add result",
        safeToAdd.status === "ALLOW" ? "PASS" : "FAIL",
        {
          status: safeToAdd.status,
          allowed: safeToAdd.allowed,
          blockers: safeToAdd.blockers,
          warnings: safeToAdd.warnings,
          accountBlockers: safeToAdd.accountBlockers ?? []
        },
        safeToAdd.status === "ALLOW"
          ? null
          : `Safe-To-Add returned ${safeToAdd.status}.`
      );
    }
  } else {
    addSection(
      sections,
      "Preflight request evaluation",
      "FAIL",
      { symbol },
      "Account, position, price, exchange filter, and leverage evidence are required before evaluating preflight."
    );
    addSection(
      sections,
      "Safe-To-Add result",
      "FAIL",
      { symbol },
      "Safe-To-Add requires a completed preflight evaluation."
    );
  }

  const final = buildFinalStatus(sections, preflightAccepted, safeToAdd);
  printReport(sections, final.status, final.reasons);

  if (final.status !== "ACCEPTED" && toBoolean(readEnv("SG008_STRICT"), false)) {
    process.exitCode = 1;
  }
};

run().catch(() => {
  console.error("SG-008A preflight smoke failed unexpectedly.");
  console.error("Unexpected diagnostic errors are intentionally not printed to avoid leaking credentials.");
  process.exitCode = 1;
});
