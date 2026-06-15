import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-persistence-"));
  const sqlitePath = path.join(tempRoot, "fixture.sqlite");
  const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
  process.env.SCALPSTATION_SQLITE_PATH = sqlitePath;

  const { closeSqlite } = await import("../storage/sqlite");
  const { orderPreflightRepository } = await import("../storage/order-preflight-repository");
  const { BinanceOrderService } = await import("../services/binance-order-service");
  const now = 1_700_100_000_000;
  const emittedMessages: Array<{ type: string; payload?: unknown }> = [];

  try {
    const service = new BinanceOrderService("https://example.test", {
      defaultPaperMode: true,
      liveModeEnabled: false,
      skipStartupRecovery: true,
      onMessage: (message) => {
        emittedMessages.push(message);
      }
    });

    const acceptedPreflightId = "preflight-active";
    const acceptedRequestId = "request-active";
    service.bindPreflight({
      preflightId: acceptedPreflightId,
      preflightNonce: "nonce-active",
      requestId: acceptedRequestId,
      ticketKey: "BTCUSDT|BUY|MARKET|1|paper",
      paperMode: true,
      generatedAt: now,
      expiresAt: now + 30_000,
      safeToAddStatus: "ALLOW",
      payload: {
        requestId: acceptedRequestId,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: 1,
        paperMode: true,
        createdAt: now
      }
    });
    orderPreflightRepository.createActivePreflight({
      id: acceptedPreflightId,
      requestId: acceptedRequestId,
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      normalizedQuantity: 1,
      price: null,
      normalizedPrice: null,
      notional: null,
      decisionContextId: null,
      createdAt: now,
      expiresAt: now + 30_000
    });

    const persistedActive = orderPreflightRepository.getById(acceptedPreflightId);
    assert.ok(persistedActive, "Expected accepted preflight to be persisted.");
    assert.equal(persistedActive.status, "ACTIVE");

    await service.handleIntent(
      {
        intentId: "intent-active",
        createdAt: now + 1,
        preflightId: acceptedPreflightId,
        preflightNonce: "nonce-active",
        action: "PLACE_ORDER",
        symbol: "BTCUSDT",
        side: "BUY",
        orderType: "MARKET",
        quantity: 1,
        paperMode: true,
        sourceWindowId: "check"
      },
      {
        account: {
          enabled: false,
          connected: false,
          credentialSource: "none",
          balanceAsset: "USDT",
          lastSyncAt: null,
          balances: {
            walletBalanceUsd: null,
            availableBalanceUsd: null,
            marginBalanceUsd: null,
            totalInitialMarginUsd: null,
            totalMaintMarginUsd: null,
            totalOpenOrderInitialMarginUsd: null,
            totalPositionInitialMarginUsd: null,
            totalCrossWalletBalanceUsd: null,
            totalUnrealizedPnlUsd: null,
            updatedAt: null
          },
          positions: [],
        },
        accountStream: {
          enabled: false,
          credentialSource: "none",
          keyLabel: null,
          message: "disabled",
          error: null,
          activePositions: [],
          lastSyncAt: null,
          connected: false,
          url: "",
          lastMessageAt: null,
          reconnectAttempts: 0
        },
        row: null
      }
    );

    const consumedPreflight = orderPreflightRepository.getById(acceptedPreflightId);
    assert.ok(consumedPreflight, "Expected consumed preflight to remain persisted.");
    assert.equal(consumedPreflight.status, "USED");
    assert.ok(
      emittedMessages.some((message) => message.type === "order_preflight_invalidated"),
      "Expected USED invalidation event to be emitted."
    );

    const expiredPreflightId = "preflight-expired";
    orderPreflightRepository.createActivePreflight({
      id: expiredPreflightId,
      requestId: "request-expired",
      symbol: "ETHUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: 2,
      normalizedQuantity: 2,
      price: 101,
      normalizedPrice: 101,
      notional: 202,
      decisionContextId: null,
      createdAt: now - 60_000,
      expiresAt: now - 10
    });
    const expiredCount = orderPreflightRepository.expireExpiredActivePreflights(
      now,
      "ACTIVE preflight expired during startup cleanup."
    );
    assert.ok(expiredCount >= 1);
    assert.equal(orderPreflightRepository.getById(expiredPreflightId)?.status, "EXPIRED");

    const helperSource = fs.readFileSync(
      path.join(workspaceRoot, "frontend", "lib", "order-preflight-state.ts"),
      "utf8"
    );
    const componentSource = fs.readFileSync(
      path.join(workspaceRoot, "frontend", "components", "scalp-station-app.tsx"),
      "utf8"
    );

    assert.ok(
      helperSource.includes("loading: false") &&
        helperSource.includes("stale: true") &&
        helperSource.includes("unavailableReason: invalidation.reason"),
      "Expected frontend invalidation helper to clear preflight readiness state."
    );
    assert.ok(
      componentSource.includes('message.type === "order_preflight_invalidated"') &&
        componentSource.includes("setPendingOrderConfirmation(null);") &&
        componentSource.includes("setTicketDecisionContextGuard(null);"),
      "Expected frontend invalidation event handler to clear confirmation state."
    );

    console.log("preflight persistence checks passed", {
      sqlitePath,
      checkedAt: Date.now()
    });
  } finally {
    closeSqlite();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("preflight persistence checks failed", error);
  process.exitCode = 1;
});
