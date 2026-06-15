import { config } from "../config";
import {
  BinanceApiError,
  fetchPositionRiskSnapshot,
  getOpenOrders,
  placeFuturesOrder
} from "../services/binance-rest";
import {
  getExchangeFilterMap,
  getSymbolFilters,
  normalizeQuantity
} from "../services/binance-exchange-filters";
import { resolveBinanceEnvironment, summarizeBinanceEnvironmentDiagnostics } from "./binance-environment";

type CleanupStatus = "PASS" | "FAIL";

interface CleanupSection {
  name: string;
  status: CleanupStatus;
  detail: Record<string, unknown>;
  blocker: string | null;
}

const testnetRestBase = "https://testnet.binancefuture.com";
const testnetWsBase = "wss://stream.binancefuture.com";
const symbol = "BTCUSDT";
const confirmValue = "FLATTEN_TESTNET_BTCUSDT";
const waitTimeoutMs = 30_000;
const waitIntervalMs = 1_000;

const readEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value?.trim() ? value.trim() : undefined;
};

const redact = (value: string, secrets: Array<string | null | undefined>): string => {
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
  secrets: Array<string | null | undefined>
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
  sections: CleanupSection[],
  name: string,
  status: CleanupStatus,
  detail: Record<string, unknown>,
  blocker: string | null = null
): void => {
  sections.push({ name, status, detail, blocker });
};

const signedNumber = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async <T>(
  check: () => Promise<T | null>,
  timeoutMs = waitTimeoutMs
): Promise<T | null> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const result = await check();
    if (result) {
      return result;
    }
    await sleep(waitIntervalMs);
  }

  return null;
};

const printReport = (sections: CleanupSection[]): void => {
  const firstBlocker = sections.find((section) => section.status === "FAIL")?.blocker ?? null;
  const overall = sections.every((section) => section.status === "PASS") ? "PASS" : "FAIL";

  console.log("## SG-008B BTCUSDT Testnet Cleanup");
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

  process.exitCode = overall === "PASS" ? 0 : 1;
};

const run = async (): Promise<void> => {
  const sections: CleanupSection[] = [];
  const apiKey = config.apiKey;
  const apiSecret = config.apiSecret;
  const secrets = [apiKey, apiSecret, readEnv("ORDER_CONTROL_TOKEN")];
  const environment = resolveBinanceEnvironment({
    binanceFuturesTestnet: true,
    restBase: testnetRestBase,
    wsBase: testnetWsBase,
    liveTradingEnabled: true,
    orderLiveModeEnabled: true
  });
  const envSummary = summarizeBinanceEnvironmentDiagnostics(environment);

  addSection(
    sections,
    "Environment classification",
    envSummary.restBaseIsTestnet && envSummary.wsBaseIsTestnet ? "PASS" : "FAIL",
    {
      ...envSummary,
      restEndpoint: "/fapi/v3/positionRisk, /fapi/v1/openOrders, /fapi/v1/order",
      liveEndpointTouched: false
    },
    envSummary.restBaseIsTestnet && envSummary.wsBaseIsTestnet
      ? null
      : "Cleanup command is not classified as TESTNET-only."
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
    apiKey && apiSecret ? null : "BINANCE_API_KEY and BINANCE_API_SECRET are required."
  );

  const cleanupConfirm = readEnv("SG008B_TESTNET_CLEANUP_CONFIRM");
  addSection(
    sections,
    "Cleanup confirmation",
    cleanupConfirm === confirmValue ? "PASS" : "FAIL",
    {
      required: `SG008B_TESTNET_CLEANUP_CONFIRM=${confirmValue}`,
      configured: cleanupConfirm ? "<configured>" : "<missing>"
    },
    cleanupConfirm === confirmValue
      ? null
      : `Set SG008B_TESTNET_CLEANUP_CONFIRM=${confirmValue} to flatten BTCUSDT on TESTNET.`
  );

  if (sections.some((section) => section.status === "FAIL") || !apiKey || !apiSecret) {
    printReport(sections);
    return;
  }

  try {
    const [initialPositions, initialOpenOrders, exchangeFilters] = await Promise.all([
      fetchPositionRiskSnapshot(testnetRestBase, apiKey, apiSecret),
      getOpenOrders(testnetRestBase, apiKey, apiSecret, symbol),
      getExchangeFilterMap(testnetRestBase)
    ]);
    const btcPositions = initialPositions.filter((position) => position.symbol === symbol);
    const nonZeroBtcPositions = btcPositions.filter(
      (position) => Math.abs(signedNumber(position.positionAmt)) > 0
    );
    const positionAmt = nonZeroBtcPositions.reduce(
      (sum, position) => sum + signedNumber(position.positionAmt),
      0
    );

    addSection(
      sections,
      "Initial BTCUSDT state",
      initialOpenOrders.length === 0 ? "PASS" : "FAIL",
      {
        symbol,
        btcOpenOrders: initialOpenOrders.length,
        btcPositionAmt: positionAmt,
        nonZeroPositionRows: nonZeroBtcPositions.map((position) => ({
          positionSide: position.positionSide,
          positionAmt: signedNumber(position.positionAmt)
        }))
      },
      initialOpenOrders.length === 0
        ? null
        : "BTCUSDT has pre-existing TESTNET open orders; cleanup refuses to cancel unknown orders."
    );

    if (initialOpenOrders.length > 0) {
      printReport(sections);
      return;
    }

    if (Math.abs(positionAmt) === 0) {
      addSection(sections, "Cleanup action", "PASS", {
        needed: false,
        orderSubmitted: false,
        reason: "BTCUSDT was already flat."
      });
    } else if (
      nonZeroBtcPositions.length !== 1 ||
      nonZeroBtcPositions.some((position) => position.positionSide !== "BOTH")
    ) {
      addSection(
        sections,
        "Cleanup action",
        "FAIL",
        {
          needed: true,
          orderSubmitted: false,
          nonZeroPositionRows: nonZeroBtcPositions.map((position) => ({
            positionSide: position.positionSide,
            positionAmt: signedNumber(position.positionAmt)
          }))
        },
        "Cleanup supports only a single one-way BTCUSDT TESTNET position."
      );
      printReport(sections);
      return;
    } else {
      const filters = getSymbolFilters(symbol, exchangeFilters);
      const normalized = normalizeQuantity(symbol, Math.abs(positionAmt), exchangeFilters);
      const quantityMatchesPosition = Math.abs(normalized.quantity - Math.abs(positionAmt)) < 1e-12;

      if (!filters || normalized.quantity <= 0 || !quantityMatchesPosition) {
        addSection(
          sections,
          "Cleanup action",
          "FAIL",
          {
            needed: true,
            orderSubmitted: false,
            rawQuantity: Math.abs(positionAmt),
            normalizedQuantity: normalized.quantity,
            warnings: normalized.warnings,
            filters: filters
              ? {
                  minQty: filters.minQty,
                  maxQty: filters.maxQty,
                  stepSize: filters.stepSize
                }
              : null
          },
          "BTCUSDT position quantity cannot be safely represented as an exact reduce-only close quantity."
        );
        printReport(sections);
        return;
      }

      const side = positionAmt > 0 ? "SELL" : "BUY";
      const clientOrderId = `sg008b-cleanup-${Date.now()}`;
      const order = await placeFuturesOrder(testnetRestBase, apiKey, apiSecret, {
        symbol,
        side,
        type: "MARKET",
        quantity: normalized.quantity,
        reduceOnly: true,
        newClientOrderId: clientOrderId
      });

      addSection(sections, "Cleanup action", "PASS", {
        needed: true,
        symbol,
        side,
        quantity: normalized.quantity,
        reduceOnly: true,
        clientOrderId: order.clientOrderId,
        orderId: order.orderId,
        status: order.status,
        createsDecisionReview: false
      });
    }

    const finalState = await waitUntil(async () => {
      const [positions, openOrders] = await Promise.all([
        fetchPositionRiskSnapshot(testnetRestBase, apiKey, apiSecret),
        getOpenOrders(testnetRestBase, apiKey, apiSecret, symbol)
      ]);
      const finalPositionAmt = positions
        .filter((position) => position.symbol === symbol)
        .reduce((sum, position) => sum + signedNumber(position.positionAmt), 0);

      return Math.abs(finalPositionAmt) === 0 && openOrders.length === 0
        ? { finalPositionAmt, openOrders: openOrders.length }
        : null;
    });

    if (!finalState) {
      const [positions, openOrders] = await Promise.all([
        fetchPositionRiskSnapshot(testnetRestBase, apiKey, apiSecret),
        getOpenOrders(testnetRestBase, apiKey, apiSecret, symbol)
      ]);
      const finalPositionAmt = positions
        .filter((position) => position.symbol === symbol)
        .reduce((sum, position) => sum + signedNumber(position.positionAmt), 0);

      addSection(
        sections,
        "Final verification",
        "FAIL",
        {
          symbol,
          finalPositionAmt,
          openOrders: openOrders.length
        },
        "BTCUSDT TESTNET position or open orders remain after cleanup."
      );
      printReport(sections);
      return;
    }

    addSection(sections, "Final verification", "PASS", {
      symbol,
      finalPositionAmt: finalState.finalPositionAmt,
      openOrders: finalState.openOrders
    });

    printReport(sections);
  } catch (error) {
    addSection(
      sections,
      "Unhandled cleanup error",
      "FAIL",
      errorDetail(error, secrets),
      "BTCUSDT TESTNET cleanup failed unexpectedly."
    );
    printReport(sections);
  }
};

void run();
