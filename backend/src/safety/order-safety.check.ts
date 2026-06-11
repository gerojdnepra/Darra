import fs from "node:fs";
import path from "node:path";
import {
  evaluateClientOrderIdSafety,
  evaluateOrderRiskSafety,
  evaluateReduceOnlyPositionSafety,
  buildSafeToAddResult
} from "./order-safety";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertDecision = (
  name: string,
  decision: { passed: boolean },
  expectedPassed: boolean
): void => {
  assert(
    decision.passed === expectedPassed,
    `${name}: expected passed=${expectedPassed}, got ${decision.passed}`
  );
};

const serviceSource = fs.readFileSync(
  path.resolve("src", "services", "binance-order-service.ts"),
  "utf8"
);
const handleIntentIndex = serviceSource.indexOf("async handleIntent(");
const duplicateIndex = serviceSource.indexOf(
  "orderRepository.getIntentResponse(meta.intentId)",
  handleIntentIndex
);
const liveGateIndex = serviceSource.indexOf("this.validateLiveGate(payload, meta)", handleIntentIndex);
const replayIndex = serviceSource.indexOf("this.replayIntentResponse(duplicate)", handleIntentIndex);
const clientOrderIdIndex = serviceSource.indexOf("evaluateClientOrderIdSafety", handleIntentIndex);
const rejectedReplayIndex = serviceSource.indexOf('record.response.type === "order_rejected"');
const duplicateMarkerIndex = serviceSource.indexOf("duplicate: true", rejectedReplayIndex);

assert(handleIntentIndex >= 0, "handleIntent source was not found.");
assert(duplicateIndex > handleIntentIndex, "duplicate intent lookup was not found in handleIntent.");
assert(replayIndex > duplicateIndex, "duplicate replay should happen after duplicate lookup.");
assert(liveGateIndex > replayIndex, "live gate must run after duplicate replay branch.");
assert(
  clientOrderIdIndex > liveGateIndex,
  "clientOrderId collision check must run after duplicate replay and live gate for new intents."
);
assert(rejectedReplayIndex >= 0, "order_rejected replay branch was not found.");
assert(duplicateMarkerIndex > rejectedReplayIndex, "order_rejected replay must set duplicate marker.");

assertDecision(
  "active clientOrderId collision",
  evaluateClientOrderIdSafety({
    intentId: "intent-b",
    existingOrder: {
      intentId: "intent-a",
      status: "NEW",
      clientOrderId: "client-1"
    }
  }),
  false
);
assertDecision(
  "terminal clientOrderId reuse",
  evaluateClientOrderIdSafety({
    intentId: "intent-b",
    existingOrder: {
      intentId: "intent-a",
      status: "CANCELED",
      clientOrderId: "client-1"
    }
  }),
  true
);
assertDecision(
  "same intentId clientOrderId replay",
  evaluateClientOrderIdSafety({
    intentId: "intent-a",
    existingOrder: {
      intentId: "intent-a",
      status: "NEW",
      clientOrderId: "client-1"
    }
  }),
  true
);
assertDecision(
  "missing clientOrderId existing order",
  evaluateClientOrderIdSafety({
    intentId: "intent-a",
    existingOrder: null
  }),
  true
);

assertDecision(
  "live reduceOnly without account snapshot",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: false,
    side: "BUY",
    quantity: 1,
    signedPositionQuantity: -2
  }),
  false
);
assertDecision(
  "live reduceOnly without position",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 1,
    signedPositionQuantity: 0
  }),
  false
);
assertDecision(
  "BUY reduceOnly against short",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 2,
    signedPositionQuantity: -3
  }),
  true
);
assertDecision(
  "BUY reduceOnly against long",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 2,
    signedPositionQuantity: 3
  }),
  false
);
assertDecision(
  "SELL reduceOnly against long",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "SELL",
    quantity: 2,
    signedPositionQuantity: 3
  }),
  true
);
assertDecision(
  "SELL reduceOnly against short",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "SELL",
    quantity: 2,
    signedPositionQuantity: -3
  }),
  false
);
assertDecision(
  "reduceOnly quantity too large",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 4,
    signedPositionQuantity: -3
  }),
  false
);
assertDecision(
  "paper reduceOnly no open position",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "SELL",
    quantity: 1,
    signedPositionQuantity: 0
  }),
  false
);
assertDecision(
  "paper reduceOnly matching position",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "SELL",
    quantity: 1,
    signedPositionQuantity: 2
  }),
  true
);
assertDecision(
  "paper reduceOnly wrong direction",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "BUY",
    quantity: 1,
    signedPositionQuantity: 2
  }),
  false
);
assertDecision(
  "paper reduceOnly quantity too large",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "SELL",
    quantity: 3,
    signedPositionQuantity: 2
  }),
  false
);

const baseRiskInput = {
  paperMode: false,
  reduceOnly: false,
  orderNotional: 100,
  currentSymbolNotional: 50,
  hasCurrentSymbolPosition: true,
  openPositionsCount: 2,
  availableBalanceUsd: 500,
  accountEquityUsd: 100,
  liveRiskLimits: {
    maxOrderNotionalUsdt: { enabled: true, value: 200 },
    maxPositionNotionalUsdt: { enabled: true, value: 200 },
    maxOpenPositions: { enabled: true, value: 3 },
    maxDailyLossUsdt: { enabled: false, value: null },
    maxLeverage: { enabled: false, value: null }
  }
};

const hasRiskCheck = (
  checks: ReturnType<typeof evaluateOrderRiskSafety>,
  code: string,
  passed: boolean
): boolean => checks.some((check) => check.code === code && check.passed === passed);

let riskChecks = evaluateOrderRiskSafety(baseRiskInput);
assert(hasRiskCheck(riskChecks, "max_order_notional", true), "max order notional should pass.");
assert(hasRiskCheck(riskChecks, "max_position_notional", true), "max position notional should pass.");
assert(hasRiskCheck(riskChecks, "margin_available", true), "margin availability should pass.");
assert(!riskChecks.some((check) => check.code === "max_leverage"), "disabled max leverage should not add a check.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  orderNotional: 250
});
assert(hasRiskCheck(riskChecks, "max_order_notional", false), "max order notional should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  currentSymbolNotional: 150
});
assert(hasRiskCheck(riskChecks, "max_position_notional", false), "max position notional should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  hasCurrentSymbolPosition: false,
  openPositionsCount: 3
});
assert(hasRiskCheck(riskChecks, "max_open_positions", false), "max open positions should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  hasCurrentSymbolPosition: false,
  openPositionsCount: 2
});
assert(hasRiskCheck(riskChecks, "max_open_positions", true), "max open positions should pass.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  availableBalanceUsd: 99
});
assert(hasRiskCheck(riskChecks, "margin_available", false), "margin availability should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  availableBalanceUsd: null
});
assert(hasRiskCheck(riskChecks, "margin_available", false), "missing available balance should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxDailyLossUsdt: { enabled: true, value: 50 }
  },
  dailyRealizedPnl: {
    status: "AUTHORITATIVE",
    tradingDay: "2026-06-08",
    netRealizedPnl: -40,
    grossRealizedPnl: -35,
    totalCommission: 5,
    lastEventTime: Date.now()
  }
});
assert(hasRiskCheck(riskChecks, "max_daily_loss", true), "max daily loss should pass below limit.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxDailyLossUsdt: { enabled: true, value: 50 }
  },
  dailyRealizedPnl: {
    status: "AUTHORITATIVE",
    tradingDay: "2026-06-08",
    netRealizedPnl: -50,
    grossRealizedPnl: -45,
    totalCommission: 5,
    lastEventTime: Date.now()
  }
});
assert(hasRiskCheck(riskChecks, "max_daily_loss", false), "max daily loss should fail at limit.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxDailyLossUsdt: { enabled: true, value: 50 }
  },
  dailyRealizedPnl: {
    status: "MISSING",
    tradingDay: null,
    netRealizedPnl: null,
    grossRealizedPnl: null,
    totalCommission: null,
    lastEventTime: null
  }
});
assert(hasRiskCheck(riskChecks, "max_daily_loss", false), "missing daily pnl source should fail closed.");

const authoritativeLeverageBracket = {
  status: "AUTHORITATIVE" as const,
  fetchedAt: Date.now(),
  error: null,
  brackets: [
    {
      bracket: 1,
      initialLeverage: 10,
      notionalFloor: 0,
      notionalCap: 1_000,
      maintMarginRatio: 0.004,
      cum: 0
    }
  ]
};
const authoritativeBracket = authoritativeLeverageBracket.brackets[0]!;

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: authoritativeLeverageBracket
});
assert(hasRiskCheck(riskChecks, "max_leverage", true), "max leverage should pass below effective cap.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  currentSymbolNotional: 500,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: authoritativeLeverageBracket
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "max leverage should fail above configured cap.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  currentSymbolNotional: 500,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 20 }
  },
  leverageBracket: {
    ...authoritativeLeverageBracket,
    brackets: [
      {
        bracket: authoritativeBracket.bracket,
        initialLeverage: 5,
        notionalFloor: authoritativeBracket.notionalFloor,
        notionalCap: authoritativeBracket.notionalCap,
        maintMarginRatio: authoritativeBracket.maintMarginRatio,
        cum: authoritativeBracket.cum
      }
    ]
  }
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "max leverage should fail above exchange bracket cap.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: {
    status: "MISSING",
    fetchedAt: null,
    error: "missing",
    brackets: []
  }
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "missing bracket should fail conservatively.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: {
    ...authoritativeLeverageBracket,
    status: "STALE"
  }
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "stale bracket should fail conservatively.");

const staleSafeToAdd = buildSafeToAddResult({
  symbol: "BTCUSDT",
  direction: "long",
  side: "BUY",
  generatedAt: Date.now(),
  checks: [],
  forceStatus: "STALE"
});
assert(staleSafeToAdd.status === "STALE", "forced stale Safe-To-Add status should be preserved.");
assert(staleSafeToAdd.allowed === false, "STALE Safe-To-Add should block submit under beta policy.");

console.log("order-safety checks passed");
