import { clamp, round } from "../lib/math";
import type { BinanceAccountRiskSnapshot } from "../services/binance-account-stream";
import type { ScreenerMarketRiskSnapshot } from "../services/screener-engine";
import type { AccountStreamStatus, ScreenerRow } from "../types/messages";
import { computePositionLiquidationDistance } from "./liquidation-distance";
import { RiskStore, createDefaultRiskState } from "./risk-store";
import type {
  FlowDirectionalBias,
  RiskAlertEntry,
  RiskLevel,
  RiskPositionState,
  RiskSnapshotPayload,
  RiskState,
  RiskUpdatePayload,
  RiskUpdateReason
} from "./types";

interface RiskEngineInput {
  account: BinanceAccountRiskSnapshot;
  accountStream: AccountStreamStatus;
  rows: ScreenerRow[];
  market: ScreenerMarketRiskSnapshot;
}

const createMetricValue = (value: number | null, updatedAt: number | null) => ({
  value,
  updatedAt
});

const toRiskLevel = (score: number): RiskLevel => {
  if (score >= 75) {
    return "CRITICAL";
  }
  if (score >= 55) {
    return "HIGH";
  }
  if (score >= 30) {
    return "MEDIUM";
  }
  return "LOW";
};

const mean = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const averageMetric = (values: Array<number | null | undefined>): number | null => {
  const numericValues = values.filter((value): value is number => typeof value === "number");
  return numericValues.length > 0 ? mean(numericValues) : null;
};

export class RiskEngine {
  private version = 1;

  constructor(private readonly store: RiskStore) {}

  getState(): RiskState {
    return this.store.getState();
  }

  private buildPortfolioPositions(input: RiskEngineInput): RiskPositionState[] {
    const rowBySymbol = new Map(input.rows.map((row) => [row.symbol, row] as const));

    return input.account.positions
      .map((position) => {
        const row = rowBySymbol.get(position.symbol);
        const quantity = Math.abs(position.quantity);
        const side: RiskPositionState["side"] = position.quantity >= 0 ? "LONG" : "SHORT";
        const markPrice = row?.markPrice || position.markPrice || row?.lastPrice || 0;
        const entryPrice = position.entryPrice || position.breakEvenPrice || 0;
        const notionalUsd = round(quantity * markPrice, 2);
        const unrealizedPnlUsd =
          markPrice > 0 && entryPrice > 0
            ? round((side === "LONG" ? markPrice - entryPrice : entryPrice - markPrice) * quantity, 2)
            : round(position.unrealizedPnl, 2);
        const unrealizedPnlPct =
          entryPrice > 0 ? round((unrealizedPnlUsd / Math.max(entryPrice * quantity, 1)) * 100, 2) : null;
        const liquidationPrice =
          position.liquidationPrice > 0 ? round(position.liquidationPrice, 6) : null;
        const liquidationDistance = computePositionLiquidationDistance(
          side,
          markPrice,
          liquidationPrice
        );
        const rowRiskScore = row?.riskScore ?? 0;
        const rowRiskLevel = row?.riskLevel ?? "LOW";

        return {
          symbol: position.symbol,
          side,
          quantity: round(quantity, 6),
          entryPrice: round(entryPrice, 6),
          markPrice: round(markPrice, 6),
          notionalUsd,
          unrealizedPnlUsd,
          unrealizedPnlPct,
          liquidationPrice,
          distancePct: liquidationDistance.distancePct,
          distanceToLiquidationPct: liquidationDistance.distancePct,
          initialMarginUsd: round(position.initialMargin, 2),
          maintMarginUsd: round(position.maintMargin, 2),
          openOrderMarginUsd: round(position.openOrderInitialMargin, 2),
          isolatedWalletUsd: round(position.isolatedWallet, 2),
          quoteVolume24h: row?.quoteVolume24h ?? null,
          change24hPct: row?.change24hPct ?? null,
          score: row?.score ?? null,
          bias: row?.bias ?? null,
          riskScore: rowRiskScore,
          portfolioRiskLevel: rowRiskLevel,
          riskLevel: liquidationDistance.riskLevel,
          risk:
            row?.risk ?? {
              liquidationDistance: {
                distanceToLongPct: null,
                distanceToShortPct: null,
                nearestDistancePct: null,
                liquidationPressureIndex: 0,
                marginBufferUtilization: null
              },
              var: {
                var95_5m: null,
                var99_5m: null,
                var95_1h: null,
                var99_1h: null,
                volatility5m: null,
                volatility1h: null,
                sampleSize5m: 0,
                sampleSize1h: 0
              },
              correlationRow: {
                strongestPositive: [],
                strongestNegative: []
              },
              funding: {
                fundingRate: 0,
                basisUsd: 0,
                basisPct: 0,
                annualizedFundingPressureScore: 0
              },
              flow: {
                openInterestUsd: null,
                openInterestDelta5mUsd: null,
                openInterestDelta1hUsd: null,
                cvd5mUsd: 0,
                cvd1hUsd: 0,
                liquidationNet5mUsd: 0,
                liquidationNet1hUsd: 0,
                flowPressureScore: 0,
                directionalBias: "NEUTRAL"
              },
              pnlAttribution: {
                momentumContribution: 0,
                flowContribution: 0,
                fundingCarry: 0,
                residual: 0,
                total: 0
              }
            },
          updatedAt: Math.max(position.updatedAt, row?.updatedAt ?? 0)
        };
      })
      .sort((left, right) => right.notionalUsd - left.notionalUsd);
  }

  private computeAggregateVar(
    rows: ScreenerRow[],
    positions: RiskPositionState[],
    walletBalanceUsd: number | null
  ): RiskState["var"] {
    if (positions.length > 0) {
      const var95_5mUsd = round(
        positions.reduce(
          (sum, position) =>
            sum + position.notionalUsd * ((position.risk.var.var95_5m ?? 0) / 100),
          0
        ),
        2
      );
      const var99_5mUsd = round(
        positions.reduce(
          (sum, position) =>
            sum + position.notionalUsd * ((position.risk.var.var99_5m ?? position.risk.var.var95_5m ?? 0) / 100),
          0
        ),
        2
      );
      const var95_1hUsd = round(
        positions.reduce(
          (sum, position) =>
            sum + position.notionalUsd * ((position.risk.var.var95_1h ?? 0) / 100),
          0
        ),
        2
      );
      const var99_1hUsd = round(
        positions.reduce(
          (sum, position) =>
            sum + position.notionalUsd * ((position.risk.var.var99_1h ?? position.risk.var.var95_1h ?? 0) / 100),
          0
        ),
        2
      );
      const volatilityProxy = averageMetric(positions.map((position) => position.risk.var.volatility1h));
      const breach =
        walletBalanceUsd !== null &&
        ((var99_5mUsd > walletBalanceUsd * 0.04) || (var99_1hUsd > walletBalanceUsd * 0.075));

      return {
        method: "positions",
        var95_5mUsd,
        var99_5mUsd,
        var95_1hUsd,
        var99_1hUsd,
        volatilityProxy: volatilityProxy !== null ? round(volatilityProxy, 3) : null,
        sampleSize: positions.reduce((sum, position) => sum + position.risk.var.sampleSize1h, 0),
        breach
      };
    }

    const focusRows = rows.filter((row) => row.isFocus).slice(0, 12);
    const equalWeightNotional = 10_000;

    return {
      method: "focus_proxy",
      var95_5mUsd: round(
        focusRows.reduce((sum, row) => sum + equalWeightNotional * ((row.risk.var.var95_5m ?? 0) / 100), 0),
        2
      ),
      var99_5mUsd: round(
        focusRows.reduce((sum, row) => sum + equalWeightNotional * ((row.risk.var.var99_5m ?? row.risk.var.var95_5m ?? 0) / 100), 0),
        2
      ),
      var95_1hUsd: round(
        focusRows.reduce((sum, row) => sum + equalWeightNotional * ((row.risk.var.var95_1h ?? 0) / 100), 0),
        2
      ),
      var99_1hUsd: round(
        focusRows.reduce((sum, row) => sum + equalWeightNotional * ((row.risk.var.var99_1h ?? row.risk.var.var95_1h ?? 0) / 100), 0),
        2
      ),
      volatilityProxy: averageMetric(focusRows.map((row) => row.risk.var.volatility1h)),
      sampleSize: focusRows.reduce((sum, row) => sum + row.risk.var.sampleSize1h, 0),
      breach: false
    };
  }

  private buildAlerts(state: Omit<RiskState, "alerts">): RiskAlertEntry[] {
    const alerts: RiskAlertEntry[] = [];
    const now = state.generatedAt;

    if (!state.account.connected && state.account.enabled) {
      alerts.push({
        id: "risk:flow_divergence:account_stream",
        code: "flow_divergence",
        severity: "info",
        message: "Account stream disconnected. Risk metrics may be stale.",
        symbol: null,
        value: null,
        createdAt: now
      });
    }

    if (state.var.breach) {
      alerts.push({
        id: "risk:var_breach:market",
        code: "var_breach",
        severity: "critical",
        message: `VaR breach: 99% 5m VaR reached ${state.var.var99_5mUsd?.toFixed(0) ?? "--"} USD.`,
        symbol: null,
        value: state.var.var99_5mUsd,
        createdAt: now
      });
    }

    for (const position of state.positions) {
      if (position.riskLevel === "critical") {
        alerts.push({
          id: `risk:liquidation_distance:${position.symbol}`,
          code: "liquidation_distance",
          severity: "critical",
          message: `${position.symbol} liquidation distance tightened to ${position.distancePct?.toFixed(2) ?? "--"}%.`,
          symbol: position.symbol,
          value: position.distancePct,
          createdAt: now
        });
      }
    }

    const topCluster = state.correlation.clusters[0];
    if (topCluster && topCluster.averageCorrelation >= 0.85) {
      alerts.push({
        id: `risk:correlation_spike:${topCluster.symbols[0] ?? "market"}`,
        code: "correlation_spike",
        severity: "high",
        message: `Correlation spike cluster: ${topCluster.symbols.join(", ")}.`,
        symbol: topCluster.symbols[0] ?? null,
        value: topCluster.averageCorrelation,
        createdAt: now
      });
    }

    for (const symbol of state.funding.extremeSymbols.slice(0, 3)) {
      const position = state.positions.find((item) => item.symbol === symbol);
      const rowRisk = position?.risk ?? null;
      alerts.push({
        id: `risk:funding_extreme:${symbol}`,
        code: "funding_extreme",
        severity: "high",
        message: `${symbol} funding extreme at ${rowRisk?.funding.fundingRate.toFixed(4) ?? "--"}.`,
        symbol,
        value: rowRisk?.funding.annualizedFundingPressureScore ?? null,
        createdAt: now
      });
    }

    const divergentLeader = state.flow.leaders.find(
      (leader) => Math.abs(leader.flowPressureScore) >= 40
    );
    if (divergentLeader) {
      alerts.push({
        id: `risk:flow_divergence:${divergentLeader.symbol}`,
        code: "flow_divergence",
        severity: "high",
        message: `${divergentLeader.symbol} OI/CVD/liquidation divergence is elevated.`,
        symbol: divergentLeader.symbol,
        value: divergentLeader.flowPressureScore,
        createdAt: now
      });
    }

    return alerts.slice(0, 20);
  }

  evaluate(input: RiskEngineInput): RiskState {
    const now = Date.now();
    const rows = input.rows;
    const updatedAt = input.account.lastSyncAt ?? now;

    if (!input.account.enabled && rows.length === 0) {
      return {
        ...createDefaultRiskState(),
        generatedAt: now
      };
    }

    const positions = this.buildPortfolioPositions(input);
    const longExposureUsd = round(
      positions.filter((position) => position.side === "LONG").reduce((sum, position) => sum + position.notionalUsd, 0),
      2
    );
    const shortExposureUsd = round(
      positions.filter((position) => position.side === "SHORT").reduce((sum, position) => sum + position.notionalUsd, 0),
      2
    );
    const grossExposureUsd = round(longExposureUsd + shortExposureUsd, 2);
    const netExposureUsd = round(longExposureUsd - shortExposureUsd, 2);
    const unrealizedPnlUsd = round(
      positions.reduce((sum, position) => sum + position.unrealizedPnlUsd, 0),
      2
    );
    const largestPositionUsd = positions[0]?.notionalUsd ?? 0;
    const concentrationPct =
      grossExposureUsd > 0 ? round((largestPositionUsd / grossExposureUsd) * 100, 2) : 0;
    const walletBalanceUsd = input.account.balances.walletBalanceUsd;
    const availableBalanceUsd = input.account.balances.availableBalanceUsd;
    const marginBalanceUsd =
      input.account.balances.marginBalanceUsd ??
      (walletBalanceUsd !== null ? round(walletBalanceUsd + unrealizedPnlUsd, 2) : null);
    const totalInitialMarginUsd =
      input.account.balances.totalInitialMarginUsd ??
      round(positions.reduce((sum, position) => sum + position.initialMarginUsd, 0), 2);
    const marginUsagePct =
      marginBalanceUsd !== null && marginBalanceUsd > 0
        ? round((totalInitialMarginUsd / marginBalanceUsd) * 100, 2)
        : null;
    const openRiskUsd = round(
      positions.reduce((sum, position) => {
        const distancePct = position.distancePct ?? position.risk.liquidationDistance.nearestDistancePct ?? 0;
        return sum + position.notionalUsd * (distancePct / 100);
      }, 0),
      2
    );

    const topRiskSymbols = [...rows]
      .sort((left, right) => right.riskScore - left.riskScore)
      .slice(0, 10)
      .map((row) => ({
        symbol: row.symbol,
        riskScore: row.riskScore,
        riskLevel: row.riskLevel
      }));

    const focusRows = rows.filter((row) => row.isFocus);
    const liquidationDistance = positions.length
      ? {
          averageNearestDistancePct: averageMetric(positions.map((position) => position.distancePct)),
          averagePressureIndex:
            averageMetric(
              positions.map((position) =>
                computePositionLiquidationDistance(
                  position.side,
                  position.markPrice,
                  position.liquidationPrice
                ).liquidationPressureIndex
              )
            ) ?? 0,
          averageMarginBufferUtilization: averageMetric(
            positions.map((position) =>
              computePositionLiquidationDistance(
                position.side,
                position.markPrice,
                position.liquidationPrice
              ).marginBufferUtilization
            )
          ),
          criticalSymbols: positions
            .filter((position) => position.riskLevel === "critical")
            .map((position) => position.symbol)
            .slice(0, 8)
        }
      : {
          averageNearestDistancePct: averageMetric(
            focusRows.map((row) => row.risk.liquidationDistance.nearestDistancePct)
          ),
          averagePressureIndex:
            averageMetric(
              focusRows.map((row) => row.risk.liquidationDistance.liquidationPressureIndex)
            ) ?? 0,
          averageMarginBufferUtilization: averageMetric(
            focusRows.map((row) => row.risk.liquidationDistance.marginBufferUtilization)
          ),
          criticalSymbols: focusRows
            .filter((row) => (row.risk.liquidationDistance.nearestDistancePct ?? 999) <= 1.5)
            .map((row) => row.symbol)
            .slice(0, 8)
        };

    const varState = this.computeAggregateVar(rows, positions, walletBalanceUsd);
    const funding = {
      averageFundingRate: averageMetric(focusRows.map((row) => row.risk.funding.fundingRate)) ?? 0,
      averageBasisPct: averageMetric(focusRows.map((row) => row.risk.funding.basisPct)) ?? 0,
      annualizedPressureScore:
        averageMetric(focusRows.map((row) => row.risk.funding.annualizedFundingPressureScore)) ?? 0,
      extremeSymbols: focusRows
        .filter((row) => row.risk.funding.annualizedFundingPressureScore >= 65)
        .map((row) => row.symbol)
        .slice(0, 8)
    };
    const flowBiasScore =
      averageMetric(focusRows.map((row) => row.risk.flow.flowPressureScore)) ?? 0;
    const flowDirectionalBias: FlowDirectionalBias =
      flowBiasScore >= 10 ? "LONG" : flowBiasScore <= -10 ? "SHORT" : "NEUTRAL";
    const flow = {
      aggregatePressureScore: round(flowBiasScore, 2),
      directionalBias: flowDirectionalBias,
      totalOpenInterestDelta5mUsd: round(
        focusRows.reduce((sum, row) => sum + (row.risk.flow.openInterestDelta5mUsd ?? 0), 0),
        2
      ),
      totalOpenInterestDelta1hUsd: round(
        focusRows.reduce((sum, row) => sum + (row.risk.flow.openInterestDelta1hUsd ?? 0), 0),
        2
      ),
      totalCvd5mUsd: round(
        focusRows.reduce((sum, row) => sum + row.risk.flow.cvd5mUsd, 0),
        2
      ),
      totalCvd1hUsd: round(
        focusRows.reduce((sum, row) => sum + row.risk.flow.cvd1hUsd, 0),
        2
      ),
      totalLiquidationNet5mUsd: round(
        focusRows.reduce((sum, row) => sum + row.risk.flow.liquidationNet5mUsd, 0),
        2
      ),
      totalLiquidationNet1hUsd: round(
        focusRows.reduce((sum, row) => sum + row.risk.flow.liquidationNet1hUsd, 0),
        2
      ),
      leaders: [...focusRows]
        .sort((left, right) => Math.abs(right.risk.flow.flowPressureScore) - Math.abs(left.risk.flow.flowPressureScore))
        .slice(0, 8)
        .map((row) => ({
          symbol: row.symbol,
          flowPressureScore: row.risk.flow.flowPressureScore,
          directionalBias: row.risk.flow.directionalBias
        }))
    };
    const pnlAttribution = {
      momentumContribution: round(
        focusRows.reduce((sum, row) => sum + row.risk.pnlAttribution.momentumContribution, 0),
        2
      ),
      flowContribution: round(
        focusRows.reduce((sum, row) => sum + row.risk.pnlAttribution.flowContribution, 0),
        2
      ),
      fundingCarry: round(
        focusRows.reduce((sum, row) => sum + row.risk.pnlAttribution.fundingCarry, 0),
        2
      ),
      residual: round(
        focusRows.reduce((sum, row) => sum + row.risk.pnlAttribution.residual, 0),
        2
      ),
      total: round(
        focusRows.reduce((sum, row) => sum + row.risk.pnlAttribution.total, 0),
        2
      )
    };

    const status: RiskState["status"] = !input.account.enabled
      ? "live"
      : input.account.connected
        ? "live"
        : positions.length > 0
          ? "stale"
          : "syncing";

    const aggregateRiskScore = round(
      clamp(
        topRiskSymbols.slice(0, 5).reduce((sum, item) => sum + item.riskScore, 0) /
          Math.max(Math.min(topRiskSymbols.length, 5), 1) *
          0.45 +
          (varState.breach ? 28 : 0) +
          (flow.aggregatePressureScore ? Math.abs(flow.aggregatePressureScore) * 0.18 : 0) +
          input.market.maxAbsCorrelation * 100 * 0.18 +
          funding.annualizedPressureScore * 0.12 +
          liquidationDistance.averagePressureIndex * 0.07,
        0,
        100
      ),
      2
    );

    const baseState: Omit<RiskState, "alerts"> = {
      generatedAt: now,
      status,
      mode: "live",
      account: {
        enabled: input.account.enabled,
        connected: input.account.connected,
        credentialSource: input.account.credentialSource,
        balanceAsset: input.account.balanceAsset,
        lastSyncAt: input.account.lastSyncAt,
        positionCount: positions.length,
        longCount: positions.filter((position) => position.side === "LONG").length,
        shortCount: positions.filter((position) => position.side === "SHORT").length
      },
      summary: {
        grossExposureUsd: createMetricValue(grossExposureUsd, updatedAt),
        netExposureUsd: createMetricValue(netExposureUsd, updatedAt),
        longExposureUsd: createMetricValue(longExposureUsd, updatedAt),
        shortExposureUsd: createMetricValue(shortExposureUsd, updatedAt),
        largestPositionUsd: createMetricValue(largestPositionUsd, updatedAt),
        concentrationPct: createMetricValue(concentrationPct, updatedAt),
        walletBalanceUsd: createMetricValue(walletBalanceUsd, updatedAt),
        availableBalanceUsd: createMetricValue(availableBalanceUsd, updatedAt),
        marginBalanceUsd: createMetricValue(marginBalanceUsd, updatedAt),
        unrealizedPnlUsd: createMetricValue(unrealizedPnlUsd, updatedAt),
        openRiskUsd: createMetricValue(openRiskUsd, updatedAt),
        marginUsagePct: createMetricValue(marginUsagePct, updatedAt)
      },
      limits: {
        maxPositionUsd: {
          enabled: false,
          value: null
        },
        maxLossPerTradeUsd: {
          enabled: false,
          value: null
        },
        maxDailyLossUsd: {
          enabled: false,
          value: null
        }
      },
      positions,
      topRiskSymbols,
      riskScore: aggregateRiskScore,
      riskLevel: toRiskLevel(aggregateRiskScore),
      liquidationDistance: {
        averageNearestDistancePct:
          liquidationDistance.averageNearestDistancePct !== null
            ? round(liquidationDistance.averageNearestDistancePct, 3)
            : null,
        averagePressureIndex: round(liquidationDistance.averagePressureIndex, 2),
        averageMarginBufferUtilization:
          liquidationDistance.averageMarginBufferUtilization !== null
            ? round(liquidationDistance.averageMarginBufferUtilization, 2)
            : null,
        criticalSymbols: liquidationDistance.criticalSymbols
      },
      var: {
        ...varState,
        volatilityProxy:
          varState.volatilityProxy !== null ? round(varState.volatilityProxy, 3) : null
      },
      correlation: {
        symbols: input.market.symbols,
        matrix: input.market.matrix,
        heatmap: input.market.heatmap,
        maxAbsCorrelation: input.market.maxAbsCorrelation,
        clusters: input.market.clusters
      },
      funding: {
        averageFundingRate: round(funding.averageFundingRate, 6),
        averageBasisPct: round(funding.averageBasisPct, 4),
        annualizedPressureScore: round(funding.annualizedPressureScore, 2),
        extremeSymbols: funding.extremeSymbols
      },
      flow,
      pnlAttribution
    };

    return {
      ...baseState,
      alerts: this.buildAlerts(baseState)
    };
  }

  sync(input: RiskEngineInput, reason: RiskUpdateReason = "sync"): RiskUpdatePayload {
    const nextState = this.evaluate(input);
    this.version += 1;
    this.store.setState(nextState, reason);

    return {
      version: this.version,
      reason,
      state: nextState
    };
  }

  getSnapshot(): RiskSnapshotPayload {
    return {
      version: this.version,
      state: this.getState()
    };
  }
}
