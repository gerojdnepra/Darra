import type { ProjectedFrame } from "../delta-frame/types";
import {
  FrameTelemetryEngine,
  measureFrameSections,
  resolvePerformanceState
} from "../frame-telemetry/frame-telemetry-engine";
import type { MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type { RegimeMemoryState } from "../regime-memory/types";
import type {
  CompactFrameTablePayload,
  CompactFundingSortedPayload,
  CompactTransportScalar,
  ScreenerFrame
} from "../types/messages";

type TableRow = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toPathSegments = (path: string): string[] => path.split(".");

const getPathValue = (value: unknown, path: string): CompactTransportScalar | unknown => {
  let current: unknown = value;

  for (const segment of toPathSegments(path)) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[segment];
  }

  return current === undefined ? null : current;
};

const compactTable = (
  rows: readonly TableRow[],
  columns: readonly string[]
): CompactFrameTablePayload => ({
  __compact: "table_v1",
  columns: columns as string[],
  rows: rows.map((row) => columns.map((column) => getPathValue(row, column) as CompactTransportScalar))
});

const rowColumns = [
  "symbol",
  "baseAsset",
  "lastPrice",
  "markPrice",
  "bestBid",
  "bestAsk",
  "bestBidQty",
  "bestAskQty",
  "change24hPct",
  "quoteVolume24h",
  "volume24h",
  "momentum30sPct",
  "momentum2mPct",
  "buyRatio60s",
  "tradeNotional5s",
  "tradeNotional60s",
  "volumeImpulse",
  "spreadBps",
  "orderBookImbalance",
  "fundingRate",
  "liquidation5m",
  "liquidationBias",
  "score",
  "bias",
  "riskScore",
  "riskLevel",
  "risk.liquidationDistance.distanceToLongPct",
  "risk.liquidationDistance.distanceToShortPct",
  "risk.liquidationDistance.nearestDistancePct",
  "risk.liquidationDistance.liquidationPressureIndex",
  "risk.liquidationDistance.marginBufferUtilization",
  "risk.var.var95_5m",
  "risk.var.var99_5m",
  "risk.var.var95_1h",
  "risk.var.var99_1h",
  "risk.var.volatility5m",
  "risk.var.volatility1h",
  "risk.var.sampleSize5m",
  "risk.var.sampleSize1h",
  "risk.correlationRow.strongestPositive",
  "risk.correlationRow.strongestNegative",
  "risk.funding.fundingRate",
  "risk.funding.basisUsd",
  "risk.funding.basisPct",
  "risk.funding.annualizedFundingPressureScore",
  "risk.flow.openInterestUsd",
  "risk.flow.openInterestDelta5mUsd",
  "risk.flow.openInterestDelta1hUsd",
  "risk.flow.cvd5mUsd",
  "risk.flow.cvd1hUsd",
  "risk.flow.liquidationNet5mUsd",
  "risk.flow.liquidationNet1hUsd",
  "risk.flow.flowPressureScore",
  "risk.flow.directionalBias",
  "risk.pnlAttribution.momentumContribution",
  "risk.pnlAttribution.flowContribution",
  "risk.pnlAttribution.fundingCarry",
  "risk.pnlAttribution.residual",
  "risk.pnlAttribution.total",
  "tags",
  "isFocus",
  "isWatchlist",
  "isActiveTrade",
  "activeTradeSource",
  "updatedAt"
] as const satisfies string[];

const fundingColumns = [
  "symbol",
  "fundingRate",
  "annualizedFunding",
  "basisPct",
  "premiumPct",
  "markPrice",
  "indexPrice"
] as const satisfies string[];

const marketFlowColumns = [
  "symbol",
  "openInterest.currentOI",
  "openInterest.oiChange5m",
  "openInterest.oiChange15m",
  "openInterest.oiChange1h",
  "cvd.value",
  "cvd.slope",
  "cvd.divergence"
] as const satisfies string[];

const regimeColumns = [
  "symbol",
  "bias",
  "finalScore",
  "confidence",
  "components.riskScore",
  "components.fundingScore",
  "components.flowScore",
  "components.liquidationScore"
] as const satisfies string[];

const signalIntelligenceColumns = [
  "symbol",
  "ssi",
  "mrs",
  "sdp",
  "shs",
  "marketState",
  "adjustedSystemConfidence"
] as const satisfies string[];

const metaExecutionColumns = [
  "symbol",
  "bias",
  "tier",
  "executionScore",
  "dampenedExecutionScore",
  "suggestedSizeMultiplier",
  "dampenedSuggestedSizeMultiplier"
] as const satisfies string[];

const metaAllocationColumns = [
  "symbol",
  "tier",
  "weight",
  "dampenedWeight",
  "suggestedSize",
  "dampenedSuggestedSize"
] as const satisfies string[];

const regimeMemoryColumns = [
  "symbol",
  "marketState",
  "continuityState",
  "rrs",
  "rdi",
  "memoryConfidence",
  "learningConfidence",
  "fingerprint",
  "regimeEchoes"
] as const satisfies string[];

const compactFundingSorted = (
  fundingSorted: ScreenerFrame["fundingSorted"]
): CompactFundingSortedPayload | undefined => {
  if (
    !fundingSorted ||
    Array.isArray(fundingSorted) ||
    !("highest" in fundingSorted) ||
    !("lowest" in fundingSorted) ||
    !("basis" in fundingSorted)
  ) {
    return undefined;
  }

  return {
    __compact: "funding_sorted_order_v1",
    highest: fundingSorted.highest.map((item) => item.symbol),
    lowest: fundingSorted.lowest.map((item) => item.symbol),
    basis: fundingSorted.basis.map((item) => item.symbol)
  };
};

const recalculateTransportTelemetry = (frame: ScreenerFrame): void => {
  if (!frame.frameTelemetry) {
    return;
  }

  const measurement = measureFrameSections(frame as unknown as Record<string, unknown>);
  const fullFrameSizeBytes = frame.frameTelemetry.fullFrameSizeBytes ?? measurement.frameSizeBytes;

  frame.frameTelemetry.frameSizeBytes = measurement.frameSizeBytes;
  frame.frameTelemetry.frameSizeKb = measurement.frameSizeKb;
  frame.frameTelemetry.projectedFrameSizeBytes = measurement.frameSizeBytes;
  frame.frameTelemetry.projectedFrameSizeKb = measurement.frameSizeKb;
  frame.frameTelemetry.suppressedFrameSizeBytes = measurement.frameSizeBytes;
  frame.frameTelemetry.suppressedFrameSizeKb = measurement.frameSizeKb;
  frame.frameTelemetry.savedBytes = Math.max(fullFrameSizeBytes - measurement.frameSizeBytes, 0);
  frame.frameTelemetry.savedKb = Number((frame.frameTelemetry.savedBytes / 1024).toFixed(2));
  frame.frameTelemetry.suppressionRatio =
    fullFrameSizeBytes > 0
      ? Number((measurement.frameSizeBytes / fullFrameSizeBytes).toFixed(4))
      : 1;
  frame.frameTelemetry.payloadBudgetState = measurement.payloadBudgetState;
  const maxStageMs = Math.max(...Object.values(frame.frameTelemetry.frameBuildStagesMs));
  frame.frameTelemetry.performanceState = resolvePerformanceState(
    measurement.payloadBudgetState,
    frame.frameTelemetry.frameBuildMs,
    maxStageMs
  );
  frame.frameTelemetry.sectionSizes = measurement.sectionSizes;
  frame.frameTelemetry.largestSections = measurement.largestSections;
  frame.frameTelemetry.averageFrameSizeKb = measurement.frameSizeKb;
};

const compactMetaRegimeGovernor = (
  metaRegimeGovernor: MetaRegimeGovernorState | undefined
): MetaRegimeGovernorState | undefined => {
  if (!metaRegimeGovernor) {
    return undefined;
  }

  return {
    ...metaRegimeGovernor,
    overlays: {
      execution: compactTable(
        metaRegimeGovernor.overlays.execution as unknown as TableRow[],
        metaExecutionColumns
      ) as unknown as MetaRegimeGovernorState["overlays"]["execution"],
      allocation: compactTable(
        metaRegimeGovernor.overlays.allocation as unknown as TableRow[],
        metaAllocationColumns
      ) as unknown as MetaRegimeGovernorState["overlays"]["allocation"]
    }
  };
};

const compactRegimeMemory = (
  regimeMemory: RegimeMemoryState | undefined
): RegimeMemoryState | undefined => {
  if (!regimeMemory) {
    return undefined;
  }

  return {
    ...regimeMemory,
    symbols: compactTable(
      regimeMemory.symbols as unknown as TableRow[],
      regimeMemoryColumns
    ) as unknown as RegimeMemoryState["symbols"]
  };
};

export const compactFrameForTransport = (
  frame: ProjectedFrame,
  telemetryEngine?: FrameTelemetryEngine
): ProjectedFrame => {
  const nextFrame: ProjectedFrame = {
    ...frame
  };

  if (nextFrame.rows && nextFrame.rows.length > 0) {
    nextFrame.rows = compactTable(nextFrame.rows as unknown as TableRow[], rowColumns) as unknown as typeof nextFrame.rows;
  }

  if (nextFrame.funding && nextFrame.funding.length > 0) {
    nextFrame.funding = compactTable(
      nextFrame.funding as unknown as TableRow[],
      fundingColumns
    ) as unknown as typeof nextFrame.funding;
  }

  if (nextFrame.marketFlow && nextFrame.marketFlow.length > 0) {
    nextFrame.marketFlow = compactTable(
      nextFrame.marketFlow as unknown as TableRow[],
      marketFlowColumns
    ) as unknown as typeof nextFrame.marketFlow;
  }

  if (nextFrame.regime && nextFrame.regime.length > 0) {
    nextFrame.regime = compactTable(
      nextFrame.regime as unknown as TableRow[],
      regimeColumns
    ) as unknown as typeof nextFrame.regime;
  }

  if (nextFrame.signalIntelligence && nextFrame.signalIntelligence.length > 0) {
    nextFrame.signalIntelligence = compactTable(
      nextFrame.signalIntelligence as unknown as TableRow[],
      signalIntelligenceColumns
    ) as unknown as typeof nextFrame.signalIntelligence;
  }

  const compactFundingSortedPayload = compactFundingSorted(nextFrame.fundingSorted);
  if (compactFundingSortedPayload) {
    Object.assign(nextFrame, {
      fundingSorted: compactFundingSortedPayload as unknown as ScreenerFrame["fundingSorted"]
    });
  }

  const compactMeta = compactMetaRegimeGovernor(nextFrame.metaRegimeGovernor);
  if (compactMeta) {
    Object.assign(nextFrame, {
      metaRegimeGovernor: compactMeta as ScreenerFrame["metaRegimeGovernor"]
    });
  }

  const compactMemory = compactRegimeMemory(nextFrame.regimeMemory);
  if (compactMemory) {
    Object.assign(nextFrame, {
      regimeMemory: compactMemory as ScreenerFrame["regimeMemory"]
    });
  }

  if ((nextFrame as ScreenerFrame).frameTelemetry && telemetryEngine) {
    telemetryEngine.updateCompactFrameSize(
      (nextFrame as ScreenerFrame).frameTelemetry!,
      nextFrame as unknown as Record<string, unknown>
    );
  } else {
    recalculateTransportTelemetry(nextFrame as ScreenerFrame);
  }
  return nextFrame;
};
